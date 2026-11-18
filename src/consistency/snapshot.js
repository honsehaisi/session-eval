// 记录记忆库版本快照：T0 / T1 各记一次，出分时能说清「答案变了」还是「设定改了」
// 用法：node src/consistency/snapshot.js [--tag t1]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const HERE = __dirname;
const MEM = require('../config.js').P.memoryDir;
const OUT = path.join(HERE, 'snapshots.json');
const SKIP_DIR = new Set(['raw', '.git', 'node_modules', '.dsh']);

const tag = (() => {
  const a = process.argv.slice(2);
  const i = a.indexOf('--tag');
  return i >= 0 && a[i + 1] ? a[i + 1] : 'latest';
})();

function isSecretPage(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    return !!(m && /^secret:\s*true\s*$/m.test(m[1]));
  } catch (e) { return false; }
}

function walk(dir, rel, acc) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    const r = rel ? rel + '/' + ent.name : ent.name;
    if (ent.isDirectory()) walk(p, r, acc);
    else if (ent.isFile()) {
      if (isSecretPage(p)) continue;
      const h = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
      acc.push({ file: r, sha256: h, bytes: fs.statSync(p).size });
    }
  }
  return acc;
}

const files = walk(MEM, '', []).sort((a, b) => a.file.localeCompare(b.file));
const manifestHash = crypto
  .createHash('sha256')
  .update(files.map((f) => f.file + ':' + f.sha256).join('\n'))
  .digest('hex');

const db = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { snapshots: [] };
db.snapshots.push({ tag, takenAt: new Date().toISOString(), fileCount: files.length, manifestHash, files });
fs.writeFileSync(OUT, JSON.stringify(db, null, 2), 'utf8');
console.log(`snapshot tag=${tag} files=${files.length} manifest=${manifestHash.slice(0, 16)} → ${OUT}`);
