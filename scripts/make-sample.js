#!/usr/bin/env node
// 造一份示例日志（合成数据，不含任何真实会话）：没有日志的人也能先把链路跑通。
//
//   --format dsh      与 DSH 一致（扁平 session 记录 + data 包裹的其余记录 + 多帧 zstd），默认
//   --format generic  通用 JSONL「一行一步」（最小格式，README §5.1）
//
//   node scripts/make-sample.js                          → _work/demo-sessions
//   node scripts/make-sample.js --format generic         → _work/demo-generic
//   node scripts/make-sample.js --out D:/tmp/demo --sessions 3 --turns 2
//
// ⚠ 造出来的是「示例数据」，分数只证明链路通，不代表任何真实系统的水平。
'use strict';
const fs = require('fs');
const path = require('path');
const z = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const o = { out: '', format: 'dsh', sessions: 2, turns: 2, seed: 7 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') o.out = path.resolve(argv[++i] || '');
    else if (a === '--format') o.format = String(argv[++i] || 'dsh').toLowerCase();
    else if (a === '--sessions') o.sessions = Math.max(1, Number(argv[++i]) || 1);
    else if (a === '--turns') o.turns = Math.max(1, Number(argv[++i]) || 1);
    else if (a === '--seed') o.seed = Number(argv[++i]) || 1;
    else if (a === '--help' || a === '-h') o.help = true;
  }
  if (!o.out) o.out = path.join(ROOT, o.format === 'generic' ? '_work/demo-generic' : '_work/demo-sessions');
  return o;
}

// 线性同余：造数可复现，不用 Math.random
function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

function recordsFor(o, sid, n) {
  const rand = rng(o.seed + n * 101);
  const cwd = 'C:/work/demo';
  const t0 = Date.UTC(2026, 9, 1, 9, 0, 0) + n * 3600e3;
  const recs = [{ type: 'session', version: 4, id: sid, createdAt: t0, cwd, origin: 'main', parentSession: null, delegationDepth: 0 }];
  let seq = 1, tm = t0;
  const add = (type, data, dt) => { tm += dt || 1000; recs.push({ type, seq: ++seq, time: tm, data }); };

  for (let t = 1; t <= o.turns; t++) {
    add('turn/start', { turn: t });
    add('user/message', { content: [{ type: 'text', text: '第 ' + t + ' 轮：把 demo 产物生成一下' }] });
    const steps = 2 + Math.floor(rand() * 3);
    for (let s = 1; s <= steps; s++) {
      const usage = { inputTokens: 300 + Math.floor(rand() * 700), outputTokens: 80 + Math.floor(rand() * 200), cacheReadTokens: 200, cacheWriteTokens: 0 };
      add('assistant/message', { turn: t, step: s, message: { content: [{ type: 'text', text: '第 ' + s + ' 步' }] }, usage });
      const callId = 'demo-' + n + '-' + t + '-' + s;
      if (s === 1) {
        add('tool/call', { turn: t, step: s, callId, name: 'ops_read_files', arguments: JSON.stringify({ files: [{ path: cwd + '/src/app.js' }] }) });
        add('tool/result', { turn: t, step: s, callId, message: { content: [{ type: 'text', text: 'console.log(1)' }], isError: false } });
      } else if (s === 2) {
        const out = cwd + '/out/report-' + t + '-step' + s + '.md';
        add('tool/call', { turn: t, step: s, callId, name: 'ops_write_file', arguments: JSON.stringify({ path: out, content: '# demo\n' }) });
        add('tool/result', { turn: t, step: s, callId, message: { content: [{ type: 'text', text: 'ok' }], isError: false } });
      } else {
        add('tool/call', { turn: t, step: s, callId, name: 'ops_bash', arguments: JSON.stringify({ command: 'echo step > ' + cwd + '/out/log-' + t + '-' + s + '.txt' }) });
        add('tool/result', { turn: t, step: s, callId, message: { content: [{ type: 'text', text: '[exit code: 0]' }], isError: false } });
      }
    }
    add('turn/end', { turn: t, reason: { kind: 'completed' } });
  }
  return { recs, t0, tm };
}

function writeSession(file, recs) {
  const lines = recs.map((r) => JSON.stringify(r));
  const half = Math.ceil(lines.length / 2);
  const frame = (ls) => z.zstdCompressSync(Buffer.from(ls.join('\n') + '\n', 'utf8'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([frame(lines.slice(0, half)), frame(lines.slice(half))]));
}

/* ---------- 通用 JSONL（最小格式） ---------- */
// 一行 = 一次模型步或一次工具调用。字段：t / turn / role / text / tool / args / ok / in / out / stop
const GENERIC_TOOLS = ['Read', 'Write', 'Edit', 'Bash'];

function genericRows(o, sid, n) {
  const rand = rng(o.seed + n * 101);
  const t0 = Date.UTC(2026, 9, 1, 9, 0, 0) + n * 3600e3;
  const rows = [];
  let tm = t0;
  const add = (o2, dt) => { tm += dt || 0; rows.push(Object.assign({ t: new Date(tm).toISOString() }, o2)); };
  const tag = 'demo-' + n;

  for (let t = 1; t <= o.turns; t++) {
    tm += 30000;
    add({ turn: t, role: 'user', text: '第 ' + t + ' 轮：把 demo 产物生成一下' }, 0);
    const steps = 2 + Math.floor(rand() * 3);
    for (let s = 1; s <= steps; s++) {
      const last = s === steps;
      const step = {
        turn: t,
        role: 'assistant',
        text: last ? '第 ' + t + ' 轮做完了，产物在 out/ 下' : '第 ' + s + ' 步',
        in: 300 + Math.floor(rand() * 700),
        out: 80 + Math.floor(rand() * 200),
        stop: 'completed',
      };
      if (!last) {
        step.tool = GENERIC_TOOLS[(s + n + t) % GENERIC_TOOLS.length];
        step.args = { path: 'C:/work/demo/out/' + tag + '-' + t + '-' + s + '.md', command: 'echo step > out/' + tag + '-' + t + '-step' + s + '.md' };
        // 故意留一次失败（每会话 1 次），让稳定维度有分子也有分母；固定在第一步，不会撞上纯文本行
        step.ok = !(s === 1 && t === 1 && n === 2);
        if (!step.ok) step.error = 'tool exited with code 1';
      }
      add(step, 3000 + Math.floor(rand() * 4000));   // 3–7 秒/步 → S1 落在 B 档
    }
  }
  return rows;
}

function writeGeneric(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return rows.length;
}

function mainGeneric(o) {
  if (fs.existsSync(o.out) && fs.readdirSync(o.out).length) {
    console.log('目标目录非空，不覆盖：' + o.out);
    console.log('（换个 --out，或先手动删掉旧的示例目录）');
    process.exit(1);
  }
  let rows = 0;
  for (let i = 0; i < o.sessions; i++) {
    const sid = 'demo-' + (i + 1);
    rows += writeGeneric(path.join(o.out, 'sessions', sid + '.jsonl'), genericRows(o, sid, i + 1));
  }
  // 一份只给示例目录用的配置：不动你自己的 config.json
  const cfgPath = path.join(o.out, 'config.json');
  const cfg = {
    _note: '示例配置：SYSEVAL_CONFIG 指到这份就能跑，不改你自己的 config.json。',
    paths: { sessionsDir: o.out, dataSource: 'generic' },
    generic: { productTools: ['Write', 'Edit', 'Bash'] },
  };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

  console.log('通用格式示例已写入: ' + o.out);
  console.log('会话 ' + o.sessions + ' 份｜记录 ' + rows + ' 条｜sessions/demo-*.jsonl（一行一步）');
  console.log('');
  console.log('下一步：');
  console.log('  1) SYSEVAL_CONFIG="' + cfgPath + '" node scripts/doctor.js');
  console.log('  2) SYSEVAL_CONFIG="' + cfgPath + '" node scripts/run-all.js');
  console.log('');
  console.log('⚠ 这是示例数据，分数只证明链路通，不代表真实水平。');
  console.log('  产品工具名（Write/Edit/Bash）是示例里的假名，换成你自己日志里的才准。');
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) {
    console.log('用法: node scripts/make-sample.js [--format dsh|generic] [--out 目录] [--sessions 2] [--turns 2] [--seed 7]');
    process.exit(0);
  }
  if (o.format === 'generic') return mainGeneric(o);
  if (o.format !== 'dsh') {
    console.log('不认识的 --format：' + o.format + '（支持 dsh / generic）');
    process.exit(1);
  }
  if (fs.existsSync(o.out) && fs.readdirSync(o.out).length) {
    console.log('目标目录非空，不覆盖：' + o.out);
    console.log('（换个 --out，或先手动删掉旧的示例目录）');
    process.exit(1);
  }
  let n = 0;
  for (let i = 0; i < o.sessions; i++) {
    const sid = 'demo-' + (i + 1);
    const { recs, t0 } = recordsFor(o, sid, i + 1);
    const day = new Date(t0).toISOString().slice(0, 10).replace(/-/g, '');
    writeSession(path.join(o.out, day + '-demo', sid, 'session.v4.jsonl.zstd'), recs);
    n += recs.length;
  }
  console.log('示例日志已写入: ' + o.out);
  console.log('会话 ' + o.sessions + ' 份｜记录 ' + n + ' 条｜文件名 session.v4.jsonl.zstd（与 DSH 一致）');
  console.log('');
  console.log('下一步：');
  console.log('  1) 改 config.json 的 paths.sessionsDir 指到上面这个目录（或设 SYSEVAL_CONFIG）');
  console.log('  2) node scripts/doctor.js      ← 应显示「会话数量 N 份」');
  console.log('  3) node scripts/run-all.js     ← 出报告');
  console.log('');
  console.log('⚠ 这是示例数据，分数只证明链路通，不代表真实水平。');
}

if (require.main === module) main();
module.exports = { parseArgs, recordsFor, writeSession, genericRows, writeGeneric, rng };
