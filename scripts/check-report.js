#!/usr/bin/env node
// 校验 report/report.html：内嵌 JSON 与 report.json 一致、无外链、未覆盖显示正确、等级表情齐全
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const report = JSON.parse(fs.readFileSync(path.join(ROOT, 'report.json'), 'utf8'));
const html = fs.readFileSync(path.join(ROOT, 'report', 'report.html'), 'utf8');

function fail(msg) { console.error('FAIL ' + msg); process.exit(1); }
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => deepEqual(a[k], b[k]));
}

// 1. 提取内嵌 JSON
const m = html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/);
if (!m) fail('找不到 report-data 脚本');
let embedded;
try { embedded = JSON.parse(m[1]); } catch (e) { fail('内嵌 JSON 解析失败: ' + e.message); }
if (!deepEqual(embedded, report)) fail('内嵌数据与 report.json 不一致');

// 2. 无外链 / 无 CDN
if (/https?:\/\//.test(html)) fail('HTML 含外链（要求离线可开）');

// 3. 八维全部覆盖渲染
['safety','stability','delivery','honesty','memory','speed','cost','consistency'].forEach(id => {
  if (!html.includes("['" + id + "'")) fail('模板 DIMS 缺 ' + id);
});

// 4. 未覆盖显示「未覆盖」而不是 0 分
if (!html.includes('未覆盖')) fail('缺少未覆盖文案');
if (report.dims.consistency.score !== null) fail('一致性应为未覆盖（score=null）');

// 5. overall 三个数齐全
const o = report.overall || {};
if (typeof o.weighted_score !== 'number') fail('overall.weighted_score 缺失');
if (!o.grade) fail('overall.grade 缺失');
if (typeof o.pass_rate !== 'number') fail('overall.pass_rate 缺失');
if (!Array.isArray(o.lowest) || !o.lowest.length) fail('overall.lowest 缺失');

// 6. 等级表情包：每个出现过的等级都要有图，且都是内联 data URI
const mm = html.match(/<script id="meme-data" type="application\/json">([\s\S]*?)<\/script>/);
if (!mm) fail('找不到 meme-data 脚本');
let memes;
try { memes = JSON.parse(mm[1]); } catch (e) { fail('meme-data 解析失败: ' + e.message); }
const NEED = ['a', 'b', 'c', 'd', 'e', 'none', 'overall', 'sticker-sleep', 'sticker-meal'];
NEED.forEach(k => {
  if (!memes[k]) fail('缺表情图 ' + k);
  if (!/^data:image\/jpeg;base64,/.test(memes[k])) fail('表情图 ' + k + ' 不是内联 jpeg');
});
const key = g => {
  if (!g) return 'none';
  const s = String(g).toLowerCase();
  if (s === 'uncovered' || s === 'none') return 'none';
  return /^[abcde]$/.test(s) ? s : 'none';
};
const used = new Set([key(o.grade)]);
Object.keys(report.dims).forEach(id => used.add(key(report.dims[id].grade)));
used.forEach(k => { if (!memes[k]) fail('等级 ' + k + ' 没有配表情'); });
const inlineCount = (html.match(/data:image\/jpeg;base64,/g) || []).length;
if (inlineCount < NEED.length) fail('内联表情图数量不足：' + inlineCount + ' < ' + NEED.length);

// 7. 综合卡四格都要有等级表情（渲染侧断言在 tests/report-ui.test.js）
if (!html.includes('function gradeFromScore')) fail('缺 gradeFromScore（四格分层）');
if (!html.includes('.cell-sm .meme-cell')) fail('缺四格表情样式');
if (!html.includes('memeTag(coverK')) fail('已覆盖格没配表情');
if (!html.includes('memeTag(passK')) fail('合格率格没配表情');
if (!html.includes('memeTag(lowK')) fail('最低维度格没配表情');

// 8. 体积上限：表情图内联后仍要轻
if (html.length > 1024 * 1024) fail('report.html 超过 1MB：' + html.length);

console.log('PASS report.html 与 report.json 一致；无外链；八维齐全；未覆盖正确；等级表情齐全（' + inlineCount + ' 张内联）');
console.log('overall: ' + o.weighted_score + ' / ' + o.grade + ' / 合格率 ' + o.pass_rate + '% / 最低 ' + o.lowest.map(x => (x.label || x.dim) + x.grade).join(','));
