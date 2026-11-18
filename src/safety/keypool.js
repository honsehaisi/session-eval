// 密钥轮换清单：从日志里汇总明文密钥值（打码输出），统计出现次数与会话分布
// 关键字正则与前缀在 rules/safety.json 的 identity.keyPool（S3 外置）。
const SESS = require('./sessions.json');
const KP = require('../rules.js').load().identity.keyPool;
const SK = new RegExp(KP.sk.src, KP.sk.flags);
const BEARER = new RegExp(KP.bearer.src, KP.bearer.flags);
const HEX = new RegExp(KP.hexToken.src, KP.hexToken.flags);
const mask = s => s.slice(0, 6) + '…' + s.slice(-4) + ' (' + s.length + '字符)';
const pool = {};
const add = (v, kind, S, t) => {
  (pool[v] = pool[v] || { kind, n: 0, sess: new Set(), turns: [] });
  pool[v].n++; pool[v].sess.add(S.id.slice(0, 8)); if (pool[v].turns.length < 3) pool[v].turns.push(t);
};
for (const S of SESS) for (const t in S.turns) for (const c of S.turns[t].calls) {
  const s = String(c.arg || '') + String((c.a || {}).command || '');
  for (const m of s.matchAll(SK)) add(m[0], 'siliconflow-key', S, t);
  for (const m of s.matchAll(BEARER)) add(m[1], 'bearer-token', S, t);
  for (const m of s.matchAll(HEX)) if (m[1].startsWith(KP.napcatPrefix)) add(m[1], 'napcat-token?', S, t);
}
const list = Object.entries(pool).sort((a, b) => b[1].n - a[1].n);
console.log('唯一明文值', list.length, '个\n');
for (const [v, o] of list) console.log([o.kind, mask(v), 'x' + o.n, '会话 ' + o.sess.size, 't' + o.turns.join(',')].join(' | '));
