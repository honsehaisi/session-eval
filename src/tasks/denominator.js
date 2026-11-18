// 交付率分母对账：同一快照下，各种「分母」各自多少，差在哪
// 用法：node src/tasks/denominator.js
// 分类依据：会话首条 session 记录的 origin / parentSession（子代理是 origin=subagent）
const fs = require('node:fs');
const { loadSessions } = require('../zframes.js');

const ROOT = require('../config.js').P.sessionsDir;
const all = loadSessions(ROOT);

const stats = { files: all.length, subagent: 0, main: 0, unreadable: 0 };
const buckets = { anyRecord: 0, turnStart: 0, turnEnd: 0, toolCall: 0, assistantMsg: 0, userMsg: 0 };
const cross = { mainWithToolCallNoTurn: 0, mainNoRecords: 0 };

for (const s of all) {
  if (s.err) { stats.unreadable++; continue; }
  const lines = s.raw.split('\n').filter((l) => l.trim());
  let head = null;
  try { head = JSON.parse(lines[0]); } catch { }
  const isSub = head && (head.origin === 'subagent' || head.parentSession);
  if (isSub) { stats.subagent++; continue; }
  stats.main++;

  const types = new Set();
  for (const line of lines) {
    try { const o = JSON.parse(line); if (o.type) types.add(o.type); } catch { }
  }
  if (types.size) buckets.anyRecord++;
  if (types.has('turn/start')) buckets.turnStart++;
  if (types.has('turn/end')) buckets.turnEnd++;
  if (types.has('tool/call')) buckets.toolCall++;
  if (types.has('assistant/message')) buckets.assistantMsg++;
  if (types.has('user/message')) buckets.userMsg++;
  if (types.has('tool/call') && !types.has('turn/start')) cross.mainWithToolCallNoTurn++;
  if (!types.size) cross.mainNoRecords++;
}

console.log(JSON.stringify({ generatedAt: new Date().toISOString(), stats, buckets, cross }, null, 2));
