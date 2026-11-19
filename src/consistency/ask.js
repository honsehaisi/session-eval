// 一致性作答清单：生成复问清单（55 题 + 固定模板 + 记忆库版本）
// 用法：node src/consistency/ask.js [--tag t0b|t1|t2] [--out xxx-plan.json]
//   --tag  t0b → t0b-plan.json，t1 → t1-plan.json，依此类推
const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const { P } = require('../config.js');
const ROOT = path.resolve(HERE, '../..');

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const tag = arg('tag', 't1');
const out = path.resolve(HERE, arg('out', `${tag}-plan.json`));

// S4 解耦：题库/模板路径走 config，缺文件给明确提示（该维按未覆盖处理），不抛 ENOENT
function readOrBail(cfgVal, fallback, label) {
  const f = cfgVal || fallback;
  if (!fs.existsSync(f)) {
    console.error('[一致性] ' + label + '缺失：' + f);
    console.error('  该维度按「未覆盖」处理；要跑 T1/T2，先在 config.json 的 paths 里指对路径。');
    process.exit(3);
  }
  return fs.readFileSync(f, 'utf8');
}
const qs = JSON.parse(readOrBail(P.qbankFile, path.join(ROOT, 'src/memory/questions.json'), '题库'));
// 与 T0′ 题面逐字对齐的三点：
// ① 先统一成 LF——T0′ 的 rendered 是 \n 换行，模板文件是 CRLF，直接切会差字节；
// ② 切分要容忍 CRLF——只按 \n---\n 切会切不掉，整段头注释混进题面；
// ③ 路径写 Windows 反斜杠形态——T0′ 的 rendered 就是 C:\Users\... 这种。
const winPath = (s) => s.replace(/\//g, '\\');
const template = readOrBail(P.consistencyTemplate, path.join(HERE, 'prompt-template.md'), '题面模板')
  .replace(/\r\n/g, '\n')
  .split('\n---\n').pop().trim()
  .split('<你的记忆库路径>').join(winPath(P.memoryDir))
  .split('<你的 DSH 目录>').join(winPath(P.dshDir));

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
