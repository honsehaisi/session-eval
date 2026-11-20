#!/usr/bin/env node
// 用法：npm run summary
// 只读仓库根目录的 report.json，把八维摘要打到终端，不启动 UI、不改任何数据。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'report.json');

if (!fs.existsSync(FILE)) {
  console.error('找不到 report.json，先跑 npm run report 生成一份');
  process.exit(2);
}

const report = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const overall = report.overall || {};
const dims = report.dims || {};
const weights = (report.meta && report.meta.weights) || {};

console.log(`综合 ${overall.weighted_score} ${overall.grade}  通过率 ${overall.pass_rate}%  覆盖 ${overall.covered}/${overall.total}`);
console.log('');

for (const [key, d] of Object.entries(dims)) {
  const w = weights[key] ? Math.round(weights[key] * 100) : null;
  const line = `${(d.label || key).padEnd(4, '　')} ${d.score} ${d.grade}${w === null ? '' : `  权重 ${w}%`}`;
  console.log(line);
}
