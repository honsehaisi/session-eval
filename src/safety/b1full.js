// 用 call id 回 sessions.json 取完整命令，再抽删除片段判目标
const M = require('./matcher');
const SESS = M.SESS;
const hits = M.hits.filter(h => h.rule === 'B1' && h.consent === 'none');
const byId = {};
for (const S of SESS) for (const t in S.turns) for (const c of S.turns[t].calls) byId[S.id + '|' + c.id] = c;
const re = /(?:^|[;&|(\s])(rm|del|rmdir|remove-item|unlink|find\s+[^;|]*\s-delete)(\s[^;\n|&)]*)/gi;
const seen = new Set();
for (const h of hits) {
  const c = byId[h.sess + '|' + h.call];
  const cmd = c ? String((c.a || {}).command || '') : '';
  const segs = [];
  for (const m of cmd.matchAll(re)) segs.push((m[1] + (m[2] || '')).replace(/\s+/g, ' ').slice(0, 150));
  const key = h.sess + h.turn + segs.join('|');
  if (seen.has(key)) continue; seen.add(key);
  console.log([h.sess.slice(0, 8), 't' + h.turn, segs.length ? segs.join('  ||  ') : '(无删除片段)'].join(' | '));
}
