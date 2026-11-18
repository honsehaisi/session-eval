#!/usr/bin/env node
// 导出标准事件流：给「换数据源 / 写适配器」的人看 core 到底吃什么。
// 只读日志，不评分、不写报告。
//
//   node scripts/export-events.js                       → _work/events.jsonl
//   node scripts/export-events.js --sid 6a68 --limit 5   → 只看 5 个会话
//   node scripts/export-events.js --type tool_call --out /tmp/x.jsonl
//
// 输出一行一个事件：{"sid":"…","origin":"main","type":"tool_call",…}
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const o = { out: path.join(ROOT, '_work/events.jsonl'), sid: '', limit: 0, types: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') o.out = path.resolve(argv[++i] || '');
    else if (a === '--sid') o.sid = String(argv[++i] || '');
    else if (a === '--limit') o.limit = Math.max(0, Number(argv[++i]) || 0);
    else if (a === '--type') o.types = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--help' || a === '-h') o.help = true;
    else if (!o._bad) o._bad = a;
  }
  return o;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || o._bad) {
    console.log('用法: node scripts/export-events.js [--out 文件] [--sid 前缀] [--limit 会话数] [--type 类型1,类型2]');
    process.exit(o._bad ? 1 : 0);
  }

  const { load } = require('../src/dataset.js');
  const ds = load({});
  console.log('数据源: ' + ds.source + '\n目录: ' + ds.dir + '\n会话: ' + ds.sessions.length + '（解不开 ' + ds.sessions_failed + '）');

  const typeSet = new Set(o.types);
  const lines = [];
  const byType = {};
  let used = 0;
  for (const s of ds.sessions) {
    if (s.err) continue;
    if (o.sid && !String(s.id).startsWith(o.sid)) continue;
    if (o.limit && used >= o.limit) break;
    used++;
    const origin = (s.meta && s.meta.origin) || 'main';
    for (const e of s.events) {
      if (typeSet.size && !typeSet.has(e.type)) continue;
      byType[e.type] = (byType[e.type] || 0) + 1;
      lines.push(JSON.stringify(Object.assign({ sid: s.id, origin }, e)));
    }
  }

  fs.mkdirSync(path.dirname(o.out), { recursive: true });
  fs.writeFileSync(o.out, lines.join('\n') + (lines.length ? '\n' : ''));
  const size = fs.statSync(o.out).size;

  console.log('导出会话: ' + used + '｜事件: ' + lines.length + '｜' + (size / 1024).toFixed(1) + ' KB');
  console.log('事件类型: ' + Object.keys(byType).sort().map((k) => k + ' ' + byType[k]).join(' / '));
  console.log('写出: ' + o.out);
  if (!lines.length) {
    console.log('（0 条事件：--sid/--type 过滤太窄，或数据源适配器没产出事件）');
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { parseArgs };
