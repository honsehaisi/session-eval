#!/usr/bin/env node
// 速度 S2 / 交付（任务级）切分脚本
// ---------------------------------------------------------------------------
// 口径真源：docs/计划书.md §0.8（评分协议）/ §1.1（S2 公式）/ §1.2 第 4 条
// （任务切法）/ §4.1（可验证产物定义）/ §4.2（数据从哪取）。
//
// 可执行切分规则（不靠人工判断）：
//   R0 基线单元 = 一个会话文件；子会话（origin=subagent 或 parentSession 有值）
//      整份排除（§0.8 第 6 条）。
//   R1 把会话内所有「产物事件」按 seq 排成序列，每个产物事件带一个类型
//      （code/doc/data/image/media/message/other）。
//   R2 相邻同类型合并成 run。若 run 的类型 != 当前任务类型，且该 run 的
//      产物事件数 >= N（默认 N=3，即「新类型持续至少 3 步（3 个产物事件）」），
//      就在该 run 第一个产物事件所在的 turn 切一刀。短于 N 的杂音 run 不切。
//   R3 显式任务切换信号，命中也在该 turn 切一刀：
//      a) 用户消息开头命中「新任务/换个任务/重新开始/下一个任务…」；
//      b) 相邻 turn 空闲 >= 4 小时（跨工作时段；§1.5 说「轮间隔切任务失效」
//         指的是中位 0.5 分钟、p90 7.7 分钟的分钟级间隔，4h 是另一量级）。
//   R4 每个任务段 = 两个切点之间的连续 turn；耗时 =
//      末 turn 的 turn/end.time − 首 turn 的 turn/start.time（§1.1）。
//   R5 产物判定只认 tool/call（§4.2）：文件类看路径扩展名；bash/pwsh 看重定向
//      >/>>、-o/--output/Out-File/tee、ffmpeg 最后一个媒体输出；生图/ffmpeg
//      成品工具按语义；qq_send_*/meme 算对外消息。读文件、看图、抽帧检查、
//      vision_present 等中间步骤不算产物。临时目录/日志/.bak 不算。
//   R6 「有真实产物」= 该任务段至少有一个产物调用，且其 tool/result 存在且
//      isError !== true（§4.2 第 3 条：先看 tool/result 是否成功）。
// ---------------------------------------------------------------------------
//
// 输入是 dataset 的标准事件流（turn_start / turn_end / user_message / tool_call /
// tool_result …），不再自己找会话文件、解压 zstd、认记录类型。
// 需要「文件顺序」的地方按事件自带的 seq 重排（与改造前按记录 seq 排等价）。
const fs = require('fs');
const path = require('path');
const { loadCached, sourceGlob } = require('../dataset.js');

const SESSIONS_BASE = require('../config.js').P.sessionsDir;
const OUT = path.join(__dirname, 'report.json');

const DEFAULTS = {
  N: 3,                     // 新类型至少连续出现 N 个产物事件才切
  idleMs: 4 * 3600 * 1000,  // 跨工作时段空闲阈值
  useIdle: true,
  useKeywords: true,
  multiTurnOnly: false,     // S2 主口径：所有任务段（含单轮）；敏感性另算只留 >=2 轮
  strictFileProducts: false // 交付主口径：含消息；敏感性另算只算文件/图片/视频
};

const EXT_CLASS = (() => {
  const m = {};
  const put = (cls, exts) => exts.split(/\s+/).filter(Boolean).forEach(e => { m[e] = cls; });
  put('code', 'js mjs cjs jsx ts tsx py ps1 psm1 sh bash bat cmd go rs java c h cpp hpp cc cs rb php sql vue svelte kt swift lua r pl');
  put('doc', 'md markdown txt html htm pdf docx doc xlsx xls pptx ppt csv rtf epub tex');
  put('data', 'json jsonl yaml yml xml ini cfg conf env sqlite db parquet');
  put('image', 'png jpg jpeg webp gif svg bmp ico tif tiff avif');
  put('media', 'mp4 mov mkv webm avi flv mp3 wav m4a aac flac ogg opus');
  put('other', 'zip 7z rar tar gz');
  return m;
})();

const MEDIA_OR_IMAGE = new Set(['mp4','mov','mkv','webm','avi','flv','mp3','wav','m4a','aac','flac','ogg','opus','png','jpg','jpeg','webp','gif','svg','bmp','ico']);
const TEMP_RE = /(\/tmp\/|\\Temp\\|AppData\\Local\\Temp|\/node_modules\/|\\node_modules\\|__pycache__|\.git[\\/]|\.cache[\\/]|\.tmp$|\.log$|\.bak$|NUL$|\/dev\/null)/i;
const SWITCH_RE = /^\s*(新任务|新的一件|另一个任务|下一个任务|换个任务|换一个任务|重新开始|从头开始|从头来|另外一件事|下面做另一件)/;

const FILE_TOOLS = { write: ['file_path'], edit: ['file_path'], ops_write_file: ['path'], ops_edit_file: ['path'], ops_replace: ['path'] };

function extOf(p) {
  if (!p || typeof p !== 'string') return '';
  const s = p.trim().replace(/^["']|["']$/g, '').replace(/[?#].*$/, '');
  const b = s.split(/[\\/]/).pop() || '';
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i + 1).toLowerCase() : '';
}
function classOfExt(ext) { return EXT_CLASS[ext] || 'other'; }
function classOfPath(p) { return classOfExt(extOf(p)); }
function isTemp(p) { return TEMP_RE.test(p || ''); }
function getArg(a, keys) { for (const k of keys) if (a && a[k] != null) return a[k]; return null; }

// bash/pwsh 命令 → 产物文件路径列表（启发式，见 R5）
function parseShellProducts(cmd) {
  if (!cmd || typeof cmd !== 'string') return [];
  const out = [];
  const addPath = (p) => {
    if (!p) return;
    p = String(p).trim().replace(/^["']|["']$/g, '');
    if (!p || /^[$%&]/.test(p)) return;
    if (isTemp(p)) return;
    // 至少要像一个文件：basename 带扩展名
    const b = p.split(/[\\/]/).pop() || '';
    if (!/\.[a-z0-9]{1,8}$/i.test(b)) return;
    out.push(p);
  };
  let m;
  const re = /(?:^|[\s;&|])(?:\d?>>?)\s*("([^"]+)"|'([^']+)'|([^\s;&|>]+))/g;
  while ((m = re.exec(cmd))) addPath(m[2] || m[3] || m[4]);
  const re2 = /(?:-o|--output|--out|-OutFile|--out-file)\s+("([^"]+)"|'([^']+)'|([^\s;&|]+))/gi;
  while ((m = re2.exec(cmd))) addPath(m[2] || m[3] || m[4]);
  const re3 = /(?:Out-File|Set-Content|Add-Content)\s+(?:-FilePath\s+|-Path\s+)?("([^"]+)"|'([^']+)'|([^\s;&|]+))/gi;
  while ((m = re3.exec(cmd))) addPath(m[2] || m[3] || m[4]);
  const re4 = /\btee\s+(?:-a\s+)?("([^"]+)"|'([^']+)'|([^\s;&|]+))/gi;
  while ((m = re4.exec(cmd))) addPath(m[2] || m[3] || m[4]);
  if (/\bffmpeg(\.exe)?\b/i.test(cmd)) {
    const toks = cmd.match(/"[^"]+"|'[^']+'|\S+/g) || [];
    let last = null;
    for (let i = 0; i < toks.length; i++) {
      const raw = toks[i], t = raw.replace(/^["']|["']$/g, '');
      if (/^-i$/.test(toks[i - 1] || '')) continue;
      if (MEDIA_OR_IMAGE.has(extOf(t))) last = t;
    }
    addPath(last);
  }
  return [...new Set(out)];
}

// 通用数据源：工具名是别人的（Write / str_replace_editor / bash…），
// 靠 config.generic.productTools 认产物，不猜别的东西。DSH 数据源下这个集合为空，行为不变。
const GENERIC_PRODUCT_TOOLS = new Set((require('../config.js').cfg.generic || {}).productTools || []);

function productsOfCall(name, args) {
  const evs = [];
  const push = (p, cls) => {
    if (p && isTemp(p)) return;
    evs.push({ path: p || null, cls: cls || classOfPath(p) });
  };
  if (GENERIC_PRODUCT_TOOLS.has(name)) {
    const p = getArg(args, ['path', 'file_path', 'filePath', 'output', 'file']);
    if (p) { push(String(p)); return evs; }
    const cmd = getArg(args, ['command', 'script', 'cmd']);
    if (cmd) { for (const x of parseShellProducts(String(cmd))) push(x); return evs; }
    evs.push({ path: null, cls: 'other' });   // 认不出路径也算产物动作，类型归 other
    return evs;
  }
  if (FILE_TOOLS[name]) {
    const p = getArg(args, FILE_TOOLS[name]);
    if (p) push(String(p));
    return evs;
  }
  if (name === 'present') {
    if (Array.isArray(args && args.files)) for (const f of args.files) push(f && f.path);
    return evs;
  }
  if (name === 'generate_image' || name === 'generate_images' || name === 'edit_image') {
    evs.push({ path: null, cls: 'image' });
    return evs;
  }
  if (name === 'ffmpeg_encode' || name === 'ffmpeg_concat' || name === 'ffmpeg_cut' ||
      name === 'ffmpeg_adjust' || name === 'ffmpeg_subtitle') {
    push(args && args.output, 'media');
    return evs;
  }
  if (name === 'ffmpeg_gif') { push(args && args.output, 'image'); return evs; }
  if (name === 'ffmpeg_extract') {
    const what = args && args.what, p = args && args.output;
    if (what === 'audio') push(p, 'media');
    else if (what === 'frame') push(p, 'image');
    else if (what === 'subtitle') push(p, 'doc');
    else if (p) push(p);
    return evs;
  }
  if (name === 'qq_send_image' || name === 'qq_send_forward' || name === 'qq_send_voice' ||
      name === 'meme_qq' || name === 'send_meme') {
    evs.push({ path: null, cls: 'message' });
    return evs;
  }
  if (name === 'ops_bash' || name === 'pwsh' || name === 'bash') {
    const cmd = (args && (args.command || args.script)) || '';
    for (const p of parseShellProducts(cmd)) push(p);
    return evs;
  }
  return evs;
}

function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function quantile(a, q) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

function segmentSession(stream, cfg, meta) {
  meta = meta || {};
  const turns = new Map();
  const byId = {};
  let latest = 0;
  for (const e of stream) {
    if (e.time && e.time > latest) latest = e.time;
    const t = e.turn;
    if (e.type === 'turn_start' && t != null) {
      const T = turns.get(t) || { n: t, start: null, end: null, reason: null, user: '', calls: [], products: [] };
      T.start = e.time; turns.set(t, T);
    } else if (e.type === 'turn_end' && t != null) {
      let T = turns.get(t);
      if (!T) { T = { n: t, start: null, end: null, reason: null, user: '', calls: [], products: [] }; turns.set(t, T); }
      T.end = e.time;
      T.reason = e.reason;
    } else if (e.type === 'user_message' && t != null) {
      const T = turns.get(t);
      if (T) {
        const tx = e.text || '';
        if (tx && !/^\s*(<system-reminder>|Current runtime context|<agent-inbox>|This is a reminder)/i.test(tx)) T.user = tx.slice(0, 400);
      }
    } else if (e.type === 'tool_call' && t != null) {
      const T = turns.get(t);
      if (!T) continue;
      const call = { id: e.callId, name: e.name, step: e.step, turn: t, seq: e.seq, hasResult: false, ok: false };
      byId[call.id] = call;
      T.calls.push(call);
      for (const p of productsOfCall(call.name, e.args || {})) {
        T.products.push({ ...p, turn: t, call: call.id, name: call.name, step: call.step, seq: e.seq, verified: false });
      }
    } else if (e.type === 'tool_result') {
      const id = e.callId || null;
      const C = id && byId[id];
      if (!C) continue;
      C.hasResult = true;
      C.ok = !(e.isError === true);
    }
  }
  const list = [...turns.values()].filter(T => T.start != null).sort((a, b) => a.n - b.n);

  // 产物验证：同一 call 的 result 成功，则该 call 产出的所有事件都算 verified
  for (const T of list) for (const p of T.products) {
    const C = byId[p.call];
    p.verified = !!(C && C.hasResult && C.ok);
  }
  if (!list.length) return { meta, turns: [], tasks: [], latest };

  const events = [];
  for (const T of list) for (const p of T.products) events.push(p);

  // R1/R2：类型 run + 持续性阈值
  const runs = [];
  for (const ev of events) {
    const last = runs[runs.length - 1];
    if (last && last.cls === ev.cls) last.evs.push(ev);
    else runs.push({ cls: ev.cls, evs: [ev] });
  }
  const cuts = new Set();
  let accepted = null;
  for (const run of runs) {
    if (accepted == null) { accepted = run.cls; continue; }
    if (run.cls !== accepted && run.evs.length >= cfg.N) {
      cuts.add(run.evs[0].turn);
      accepted = run.cls;
    }
  }
  // R3：显式切换信号
  for (let i = 0; i < list.length; i++) {
    const T = list[i];
    if (cfg.useKeywords && SWITCH_RE.test(T.user || '')) cuts.add(T.n);
    if (cfg.useIdle && i > 0) {
      const prev = list[i - 1];
      if (T.start != null && prev.end != null && T.start - prev.end >= cfg.idleMs) cuts.add(T.n);
    }
  }
  // R4：按 turn 分段
  const cutTurns = [...cuts].filter(n => n > list[0].n).sort((a, b) => a - b);
  const bounds = [list[0].n, ...cutTurns];
  const tasks = [];
  for (let i = 0; i < bounds.length; i++) {
    const from = bounds[i];
    const to = i + 1 < bounds.length ? bounds[i + 1] : Infinity;
    const segTurns = list.filter(T => T.n >= from && T.n < to);
    if (!segTurns.length) continue;
    const prods = segTurns.flatMap(T => T.products);
    const first = segTurns[0], last = segTurns[segTurns.length - 1];
    const dur = (first.start != null && last.end != null) ? (last.end - first.start) / 1000 : null;
    const verifiedProds = prods.filter(p => p.verified);
    tasks.push({
      session: meta.id || '',
      idx: tasks.length + 1,
      fromTurn: first.n,
      toTurn: last.n,
      turns: segTurns.length,
      startTime: first.start,
      endTime: last.end,
      durationSec: dur,
      reason: last.reason,
      incomplete: last.end == null,
      productEvents: prods.length,
      productCalls: new Set(prods.map(p => p.call)).size,
      verifiedEvents: verifiedProds.length,
      verifiedCalls: new Set(verifiedProds.map(p => p.call)).size,
      hasVerifiedProduct: verifiedProds.length > 0,
      types: [...new Set(prods.map(p => p.cls))],
      productTools: [...new Set(prods.map(p => p.name))],
      samplePaths: prods.map(p => p.path).filter(Boolean).slice(0, 6)
    });
  }
  return { meta, turns: list, tasks, latest };
}

function gradeS2Plan(sec) {
  if (sec == null) return null;
  return sec <= 600 ? 'A' : sec <= 1800 ? 'B' : sec <= 3600 ? 'C' : sec <= 10800 ? 'D' : 'E';
}
function gradeS2User(sec) {
  if (sec == null) return null;
  return sec <= 3 ? 'A' : sec <= 10 ? 'B' : sec <= 60 ? 'C' : sec <= 300 ? 'D' : 'E';
}
function gradeDelivery(rate) {
  if (rate == null) return null;
  return rate >= 0.70 ? 'A' : rate >= 0.50 ? 'B' : rate >= 0.30 ? 'C' : rate >= 0.15 ? 'D' : 'E';
}
// 0–4 分 → 档（速度合成 3.0 → B）
function gradeScore(score) {
  if (score == null) return null;
  return score >= 3.5 ? 'A' : score >= 2.5 ? 'B' : score >= 1.5 ? 'C' : score >= 0.5 ? 'D' : 'E';
}

// 一次性读入全部会话（同一快照），敏感性分析复用，避免边跑边读导致数字互相对不上
// 事件的 seq 是数据源给的「原始顺序」，这里按它重排（等价于改造前按记录 seq 排）
function loadParsed() {
  const snap = loadCached();
  const parsed = [], errs = [];
  for (const s of snap.sessions) {
    if (s.err) { errs.push({ id: s.id, err: s.err }); continue; }
    const events = s.events.slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
    parsed.push({ id: s.id, meta: s.meta, events, recsCount: s.stats.records, parseErr: s.stats.parseErr, latest: s.stats.latestTime });
  }
  return { parsed, errs, files: snap.sessions.length, startedAt: Date.now() };
}

function run(cfg, snap) {
  const sessions = snap.parsed.map(x => ({
    ...segmentSession(x.events, cfg, x.meta),
    meta: x.meta, parseErr: x.parseErr, recs: x.recsCount, latest: x.latest
  }));
  const main = sessions.filter(s => !(s.meta.origin === 'subagent' || s.meta.parentSession));
  const withTurns = main.filter(s => s.tasks.length);
  let tasks = withTurns.flatMap(s => s.tasks);
  if (cfg.multiTurnOnly) tasks = tasks.filter(t => t.turns >= 2);
  let productTasks;
  if (cfg.strictFileProducts) {
    productTasks = tasks.filter(t => t.hasVerifiedProduct && t.types.some(x => x !== 'message'));
  } else {
    productTasks = tasks.filter(t => t.hasVerifiedProduct);
  }
  const durations = tasks.map(t => t.durationSec).filter(x => x != null && x >= 0);
  const classCount = {};
  for (const t of tasks) for (const ty of t.types) classCount[ty] = (classCount[ty] || 0) + 1;
  // S1（§1.1）：所有 turn 耗时 = turn/end − turn/start，全会话**一刀**取中位。子会话已排除。
  // 2026-11-14 更正：不用「会话内中位再全会话中位」——那会把长会话权重放大，本机实测 44.4s→C，
  // 与 §1.1 原文和历史 4.59s（全库一刀中位）对不上。
  const s1Durations = [];
  for (const s of main) for (const T of s.turns) {
    if (T.start != null && T.end != null) s1Durations.push((T.end - T.start) / 1000);
  }
  let latest = 0, earliest = Infinity, records = 0;
  for (const x of snap.parsed) {
    if (x.latest > latest) latest = x.latest;
    if (x.latest && x.latest < earliest) earliest = x.latest;
    records += x.recsCount;
  }
  return {
    startedAt: snap.startedAt, finishedAt: Date.now(), latest, earliest, records, parseErrSessions: snap.errs,
    files: snap.files,
    sessionsAll: sessions.length,
    sessionsMain: main.length,
    sessionsSub: sessions.length - main.length,
    sessionsWithTurns: withTurns.length,
    sessionsWithoutTurns: main.length - withTurns.length,
    sessionsWithVerifiedProduct: withTurns.filter(s => s.tasks.some(t => t.hasVerifiedProduct)).length,
    sessionsWithStrictFileProduct: withTurns.filter(s => s.tasks.some(t => t.hasVerifiedProduct && t.types.some(x => x !== 'message'))).length,
    noProductSessions: withTurns.filter(s => !s.tasks.some(t => t.hasVerifiedProduct)).map(s => s.meta.id),
    tasksWithoutAnyProduct: tasks.filter(t => t.productEvents === 0).length,
    tasksWithoutVerifiedProduct: tasks.filter(t => !t.hasVerifiedProduct).length,
    tasks,
    durations, classCount,
    medianSec: median(durations),
    s1MedianSec: median(s1Durations),
    rate: tasks.length ? productTasks.length / tasks.length : null,
    productTasks: productTasks.length,
    multiTurnTasks: tasks.filter(t => t.turns >= 2).length
  };
}

function stats(r) {
  const d = r.durations;
  return {
    tasksTotal: r.tasks.length,
    tasksWithDuration: d.length,
    medianSec: r.medianSec,
    p25Sec: quantile(d, 0.25),
    p75Sec: quantile(d, 0.75),
    p90Sec: quantile(d, 0.9),
    maxSec: d.length ? Math.max(...d) : null,
    tasksMultiTurn: r.multiTurnTasks,
    gradePlanS2: gradeS2Plan(r.medianSec),
    gradeUserSec: gradeS2User(r.s1MedianSec),
    s1MedianSec: r.s1MedianSec,
    tasksWithVerifiedProduct: r.productTasks,
    taskDeliveryRate: r.rate,
    deliveryGrade: gradeDelivery(r.rate),
    productClassCounts: r.classCount
  };
}

function sensRow(label, r, extra) {
  return { variant: label, tasks: r.tasks.length, tasksMultiTurn: r.multiTurnTasks, medianSec: r.medianSec,
    gradePlan: gradeS2Plan(r.medianSec), gradeUser: gradeS2User(r.medianSec),
    deliveryRate: r.rate, deliveryGrade: gradeDelivery(r.rate), ...extra };
}

function main() {
  const cfg = { ...DEFAULTS };
  const snap = loadParsed();
  const r = run(cfg, snap);
  const s = stats(r);
  const sens = [];
  for (const N of [2, 3, 4, 5]) {
    const rr = run({ ...cfg, N }, snap);
    sens.push(sensRow(`N=${N}（当前${N === cfg.N ? '★' : ''}）`, rr));
  }
  sens.push(sensRow('关掉长空闲切分', run({ ...cfg, useIdle: false }, snap)));
  sens.push(sensRow('关掉关键词切分', run({ ...cfg, useKeywords: false }, snap)));
  sens.push(sensRow('关掉长空闲+关键词', run({ ...cfg, useIdle: false, useKeywords: false }, snap)));
  sens.push(sensRow('只留 >=2 轮的跨轮任务', run({ ...cfg, multiTurnOnly: true }, snap)));
  sens.push(sensRow('交付只算文件/图片/视频（不含消息）', run({ ...cfg, strictFileProducts: true }, snap)));

  // 速度合成（§3.1）：0.75×S1 + 0.25×S2；S2 缺数据时权重归一，速度分 = S1，标「部分覆盖 7.5/10」
  const NUM = { A: 4, B: 3, C: 2, D: 1, E: 0 };
  const s1g = gradeS2User(s.s1MedianSec);
  const s2g = gradeS2Plan(s.medianSec);
  const s1s = s1g ? NUM[s1g] : null;
  const s2s = s2g ? NUM[s2g] : null;
  const speedScore = s1s == null ? null : (s2s == null ? s1s : 0.75 * s1s + 0.25 * s2s);
  const report = {
    meta: {
      title: '速度 S2（跨轮任务）+ 交付（任务级）实测',
      generatedAt: new Date().toISOString(),
      source: SESSIONS_BASE + '/' + sourceGlob(),
      plan: 'docs/计划书.md §0.8 / §1.1 / §1.2 / §4.1 / §4.2',
      script: 'src/tasks/segment.js',
      rules: { N: cfg.N, idleMs: cfg.idleMs, useIdle: cfg.useIdle, useKeywords: cfg.useKeywords,
        unit: '产物事件 = 能推出产物类型的 tool/call', classes: ['code','doc','data','image','media','message','other'] }
    },
    sample: {
      startedAt: new Date(r.startedAt).toISOString(),
      finishedAt: new Date(r.finishedAt).toISOString(),
      latestLogTime: r.latest ? new Date(r.latest).toISOString() : null,
      earliestLogTime: r.earliest && isFinite(r.earliest) ? new Date(r.earliest).toISOString() : null,
      records: r.records,
      sessionFiles: r.files,
      parseErrSessions: r.parseErrSessions,
      mainSessions: r.sessionsMain,
      subagentExcluded: r.sessionsSub,
      sessionsWithTurns: r.sessionsWithTurns,
      sessionsWithoutTurns: r.sessionsWithoutTurns,
      sessionsWithVerifiedProduct: r.sessionsWithVerifiedProduct,
      sessionsWithStrictFileProduct: r.sessionsWithStrictFileProduct,
      activeSessionDeliveryRate: r.sessionsWithTurns ? r.sessionsWithVerifiedProduct / r.sessionsWithTurns : null,
      noProductSessions: r.noProductSessions,
      tasksWithoutAnyProduct: r.tasksWithoutAnyProduct,
      tasksWithoutVerifiedProduct: r.tasksWithoutVerifiedProduct
    },
    s1: {
      medianSec: s.s1MedianSec,
      medianMs: s.s1MedianSec == null ? null : s.s1MedianSec * 1000,
      grade: s1g,
      thresholdsSec: [3, 10, 60, 300],
      rule: 'turn/end − turn/start 的全库中位（一刀），子会话排除'
    },
    s2: {
      tasksTotal: s.tasksTotal,
      tasksWithDuration: s.tasksWithDuration,
      medianSec: s.medianSec,
      medianMin: s.medianSec == null ? null : s.medianSec / 60,
      p25Sec: s.p25Sec, p75Sec: s.p75Sec, p90Sec: s.p90Sec, maxSec: s.maxSec,
      tasksMultiTurn: s.tasksMultiTurn,
      gradePlanS2: s.gradePlanS2,
      gradePlanThresholdsSec: [600, 1800, 3600, 10800],
      gradeUserSec: s.gradeUserSec,
      gradeUserThresholdsSec: [3, 10, 60, 300]
    },
    delivery: {
      tasksTotal: s.tasksTotal,
      tasksWithVerifiedProduct: s.tasksWithVerifiedProduct,
      taskDeliveryRate: s.taskDeliveryRate,
      grade: s.deliveryGrade,
      thresholds: [0.70, 0.50, 0.30, 0.15],
      productClassCounts: s.productClassCounts
    },
    speedComposite: {
      plan: {
        s1: s1s, s2: s2s,
        s1Grade: s1g, s2Grade: s2g,
        formula: '0.75*S1 + 0.25*S2（0–4 分制）',
        score: speedScore,
        grade: gradeScore(speedScore),
        coverage: s2s == null ? '7.5/10' : '10/10'
      },
      // 旧口径留档（不计入总分，collect 只读 plan）：S1×0.75 + S2×0.25 的写死快照已作废
      userLines: { note: '已停用，见 docs/计划书-交付.md §3.1' }
    },
    sensitivity: sens,
    comparison: {
      s1: { medianSec: 4.59, grade: 'B', source: '计划书 §Ⅲ.2（2026-11-11 23:0x 快照）' },
      sessionDelivery: { rate: 0.654, n: 119, d: 182, grade: 'B', source: '计划书 §Ⅲ.2（2026-11-11 23:0x 快照）' },
      sessionDeliveryAlt: { rate: 0.647, n: 112, d: 173, grade: 'B', source: '计划书 §4.5（另一时点，与 §Ⅲ.2 不一致）' }
    },
    tasks: r.tasks
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ sample: report.sample, s2: report.s2, delivery: report.delivery, sensitivity: sens }, null, 2));
}

if (require.main === module) main();
module.exports = { productsOfCall, parseShellProducts, classOfPath, segmentSession, median, quantile, gradeS2Plan, gradeS2User, gradeDelivery, loadParsed, run, stats };
