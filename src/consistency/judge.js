// 一致性判分：比对两次作答（默认 T0′ ↔ T1）
// 用法：
//   node judge.js                                              # answers-t0b.json ↔ answers-t1.json
//   node judge.js --base a.json --target b.json --out j.json   # 换配对
// 纯函数在 lib.js；本文件只做读写
//
// 注意：answers 里的 `verdict` 统一记 `hit`（表示「有作答」），一致性只由 `answer` 决定。
// 不要拿 autoVerdict 去填——那是记忆维「答对没」的口径，会把换说法的正确作答短路成 diff
// （2026-11-20 独立验证时踩过：20 条里 8 条假红就是这个原因）。
const fs = require('node:fs');
const path = require('node:path');
const { classify } = require('./lib.js');

const HERE = __dirname;
const arg = (n, d) => {
  const a = process.argv.slice(2);
  const i = a.indexOf('--' + n);
  return i >= 0 && a[i + 1] ? a[i + 1] : d;
};
const resolve = (p) => (path.isAbsolute(p) ? p : path.resolve(HERE, p));

const BASE = resolve(arg('base', 'answers-t0b.json'));
const TARGET = resolve(arg('target', 'answers-t1.json'));
const OUT = resolve(arg('out', 'judge.json'));

for (const f of [BASE, TARGET]) {
  if (!fs.existsSync(f)) {
    console.error(`缺文件：${f}\n先跑完两次作答（见 README），再来判。`);
    process.exit(2);
  }
}

const readItems = (f) => {
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  return (Array.isArray(raw) ? raw : raw.items).filter((x) => !x.stale);
};
const base = readItems(BASE);
const target = new Map(readItems(TARGET).map((x) => [x.id, x]));

const results = base.map((a) => {
  const b = target.get(a.id);
  const r = classify(a, b);
  return { id: a.id, ...r, base: a.answer, target: b ? b.answer : undefined };
});

const tally = {};
for (const r of results) tally[r.verdict] = (tally[r.verdict] || 0) + 1;

fs.writeFileSync(OUT, JSON.stringify({
  judgedAt: new Date().toISOString(),
  base: path.basename(BASE),
  target: path.basename(TARGET),
  tally,
  results,
}, null, 2), 'utf8');

console.log(JSON.stringify(tally));
for (const r of results) {
  if (r.verdict !== 'same') {
    console.log('  ', r.id, r.verdict, '|', r.why, '||', String(r.base || '').slice(0, 40), '=>', String(r.target || '').slice(0, 40));
  }
}
