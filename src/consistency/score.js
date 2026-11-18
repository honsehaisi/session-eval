// 一致性出数：judge.json → 一致率 → 四档（§6.3）
// 用法：node score.js [--in judge.json] [--out report.json]
const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const arg = (n, d) => {
  const a = process.argv.slice(2);
  const i = a.indexOf('--' + n);
  return i >= 0 && a[i + 1] ? a[i + 1] : d;
};
const resolve = (p) => (path.isAbsolute(p) ? p : path.resolve(HERE, p));

const j = JSON.parse(fs.readFileSync(resolve(arg('in', 'judge.json')), 'utf8'));

const total = j.results.length;
const same = j.tally.same || 0;
const review = j.tally.review || 0;
const diff = j.tally.diff || 0;
const missing = j.tally.missing || 0;

// 严判：review 不白给，只有人工确认后才算一致；先按最保守口径出两个数
const strict = same / (same + diff + review + missing || 1);
const loose = (same + review) / (same + diff + review + missing || 1);
const tier = (v) => (v >= 0.9 ? 'A' : v >= 0.8 ? 'B' : v >= 0.7 ? 'C' : v >= 0.5 ? 'D' : 'E');

const out = {
  generatedAt: new Date().toISOString(),
  pair: `${j.base || 'base'} ↔ ${j.target || 'target'}`,
  total,
  tally: { same, review, diff, missing },
  rate: { strict, loose },
  tier: { strict: tier(strict), loose: tier(loose) },
  note: 'strict = 只算 same；loose = same+review（review 需人工判 20 题金标准后再定）。出正式数前必须先人工对齐规则，§6.2 判定条',
};
fs.writeFileSync(resolve(arg('out', 'report.json')), JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 1));
