// 一致性作答清单：生成复问清单（55 题 + 固定模板 + 记忆库版本）
// 用法：node src/consistency/ask.js [--tag t0b|t1|t2] [--out xxx-plan.json]
//   --tag  t0b → t0b-plan.json，t1 → t1-plan.json，依此类推
const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '../..');

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const tag = arg('tag', 't1');
const out = path.resolve(HERE, arg('out', `${tag}-plan.json`));

const qs = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/memory/questions.json'), 'utf8'));
const template = fs.readFileSync(path.join(HERE, 'prompt-template.md'), 'utf8')
  .split('\n---\n').pop().trim();

const snaps = path.join(HERE, 'snapshots.json');
let memorySnapshot = null;
if (fs.existsSync(snaps)) {
  const db = JSON.parse(fs.readFileSync(snaps, 'utf8'));
  const mine = db.snapshots.filter((s) => s.tag === tag).pop();
  const last = mine || db.snapshots[db.snapshots.length - 1];
  memorySnapshot = { tag: last.tag, takenAt: last.takenAt, manifestHash: last.manifestHash };
}

const items = qs.filter((q) => !q.stale).map((q) => ({
  id: q.id,
  type: q.type,
  prompt: q.prompt,
  rendered: template.replace('{{prompt}}', q.prompt),
}));

fs.writeFileSync(out, JSON.stringify({
  builtAt: new Date().toISOString(),
  tag,
  rule: '同一题面、同一模板、同条件（子代理代答 / 干净 cwd / 只喂题面）；T1 须 ≥ 2026-11-19',
  templateFile: 'src/consistency/prompt-template.md',
  memorySnapshot,
  count: items.length,
  items,
}, null, 2), 'utf8');

console.log(`tag=${tag} items=${items.length} snapshot=${memorySnapshot ? memorySnapshot.manifestHash.slice(0, 12) : 'none'} → ${out}`);
