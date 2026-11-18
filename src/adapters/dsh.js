// DSH 适配器：整个仓库里**只有这一层**知道 DSH 的日志长什么样。
// 职责：目录布局 + 多帧 zstd + 记录类型 → 标准事件（core 只认后者）。
//
// 标准事件（v1，按文件顺序给出，带 seq 便于需要时重排）：
//   turn_start    {turn, seq, time}
//   turn_end      {turn, reason, reasonKind, seq, time}
//   user_message  {text, seq, time}                     ← DSH 的用户消息没有 turn，归属由 core 判
//   assistant_text{turn, step, texts:[...], text, seq, time}
//   usage         {turn, step, usage:{inputTokens,...}, seq, time}   ← DSH 把 usage 挂在 assistant/message 上
//   tool_call     {turn, step, callId, name, args, rawArgs, seq, time}
//   tool_result   {turn, step, callId, text, isError, seq, time}
//   approval_asked{turn, id, callId, tool, reason, seq, time}
//   approval_decided{turn, id, outcome, seq, time}
//   policy        {turn, name, data, seq, time}          ← sandbox/mode | approval/policy | permission/preset
//   command       {turn, name, args, sourceKind, seq, time}
//
// 别的数据源（Claude Code / Cursor / 自建）只要按这张表产出事件，core 不用改。
'use strict';
const fs = require('fs');
const path = require('path');
const { decompressAll } = require('../zframes.js');

const SESSION_FILE = 'session.v4.jsonl.zstd';
const SOURCE_GLOB = '**/' + SESSION_FILE;   // 报 surface 用：告诉 core「这份目录按什么模式找会话」
const EVENT_TYPES = ['turn_start', 'turn_end', 'user_message', 'assistant_text', 'usage',
  'tool_call', 'tool_result', 'approval_asked', 'approval_decided', 'policy', 'command'];

// content 块 → 文本；块数组里空文本也保留（与既有口径一致）
function textAll(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(b => b && b.type === 'text').map(b => b.text).join('\n');
}
// 助手消息的文本块按块保留：下游有的按块计数，有的整体 join
function textBlocks(content) {
  if (!Array.isArray(content)) return typeof content === 'string' && content ? [content] : [];
  return content.filter(b => b && b.type === 'text' && b.text).map(b => b.text);
}

function toEvents(recs) {
  const out = [];
  for (const r of recs) {
    if (!r || !r.type) continue;
    const d = r.data || {};
    const seq = r.seq, time = r.time;
    switch (r.type) {
      case 'turn/start':
        if (d.turn != null) out.push({ type: 'turn_start', turn: d.turn, seq, time });
        break;
      case 'turn/end':
        out.push({
          type: 'turn_end', turn: d.turn,
          reason: (d.reason && d.reason.kind) || String(d.reason == null ? '' : d.reason),
          reasonKind: (d.reason && d.reason.kind) || null, seq, time,
        });
        break;
      case 'user/message':
        out.push({ type: 'user_message', text: textAll(d.content), seq, time });
        break;
      case 'assistant/message': {
        const blocks = textBlocks(d.message && d.message.content);
        out.push({ type: 'assistant_text', turn: d.turn, step: d.step, texts: blocks, text: blocks.join('\n'), seq, time });
        if (d.usage) out.push({ type: 'usage', turn: d.turn, step: d.step, usage: d.usage, seq, time });
        break;
      }
      case 'tool/call': {
        const raw = String(d.arguments == null ? '' : d.arguments);
        let args = {};
        try { args = JSON.parse(raw || '{}'); } catch (e) { args = { __raw: d.arguments }; }
        out.push({ type: 'tool_call', turn: d.turn, step: d.step, callId: d.callId, name: d.name, args, rawArgs: raw, seq, time });
        break;
      }
      case 'tool/result': {
        const m = d.message || {};
        const callId = d.toolCallId || m.toolCallId || (m.source && m.source.callId);
        out.push({ type: 'tool_result', turn: d.turn, step: d.step, callId, text: textAll(m.content), isError: m.isError === true, seq, time });
        break;
      }
      case 'approval/asked':
        out.push({ type: 'approval_asked', turn: d.turn, id: d.id, callId: d.callId, tool: d.toolName, reason: d.reason, seq, time });
        break;
      case 'approval/decided':
        out.push({ type: 'approval_decided', turn: d.turn, id: d.id, outcome: d.outcome, seq, time });
        break;
      case 'sandbox/mode':
      case 'approval/policy':
      case 'permission/preset':
        out.push({ type: 'policy', turn: d.turn, name: r.type, data: d, seq, time });
        break;
      case 'compaction/summary':
        // 压缩摘要也烧 token：口径上算成本，不算对话事件
        if (d.usage) out.push({ type: 'usage', turn: d.turn, step: null, usage: d.usage, source: 'compaction', seq, time });
        break;
      case 'command/run':
        out.push({ type: 'command', turn: d.turn, name: d.name, args: d.args, sourceKind: (d.source && d.source.kind), seq, time });
        break;
      default:
        break;
    }
  }
  return out;
}

function parseSession(file) {
  let raw;
  try { raw = decompressAll(fs.readFileSync(file)).toString('utf8'); }
  catch (e) { return { err: e.message }; }
  const recs = [];
  let parseErr = 0;
  for (const l of raw.split('\n')) {
    if (!l) continue;
    try { recs.push(JSON.parse(l)); } catch (e) { parseErr++; }
  }
  return { recs, parseErr };
}

function listSessionFiles(base) {
  const files = [];
  let dirs = [];
  try { dirs = fs.readdirSync(base); } catch (e) { return files; }
  for (const d of dirs) {
    const sd = path.join(base, d);
    let st; try { st = fs.statSync(sd); } catch (e) { continue; }
    if (!st.isDirectory()) continue;
    for (const s of fs.readdirSync(sd)) {
      const f = path.join(sd, s, SESSION_FILE);
      if (fs.existsSync(f)) files.push({ f, dir: d, id: s });
    }
  }
  return files;
}

// 一个目录 → 会话数组。withRecords=true 时额外保留原始记录（只有格式审计工具用）。
function listSessions(base, opts) {
  const withRecords = !!(opts && opts.withRecords);
  const out = [];
  for (const f of listSessionFiles(base)) {
    const p = parseSession(f.f);
    if (p.err) { out.push({ id: f.id, dir: f.dir, err: p.err, meta: {}, events: [], records: [] }); continue; }
    const metaRec = p.recs.find(r => r.type === 'session') || {};
    let latestTime = 0;
    for (const r of p.recs) if (r.time && r.time > latestTime) latestTime = r.time;
    out.push({
      id: f.id, dir: f.dir,
      meta: {
        id: metaRec.id || f.id,
        createdAt: metaRec.createdAt || 0,
        cwd: metaRec.cwd || '',
        parentSession: metaRec.parentSession || null,
        delegationDepth: metaRec.delegationDepth || 0,
        origin: metaRec.origin || 'main',
        isSeeded: !!metaRec.isSeeded,
      },
      events: toEvents(p.recs),
      stats: { records: p.recs.length, parseErr: p.parseErr, latestTime, bytes: fs.statSync(f.f).size },
      records: withRecords ? p.recs : undefined,
    });
  }
  return out;
}

module.exports = { SESSION_FILE, SOURCE_GLOB, EVENT_TYPES, listSessions, listSessionFiles, parseSession, toEvents, textAll, textBlocks, sourceGlob: () => SOURCE_GLOB };
