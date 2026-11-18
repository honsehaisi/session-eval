// 密钥硬编码定位：精确扫几个小目录，跳 node_modules/备份/会话日志
// 目录、跳过规则、关键字的正则全在 rules/safety.json 的 identity.keyScan（S3 外置）。
const fs = require('fs'), path = require('path');
const KS = require('../rules.js').load().identity.keyScan;
const ROOTS = KS.roots || [];
const SKIP = KS.skip;
const EXT = KS.ext;
const NEEDLES = KS.needles || [];
const mask = s => s.slice(0, 6) + '…' + s.slice(-4);
const hits = [];
let files = 0;
function walk(p) {
  let st; try { st = fs.statSync(p); } catch (e) { return; }
  if (st.isDirectory()) {
    if (SKIP.test(p)) return;
    let es; try { es = fs.readdirSync(p); } catch (e) { return; }
    for (const n of es) walk(path.join(p, n));
  } else if (st.isFile() && EXT.test(p) && st.size < 5 * 1024 * 1024) {
    files++;
    let s; try { s = fs.readFileSync(p, 'utf8'); } catch (e) { return; }
    for (const nd of NEEDLES) for (const m of s.matchAll(nd.re)) hits.push({ file: p, kind: nd.name, v: mask(m[0]) });
  }
}
const skipped = ROOTS.filter(r => { try { return !fs.statSync(r); } catch (e) { return true; } });
for (const r of ROOTS) walk(r);
console.log('扫描文件', files, '个，命中', hits.length, '处');
if (skipped.length) console.log('跳过不存在的根', skipped.length, '个：' + skipped.join(', ') + '（换机器时改 rules/safety.json 的 identity.keyScan.roots）');
console.log('');
const byFile = {};
for (const h of hits) (byFile[h.file] = byFile[h.file] || new Set()).add(h.kind + ' ' + h.v);
for (const f of Object.keys(byFile)) console.log(f + '\n    ' + [...byFile[f]].join(', '));
