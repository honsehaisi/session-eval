#!/usr/bin/env node
// 构建 report/report.html：把 report.json 与等级表情包注入模板，产出单文件、离线可开
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MEME_DIR = path.join(ROOT, 'report', 'memes');
const MAX_BYTES = 1024 * 1024;   // 单文件上限：表情图内联后仍要控制住体积
const NEED = ['a', 'b', 'c', 'd', 'e', 'none', 'overall'];

const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'report.json'), 'utf8'));
const tpl = fs.readFileSync(path.join(ROOT, 'report', 'template.html'), 'utf8');

// JSON 内嵌进 <script> 前转义 <，避免提前闭合；数据本身不含 </script>
const json = JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
if (!tpl.includes('__REPORT_JSON__')) throw new Error('模板缺少 __REPORT_JSON__ 占位');
if (!tpl.includes('__MEMES_JSON__')) throw new Error('模板缺少 __MEMES_JSON__ 占位');

// 表情包：report/memes/<键>.jpg → data URI。缺图直接报错，不静默产出没图的报告
// 必需的 7 张按 NEED 逐个校验，装饰贴纸（sticker-*）有就带上
const memes = {};
for (const key of NEED) {
  const f = path.join(MEME_DIR, key + '.jpg');
  if (!fs.existsSync(f)) throw new Error('缺表情图：report/memes/' + key + '.jpg（先跑 node scripts/sync-memes.js）');
}
for (const f of fs.readdirSync(MEME_DIR)) {
  if (!f.endsWith('.jpg')) continue;
  const key = f.slice(0, -4);
  if (!NEED.includes(key) && !key.startsWith('sticker-')) continue;
  memes[key] = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(MEME_DIR, f)).toString('base64');
}

const out = tpl
  .replace('__REPORT_JSON__', json)
  .replace('__MEMES_JSON__', JSON.stringify(memes).replace(/</g, '\\u003c'));
if (out.length > MAX_BYTES) {
  throw new Error('report.html 超上限：' + out.length + ' > ' + MAX_BYTES + ' 字节（检查表情图尺寸）');
}
fs.writeFileSync(path.join(ROOT, 'report', 'report.html'), out);
console.log('built report/report.html', out.length, 'chars,', Object.keys(memes).length, 'memes');
