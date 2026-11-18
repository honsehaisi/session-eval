#!/usr/bin/env node
// 一键跑分：成本 → 诚实 → 安全。每一步在它自己的目录里跑（脚本用 __dirname 定位产物）。
const { spawnSync } = require('child_process');
const path = require('path');

const NODE = process.execPath;
const SRC = path.join(__dirname, '..', 'src');

// 先亮出这次到底读了哪份配置、哪个目录（路径参数化以后，0 条会话要看得见）
const cfg = require(path.join(SRC, 'config.js'));
if (cfg.BLOCKED) process.exit(3);
console.log(cfg.banner() + '\n');

const STEPS = [
  { dim: '速度 · 任务切分', dir: 'tasks', file: 'segment.js' },
  { dim: '成本 · 口径校验', dir: 'cost', file: 'verify.js' },
  { dim: '成本 · 计价', dir: 'cost', file: 'money.js' },
  { dim: '诚实 · 主扫描', dir: 'honesty', file: 'final.js' },
  { dim: '安全 · 扫会话', dir: 'safety', file: 'scan.js' },
  { dim: '安全 · 匹配 46 条', dir: 'safety', file: 'matcher.js' },
  { dim: '安全 · 可恢复性', dir: 'safety', file: 'a2.js' },
  { dim: '安全 · 汇总', dir: 'safety', file: 'run.js' },
  { dim: '稳定 · 汇总', dir: 'stability', file: 'index.js' },
  { dim: '交付 · 会话级', dir: 'delivery', file: 'index.js' },
  { dim: '汇总 · report.json', dir: 'score', file: 'collect.js' },
];

const t0 = Date.now();
let bad = 0;
for (const s of STEPS) {
  const dir = path.join(SRC, s.dir);
  process.stdout.write(`\n=== ${s.dim} (${s.dir}/${s.file}) `);
  const t = Date.now();
  const r = spawnSync(NODE, [s.file], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const sec = ((Date.now() - t) / 1000).toFixed(1);
  if (r.status !== 0) {
    bad++;
    console.log(`FAIL ${sec}s ===`);
    console.log((r.stderr || '').split('\n').slice(0, 8).join('\n'));
  } else {
    console.log(`ok ${sec}s ===`);
    const out = (r.stdout || '').trim();
    if (out) console.log(out.split('\n').slice(-6).join('\n'));
  }
}

console.log(`\n--- 完成：${STEPS.length - bad}/${STEPS.length} 步成功，总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s ---`);
if (bad) {
  console.log('有步骤失败。产物可能不完整，别把这次的数当结论。');
  process.exit(1);
}
console.log('产物：src/tasks/report.json、src/cost/sess.json、src/honesty/report.json、src/safety/report.json');
console.log('出报告页：node scripts/build-report.js → report/report.html');
