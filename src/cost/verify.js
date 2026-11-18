// 成本口径校验 v2：标准事件里 usage 的自洽性（total == input+output+cacheRead+cacheWrite）
// 只读事件流，不碰日志容器格式。
const { loadCached } = require('../dataset.js');

const stats = { sessions: 0, events: 0, usage: 0, sumMatch: 0, sumBad: 0, badSamples: [], fields: new Set(), types: {} };
for (const sess of loadCached().sessions) {
  if (sess.err) { console.log('SESSION FAIL', sess.id, sess.err); continue; }
  stats.sessions++;
  for (const e of sess.events) {
    stats.events++;
    stats.types[e.type] = (stats.types[e.type] || 0) + 1;
    if (e.type !== 'usage') continue;
    stats.usage++;
    const u = e.usage;
    Object.keys(u).forEach(k => stats.fields.add(k));
    const sum = (u.inputTokens || 0) + (u.outputTokens || 0) + (u.cacheReadTokens || 0) + (u.cacheWriteTokens || 0);
    if (sum === u.totalTokens) stats.sumMatch++;
    else { stats.sumBad++; if (stats.badSamples.length < 5) stats.badSamples.push({ sess: sess.id, turn: e.turn, u }); }
  }
}
console.log('sessions', stats.sessions, 'events', stats.events, 'usage', stats.usage);
console.log('usage fields:', [...stats.fields].join(','));
console.log('event types:', JSON.stringify(stats.types));
console.log('total==sum:', stats.sumMatch, '  mismatch:', stats.sumBad);
console.log(JSON.stringify(stats.badSamples, null, 1).slice(0, 1500));
