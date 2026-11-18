#!/usr/bin/env node
// 公开导出：按 scripts/public-manifest.json 的 allowlist 复制出一个干净目录。
// 用法：node scripts/export-public.js <目标目录>
// 目标目录必须不存在或为空；不会删除/修改源项目。
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..');
const DST = process.argv[2] ? path.resolve(process.argv[2]) : '';
if (!DST) { console.error('用法：node scripts/export-public.js <目标目录>'); process.exit(2); }
if (DST === SRC || DST.startsWith(SRC + path.sep)) {
  console.error('目标目录不能放在项目内：' + DST);
  process.exit(2);
}
if (fs.existsSync(DST) && fs.readdirSync(DST).length) {
  console.error('目标目录非空，拒绝覆盖：' + DST);
  process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'public-manifest.json'), 'utf8'));

function globToRe(g) {
  const s = String(g).replace(/\\/g, '/');
  const esc = (c) => c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  let out = '^';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '*') {
      if (s[i + 1] === '*') {
        i++;
        if (s[i + 1] === '/') { i++; out += '(?:.*/)?'; }
        else out += '.*';
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += esc(c);
    }
  }
  return new RegExp(out + '$');
}

const INC = (manifest.include || []).map(globToRe);
const EXC = (manifest.exclude || []).map(globToRe);
function matches(rel, list) { return list.some((re) => re.test(rel)); }

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'internal', '_work', '_tmp', 'eval']);
let copied = 0;

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(abs);
      continue;
    }
    if (!e.isFile()) continue;
    const rel = path.relative(SRC, abs).replace(/\\/g, '/');
    if (!matches(rel, INC) || matches(rel, EXC)) continue;
    const out = path.join(DST, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(abs, out);
    copied++;
  }
}

fs.mkdirSync(DST, { recursive: true });
walk(SRC);
console.log('已导出 ' + copied + ' 个文件 → ' + DST);
