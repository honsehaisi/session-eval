#!/usr/bin/env node
// 公开仓泄漏扫描：路径规则 + 内容标记 + 可选 git 历史。
//   node scripts/check-public.js [目录]
//   node scripts/check-public.js --staged     只查暂存区新增/修改（pre-commit）
//   node scripts/check-public.js --history    查全部 git 历史（pre-push/CI）
// 退出码：0 干净；1 有命中；2 用法/不是 git 仓库。
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const argv = process.argv.slice(2);
const staged = argv.includes('--staged');
const history = argv.includes('--history');
const positional = argv.filter((a) => !a.startsWith('--'));
const TARGET = path.resolve(positional[0] || '.');

if (!fs.existsSync(TARGET)) { console.error('目标不存在：' + TARGET); process.exit(2); }

const PATH_RULES = [
  [/^_work\//, '内部开发目录 _work'],
  [/^_tmp\//, '临时开发目录 _tmp'],
  [/^internal\//, '保险箱/受保护目录 internal'],
  [/^rules\/safety\.local\.json$/, '本机 identity 覆盖'],
  [/^report\.json$/, '本机报告'],
  [/^report\/report\.html$/, '本机报告页'],
  [/^sess\.json$/, '本机会话快照'],
  [/^src\/safetysessions\.json$/, '会话快照'],
  [/^src\/safety\/sessions\.json$/, '会话快照'],
  [/^src\/.*\/report\.json$/, '维度本机产物'],
  [/^src\/cost\/sess\.json$/, '成本本机数据'],
  [/^src\/tasks\/reconcile\.json$/, '任务本机数据'],
  [/^src\/honesty\/(claims-all|out-|report)/, '诚实本机数据'],
  [/^src\/safety\/(a2|sample|c7-hits|seq)\.json$/, '安全本机数据'],
  [/^src\/safety\/报告-安全维度v1\.md$/, '安全内部报告'],
  [/^src\/memory\/(questions|answers|report|report-offline|verdict-overrides)\.json$/, '记忆题库/证据'],
  [/^src\/consistency\/(answers-t0b|t0b-plan|t1-plan|snapshots)\.json$/, '一致性本机数据'],
  [/^docs\/(计划|实测|新会话开工单|审查报告|UI改造|开工单-UI改造|桌面版-使用与打包|记忆复测|ui-v2)/, '内部文档'],
  [/^app\/_mkicon/, '开发脚本'],
  [/^app\/eval\//, '打包中间件'],
];

const CONTENT = [
  '20927',
  '2092747190',
  '3447176939',
  '3915346387',
  'da8033',
  'D:/大肥鱼',
  'D:\\\\大肥鱼',
  'C:/Users/20927',
  'C:\\\\Users\\\\20927',
  'whale-work',
  '新会话开工单',
  'safetysessions',
];
const CONTENT_RE = CONTENT.join('|');
const SKIP_CONTENT = new Set(['scripts/check-public.js']);
const BINARY_EXT = /\.(jpg|jpeg|png|gif|webp|ico|pdf|zip|zst|zstd|bin|exe|dll|woff2?|ttf)$/i;

const hits = [];
function add(kind, rel, detail) {
  hits.push({ kind, rel: rel.replace(/\\/g, '/'), detail });
}

function checkPath(rel) {
  const r = rel.replace(/\\/g, '/');
  for (const [re, why] of PATH_RULES) {
    if (re.test(r)) { add('PATH', r, why); return; }
  }
}

function checkText(rel, text) {
  const r = rel.replace(/\\/g, '/');
  if (SKIP_CONTENT.has(r) || BINARY_EXT.test(r)) return;
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(new RegExp(CONTENT_RE));
    if (m) add('TEXT', r + ':' + (i + 1), m[0]);
  }
}

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules' || e.name === 'dist') continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) { walk(abs); continue; }
    if (!e.isFile()) continue;
    const rel = path.relative(TARGET, abs);
    checkPath(rel);
    let st = null;
    try { st = fs.statSync(abs); } catch (err) { continue; }
    if (st.size > 4 * 1024 * 1024) continue;
    let buf = null;
    try { buf = fs.readFileSync(abs); } catch (err) { continue; }
    if (buf.includes(0)) continue;
    checkText(rel, buf.toString('utf8'));
  }
}

function git(args, opts) {
  return execFileSync('git', args, Object.assign({ cwd: TARGET, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }, opts || {}));
}

function stagedScan() {
  let list = '';
  try { list = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']); } catch (e) {
    console.error('[check-public] 不是 git 仓库或 git 不可用：' + e.message);
    process.exit(2);
  }
  for (const rel of list.split('\n').filter(Boolean)) {
    checkPath(rel);
    const abs = path.join(TARGET, rel);
    if (!fs.existsSync(abs)) continue;
    const st = fs.statSync(abs);
    if (st.size > 4 * 1024 * 1024) continue;
    const buf = fs.readFileSync(abs);
    if (buf.includes(0)) continue;
    checkText(rel, buf.toString('utf8'));
  }
}

function historyScan() {
  let revs = '';
  try { revs = git(['rev-list', '--all']); } catch (e) {
    console.error('[check-public] 不是 git 仓库或 git 不可用：' + e.message);
    process.exit(2);
  }
  for (const rev of revs.split('\n').filter(Boolean)) {
    let tree = '';
    try { tree = git(['ls-tree', '-r', '--name-only', rev]); } catch (e) { continue; }
    for (const rel of tree.split('\n').filter(Boolean)) checkPath(rel);
    let out = '';
    try {
      out = git(['grep', '-n', '-I', '-E', CONTENT_RE, rev, '--', '.']);
    } catch (e) {
      if (e.status !== 1) { /* 有些 rev 没有可 grep 的内容 */ }
      continue;
    }
    for (const line of out.split('\n').filter(Boolean)) {
      const parts = line.split(':');
      const rel = (parts[1] || '').replace(/^\.\//, '');
      if (SKIP_CONTENT.has(rel) || BINARY_EXT.test(rel)) continue;
      add('HISTORY', rev.slice(0, 8) + ':' + rel, parts.slice(2).join(':').slice(0, 160));
    }
  }
}

if (history) historyScan();
else if (staged) stagedScan();
else walk(TARGET);

if (hits.length) {
  console.error('[check-public] 发现 ' + hits.length + ' 处不该公开的内容：');
  for (const h of hits.slice(0, 100)) console.error('  ' + h.kind.padEnd(7) + ' ' + h.rel + '  ' + h.detail);
  if (hits.length > 100) console.error('  ... 还有 ' + (hits.length - 100) + ' 处');
  process.exit(1);
}
console.log('[check-public] 干净：' + (history ? '全历史' : staged ? '暂存区' : TARGET));
