// A/B 快照对照：save 存一份产物指纹，cmp 比两份。改规则/口径前后用它确认「除时间戳外一字不差」。
//   node scripts/ab-check.js save before
//   node scripts/ab-check.js cmp before after
// 指纹存在 _work/ab-<label>.json（已 gitignore）。
// 规则：JSON 里只抹时间戳/路径这类每跑必变的字段，其余逐字节比。
// seq.json 不在 run-all 里（单独跑 src/safety/seq.js），不在本表内；它的基线对照是 _work/s2-after/seq.json。
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '_work');
const FILES = [
  'report.json',
  'src/cost/sess.json',
  'src/honesty/report.json',
  'src/safety/report.json',
  'src/safety/a2.json',
  'src/tasks/report.json',
  'src/tasks/reconcile.json',
  'src/stability/report.json',
  'src/delivery/report.json',
];

const VOLATILE = new Set(['generated_at', 'generatedAt', 'generated', 'timestamp', 'source', 'dir']);
// 跑一次就会变的字段：本次 A/B 踩到的坑——tasks/report.json 的 startedAt/finishedAt 不在上面那张表里，
// 于是「同配置跑两遍」被误报成基线破了。日志里的 earliestLogTime / endTime 这类是数据，不能抹。
const VOLATILE_RE = /^(generated|started|finished|built|judged|taken|updated|created|scanned)(At|_at)?$/i;
const isVolatile = (k) => VOLATILE.has(k) || VOLATILE_RE.test(k);

function norm(v) {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) if (!isVolatile(k)) o[k] = norm(v[k]);
    return o;
  }
  return v;
}
function fingerprint(file) {
  const buf = fs.readFileSync(file);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  let canon = null;
  try { canon = JSON.stringify(norm(JSON.parse(buf.toString('utf8')))); } catch (e) { /* 非 JSON */ }
  return { sha, bytes: buf.length, canon };
}

const cmd = process.argv[2];
const label = process.argv[3];
if (!cmd || !label) { console.log('用法: node scripts/ab-check.js save|cmp <label> [label2]'); process.exit(2); }

if (cmd === 'save') {
  const snap = { at: new Date().toISOString(), config: process.env.SYSEVAL_CONFIG || '(默认 config.json)', files: {} };
  for (const f of FILES) {
    const p = path.join(ROOT, f);
    snap.files[f] = fs.existsSync(p) ? fingerprint(p) : { absent: true };
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, 'ab-' + label + '.json');
  fs.writeFileSync(out, JSON.stringify(snap, null, 1));
  console.log('已存 ' + out);
  for (const f of FILES) console.log('  ' + f.padEnd(28) + (snap.files[f].absent ? '(缺)' : snap.files[f].sha.slice(0, 16) + ' ' + snap.files[f].bytes));
} else if (cmd === 'cmp') {
  const other = process.argv[4];
  if (!other) { console.log('cmp 需要两个 label'); process.exit(2); }
  const load = (l) => JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'ab-' + l + '.json'), 'utf8'));
  const a = load(label), b = load(other);
  let diff = 0;
  for (const f of FILES) {
    const x = a.files[f], y = b.files[f];
    if (!x || !y) { console.log('? ' + f + ' 两次快照都没记'); diff++; continue; }
    if (x.absent && y.absent) { console.log('✓ ' + f + '（两跑都没生成）'); continue; }
    if (x.absent || y.absent) { console.log('✗ ' + f + ' 只有一跑生成了'); diff++; continue; }
    const same = x.canon && y.canon ? x.canon === y.canon : x.sha === y.sha;
    if (!same) {
      diff++;
      console.log('✗ ' + f + '  ' + x.sha.slice(0, 16) + ' ≠ ' + y.sha.slice(0, 16));
    } else {
      console.log('✓ ' + f + (x.sha !== y.sha ? '（仅时间戳/路径不同）' : ''));
    }
  }
  console.log(diff ? '\n有 ' + diff + ' 个产物不同 —— 基线破了，别提交。' : '\n全部一致：基线不变。');
  process.exit(diff ? 1 : 0);
} else {
  console.log('未知命令: ' + cmd);
  process.exit(2);
}
