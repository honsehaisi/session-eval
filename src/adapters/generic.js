// 通用 JSONL 适配器：不认任何具体框架，只认「一行一步」的 JSON Lines。
// 职责：读文件 + 按 config.generic 的字段映射 → 标准事件（core 只认后者）。
//
// 为什么要这一层：DSH 的日志是私有格式（多帧 zstd + 包装记录），外人没有。
// 但外人只要能把「每次调用」导出成一行 JSON，就能体检——字段名在 config.json 里配。
//
// 最小格式（README §5.1，一行 = 一次模型步或一次工具调用）：
//   {"t":"2026-11-14T09:00:01Z","turn":1,"tool":"write","args":{"path":"a.md"},
//    "ok":true,"in":1200,"out":180,"stop":"completed"}
// 字段名不叫这个也行：config.generic.fields 里改成你的（支持 a.b 点取嵌套）。
//
// 与 DSH 适配器的差别（都写在 README §5.2）：
//   - 没有 turn_start/turn_end 记录：靠 turn 字段分组，用「该 turn 首行/末行时间」补；
//   - 没有 approval/policy/command 这类专有事件：安全维度只覆盖 generic 类规则；
//   - usage 缺缓存字段时按未缓存算（成本略偏高，不是偏低）。
'use strict';
const fs = require('fs');
const path = require('path');
const configMod = require('../config.js');

const SKIP_DIRS = new Set(['.git', 'node_modules', '.svn', '.hg', '__pycache__', '.venv']);
const MAX_DEPTH = 8;

// 兜底默认：正常从 config.js 的 DEFAULTS.generic 来（那边是唯一真源）
const DEFAULTS = {
  fileGlob: '**/*.jsonl',
  timeUnit: 'auto',        // auto | ms | s | iso
  turns: 'field',          // field（用 turn 字段）| infer（无 turn 字段：按 user 行/stop 切）
  sessionMode: 'file',     // file（一个文件一个会话）| field（按 session 字段分组）
  productTools: [],        // 额外算作「产物动作」的工具名（交付维度用，写进 config 即可）
  fields: {
    time: 't', turn: 'turn', type: '', role: 'role', text: 'text',
    tool: 'tool', args: 'args', ok: 'ok', error: '',
    callId: 'id', inputTokens: 'in', outputTokens: 'out',
    cacheReadTokens: '', cacheWriteTokens: '',
    stop: 'stop', session: '',
  },
};

function merge(o) {
  o = o || {};
  return Object.assign({}, DEFAULTS, o, {
    fields: Object.assign({}, DEFAULTS.fields, o.fields || {}),
    productTools: Array.isArray(o.productTools) ? o.productTools : [],
  });
}

/* ---------- 取值 ---------- */
// 点路径取值：fields.tool = 'tool.name' 也认
function get(obj, key) {
  if (obj == null || !key) return undefined;
  let cur = obj;
  for (const p of String(key).split('.')) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}
function num(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}
function toInt(v) {
  const n = num(v);
  return n == null ? null : Math.trunc(n);
}

// 时间 → 毫秒。auto：数字看量级（>=1e11 毫秒，否则秒），字符串走 Date.parse
function toMs(v, unit) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number' || /^\d+(\.\d+)?$/.test(String(v))) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return 0;
    if (unit === 's') return Math.round(n * 1000);
    if (unit === 'ms') return Math.round(n);
    return Math.round(n >= 1e11 ? n : n * 1000);
  }
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : 0;
}

/* ---------- glob ---------- */
// 只支持 * ? ** 三种通配：够覆盖 **/*.jsonl、*.ndjson、logs/**/*.json
function globToRegex(glob) {
  let s = String(glob || '**/*.jsonl').replace(/\\/g, '/').replace(/^\.\//, '');
  let re = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '*') {
      if (s[i + 1] === '*') {
        i++;
        if (s[i + 1] === '/') { re += '(?:[^/]+/)*'; i++; }
        else re += '.*';
      } else re += '[^/]*';
    } else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

function walk(base, rel, out, depth) {
  if (depth > MAX_DEPTH) return out;
  let names;
  try { names = fs.readdirSync(path.join(base, rel)); } catch (e) { return out; }
  for (const name of names) {
    const relPath = rel ? rel + '/' + name : name;
    const abs = path.join(base, relPath);
    let st;
    try { st = fs.statSync(abs); } catch (e) { continue; }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
      walk(base, relPath, out, depth + 1);
    } else if (st.isFile()) {
      out.push({ rel: relPath, abs, bytes: st.size });
    }
  }
  return out;
}

/* ---------- 每行 → 中间行 ---------- */
function normalize(r, c, idx) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const F = c.fields;
  const rawTool = get(r, F.tool);
  let toolName = null;
  if (rawTool != null && rawTool !== '') {
    toolName = typeof rawTool === 'object'
      ? String(rawTool.name || rawTool.type || rawTool.tool || '')
      : String(rawTool);
    if (!toolName) toolName = null;
  }
  let args = get(r, F.args);
  if (args === undefined && rawTool && typeof rawTool === 'object') {
    args = rawTool.args !== undefined ? rawTool.args : rawTool.input;
  }
  let rawArgs;
  if (typeof args === 'string') rawArgs = args;
  else if (args === undefined || args === null) { args = {}; rawArgs = '{}'; }
  else { rawArgs = JSON.stringify(args); }

  const rawError = F.error ? get(r, F.error) : undefined;
  const rawOk = F.ok ? get(r, F.ok) : undefined;
  let isError = null;             // null = 日志里没有可判字段（不是「没报错」）
  if (rawError !== undefined && rawError !== null && rawError !== '' && rawError !== false) isError = true;
  else if (rawError !== undefined && rawError !== null && rawError !== '') isError = false;
  else if (rawOk !== undefined && rawOk !== null && rawOk !== '') {
    isError = rawOk === false || rawOk === 0 || /^(false|no|failed|error)$/i.test(String(rawOk));
  }

  const TOK = [
    ['inputTokens', F.inputTokens], ['outputTokens', F.outputTokens],
    ['cacheReadTokens', F.cacheReadTokens], ['cacheWriteTokens', F.cacheWriteTokens],
  ];
  const usage = {};
  let hasUsage = false;
  for (const [k, key] of TOK) {
    const v = key ? num(get(r, key)) : null;
    usage[k] = v == null ? 0 : v;
    if (v != null) hasUsage = true;
  }
  if (hasUsage) usage.totalTokens = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;

  const text = get(r, F.text);
  return {
    idx,
    seq: idx + 1,
    time: toMs(get(r, F.time), c.timeUnit),
    turn: toInt(get(r, F.turn)),
    type: String(get(r, F.type) || ''),
    role: String(get(r, F.role) || ''),
    text: text == null ? '' : (typeof text === 'string' ? text : JSON.stringify(text)),
    tool: toolName,
    args: typeof args === 'string' ? (safeParse(args) || { __raw: args }) : args,
    rawArgs,
    isError,
    callId: get(r, F.callId) == null ? null : String(get(r, F.callId)),
    usage,
    hasUsage,
    stop: get(r, F.stop) == null ? '' : String(get(r, F.stop)),
    session: get(r, F.session) == null ? '' : String(get(r, F.session)),
  };
}

function safeParse(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

function kindOf(row) {
  const t = String(row.type || '').toLowerCase();
  const role = String(row.role || '').toLowerCase();
  if (t === 'turn_start' || t === 'turn_end') return t;
  if (t === 'tool_result') return 'tool';
  if (t === 'user' || t === 'user_message' || t === 'human' || role === 'user' || role === 'human') return 'user';
  // 一行带工具名就是工具行，哪怕 role=assistant（模型发起调用，token 也挂在这一行）
  if (row.tool) return 'tool';
  if (t === 'tool' || t === 'tool_call' || t === 'tool_use' || role === 'tool') return 'tool';
  if (t === 'assistant' || t === 'assistant_message' || role === 'assistant') return 'assistant';
  return 'assistant';
}

/* ---------- 行集 → 标准事件 ---------- */
function toEvents(recs, c) {
  const conf = merge(c || currentGeneric());
  const rows = [];
  for (let i = 0; i < (recs || []).length; i++) {
    const n = normalize(recs[i], conf, i);
    if (n) rows.push(n);
  }
  const events = [];
  let seq = 0;
  const push = (e) => { events.push(Object.assign({ seq: seq++ }, e)); };

  let curTurn = null;      // 当前 turn 号
  let turnStop = null;     // 该 turn 的结束原因
  let lastTime = 0;        // 该 turn 末行时间
  let stepInTurn = 0;
  let inferred = 0;

  const closeTurn = () => {
    if (curTurn == null) return;
    const reason = turnStop || 'unknown';
    push({ type: 'turn_end', turn: curTurn, reason, reasonKind: turnStop || null, time: lastTime });
    curTurn = null; turnStop = null; stepInTurn = 0;
  };
  const openTurn = (t, time) => {
    closeTurn();
    curTurn = t;
    push({ type: 'turn_start', turn: t, time });
  };

  for (const row of rows) {
    const kind = kindOf(row);

    // 显式边界记录优先
    if (kind === 'turn_start') {
      openTurn(row.turn == null ? (inferred + 1) : row.turn, row.time);
      if (row.turn == null) inferred++;
      lastTime = row.time || lastTime;
      continue;
    }
    if (kind === 'turn_end') {
      if (curTurn == null) { curTurn = row.turn == null ? (inferred + 1) : row.turn; }
      turnStop = row.stop || turnStop;
      lastTime = row.time || lastTime;
      closeTurn();
      continue;
    }

    // 归属哪个 turn
    let turn;
    if (conf.turns === 'infer') {
      // 推断模式忽略 turn 字段：一个 user 行开一轮，没有 user 行就整份一个 turn
      if (kind === 'user' || curTurn == null) inferred++;
      turn = Math.max(1, inferred || curTurn || 1);
    } else {
      turn = row.turn;
      if (turn == null) turn = curTurn == null ? 1 : curTurn;   // 缺 turn：归到当前 turn
    }
    if (curTurn !== turn) openTurn(turn, row.time);   // closeTurn 用上一行的 lastTime，别被本行污染
    if (row.stop) turnStop = row.stop;
    if (row.time) lastTime = row.time;

    if (kind === 'user') {
      push({ type: 'user_message', turn, text: row.text, time: row.time });
      continue;
    }
    if (kind === 'tool') {
      const callId = row.callId || ('g' + turn + '-' + (++stepInTurn));
      push({
        type: 'tool_call', turn, step: stepInTurn, callId,
        name: row.tool || 'unknown', args: row.args, rawArgs: row.rawArgs, time: row.time,
      });
      // isError=null 表示日志没给可判字段：不编造成功，交给 doctor 告警
      push({ type: 'tool_result', turn, step: stepInTurn, callId, text: '', isError: row.isError, time: row.time });
      if (row.hasUsage) push({ type: 'usage', turn, step: stepInTurn, usage: row.usage, time: row.time });
      continue;
    }
    // assistant
    if (row.text) {
      const blocks = [row.text];
      push({ type: 'assistant_text', turn, step: ++stepInTurn, texts: blocks, text: row.text, time: row.time });
    }
    if (row.hasUsage) push({ type: 'usage', turn, step: stepInTurn, usage: row.usage, time: row.time });
  }
  closeTurn();
  return events;
}

/* ---------- 文件 ---------- */
function parseSession(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (e) { return { err: e.message }; }
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);   // 记事本 BOM
  const recs = [];
  let parseErr = 0;
  for (const line of raw.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    try { recs.push(JSON.parse(l)); } catch (e) { parseErr++; }
  }
  return { recs, parseErr };
}

function listSessionFiles(base, c) {
  const conf = merge(c || currentGeneric());
  const re = globToRegex(conf.fileGlob);
  const files = [];
  for (const f of walk(base, '', [], 0)) {
    if (!re.test(f.rel)) continue;
    const relDir = f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) : '';
    const stem = f.rel.replace(/\.[^./]+$/, '');
    files.push({ f: f.abs, dir: relDir, id: stem.replace(/\//g, '-'), rel: f.rel, bytes: f.bytes });
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel));   // 顺序稳定，别让分数随文件系统顺序漂
  return files;
}

function groupRecords(recs, conf, fileMeta) {
  if (conf.sessionMode !== 'field' || !conf.fields.session) {
    return [{ id: fileMeta.id, recs }];
  }
  const order = [];
  const byKey = new Map();
  for (const r of recs) {
    const key = get(r, conf.fields.session);
    const k = key == null || key === '' ? '' : String(key);
    if (!byKey.has(k)) { byKey.set(k, []); order.push(k); }
    byKey.get(k).push(r);
  }
  return order.map((k) => ({ id: k ? fileMeta.id + '-' + k : fileMeta.id, recs: byKey.get(k) }));
}

function listSessions(base, opts, confOverride) {
  const conf = merge(confOverride || currentGeneric());
  const withRecords = !!(opts && opts.withRecords);
  const out = [];
  for (const f of listSessionFiles(base, conf)) {
    const p = parseSession(f.f);
    if (p.err) {
      out.push({ id: f.id, dir: f.dir, err: p.err, meta: {}, events: [], records: [] });
      continue;
    }
    for (const g of groupRecords(p.recs, conf, f)) {
      const rows = g.recs.map((r, i) => normalize(r, conf, i)).filter(Boolean);
      let latestTime = 0, firstTime = 0;
      for (const r of rows) {
        if (r.time > latestTime) latestTime = r.time;
        if (r.time && (!firstTime || r.time < firstTime)) firstTime = r.time;
      }
      out.push({
        id: g.id,
        dir: f.dir,
        meta: {
          id: g.id,
          createdAt: firstTime,
          cwd: '',
          parentSession: null,
          delegationDepth: 0,
          origin: 'main',
        },
        events: toEvents(g.recs, conf),
        stats: { records: g.recs.length, parseErr: p.parseErr, latestTime, bytes: f.bytes },
        records: withRecords ? g.recs : undefined,
      });
    }
  }
  return out;
}

function sourceGlob() {
  return merge(currentGeneric()).fileGlob;
}

// 给 doctor 用：这份日志能算哪些维度（不能算的不许装成 0 分）
function capabilities(c) {
  const conf = merge(c || currentGeneric());
  const F = conf.fields;
  return {
    fileGlob: conf.fileGlob,
    timeField: F.time || '',
    turnMode: conf.turns,
    sessionMode: conf.sessionMode,
    toolField: F.tool || '',
    errorField: F.error || '',
    okField: F.ok || '',
    canJudgeError: !!(F.ok || F.error),
    tokenField: [F.inputTokens, F.outputTokens].filter(Boolean).join(' + '),
    canCostTokens: !!(F.inputTokens || F.outputTokens),
    cacheTokenField: [F.cacheReadTokens, F.cacheWriteTokens].filter(Boolean).join(' + '),
    stopField: F.stop || '',
    productTools: conf.productTools,
  };
}

function currentGeneric() {
  const c = configMod.cfg && configMod.cfg.generic;
  return c || DEFAULTS;
}

module.exports = {
  DEFAULTS, globToRegex, toMs, get, normalize, kindOf, toEvents,
  parseSession, listSessionFiles, listSessions, sourceGlob, capabilities,
  SESSION_FILE: '',
  EVENT_TYPES: ['turn_start', 'turn_end', 'user_message', 'assistant_text', 'usage',
    'tool_call', 'tool_result', 'approval_asked', 'approval_decided', 'policy', 'command'],
};
