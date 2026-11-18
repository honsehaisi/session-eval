// 记忆题库：把题库切成提问批次（§7.2.7 隔离规则）
// 用法：node src/memory/ask.js [--per-batch 1] [--out _work/ask-plan.json]
// 规则：H / F 题一题一批；R 题默认也一批一题（宁可慢，不让前一题的阅读污染后一题）

const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '../../');

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const perBatch = Number(arg('per-batch', '1'));
const out = path.resolve(ROOT, arg('out', '_work/ask-plan.json'));

const qsPath = require('../config.js').P.qbankFile || path.join(HERE, 'questions.json');
const qs = JSON.parse(fs.readFileSync(qsPath, 'utf8'));
const batches = [];
let cur = [];

function flush() {
  if (!cur.length) return;
  batches.push({ batchId: 'B' + String(batches.length + 1).padStart(3, '0'), questions: cur });
  cur = [];
}

for (const q of qs) {
  if (q.stale) continue;
  const isSensitive = q.type === 'H' || q.type === 'F';
  if (isSensitive) { flush(); cur = [{ id: q.id, type: q.type, prompt: q.prompt }]; flush(); continue; }
  cur.push({ id: q.id, type: q.type, prompt: q.prompt });
  if (cur.length >= perBatch) flush();
}
flush();

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), perBatch, batches }, null, 2), 'utf8');
console.log(`questions=${qs.length} batches=${batches.length} → ${out}`);
for (const b of batches) console.log(b.batchId, b.questions.map((q) => q.id).join(','));
