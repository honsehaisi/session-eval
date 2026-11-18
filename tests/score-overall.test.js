// src/score/overall.js 口径自测（计划书 §2.2 / §2.3）
// 不读真实产物：纯函数，直接喂 dims + weights
const test = require('node:test');
const assert = require('node:assert');
const { computeOverall } = require('../src/score/overall.js');

const W = {
  safety: 0.20, stability: 0.15, delivery: 0.15, honesty: 0.15,
  memory: 0.10, speed: 0.10, cost: 0.075, consistency: 0.075,
};

const fullDims = () => ({
  speed: { score: 3.0, grade: 'B' },
  stability: { score: 3.6, grade: 'A' },
  cost: { score: 0, grade: 'E' },
  delivery: { score: 4, grade: 'A' },
  safety: { score: 1.0, grade: 'D' },
  memory: { score: 3.2, grade: 'B' },
  honesty: { score: 3, grade: 'B' },
  consistency: { score: null, grade: 'uncovered' },
});

test('七维 + 一致性未覆盖：2.61 / B / 71% / 最低 cost E', () => {
  const r = computeOverall(fullDims(), W);
  assert.equal(r.weighted_score, 2.61);
  assert.equal(r.grade, 'B');
  assert.equal(r.pass_rate, 71);
  assert.equal(r.covered, 7);
  assert.equal(r.total, 8);
  assert.deepEqual(r.lowest, [{ dim: 'cost', grade: 'E' }]);
  assert.deepEqual(r.below_line, ['safety', 'cost']); // 权重降序：safety 0.20 > cost 0.075
});

test('缺一维：分母拿掉该维权重，不按 0 分算', () => {
  const dims = fullDims();
  dims.honesty = { score: null, grade: 'uncovered' };
  const r = computeOverall(dims, W);
  // 加权和 = 2.41 - 0.45 = 1.96；分母 = 0.925 - 0.15 = 0.775；1.96/0.775 = 2.529 → 2.53
  assert.equal(r.weighted_score, 2.53);
  assert.equal(r.grade, 'B');
  assert.equal(r.covered, 6);
  assert.equal(r.pass_rate, 67); // 4/6
  assert.deepEqual(r.lowest, [{ dim: 'cost', grade: 'E' }]);
});

test('并列最低全部列出', () => {
  const dims = fullDims();
  dims.delivery = { score: 0, grade: 'E' };
  const r = computeOverall(dims, W);
  assert.equal(r.lowest.length, 2);
  assert.deepEqual(r.lowest.map(x => x.dim).sort(), ['cost', 'delivery']);
});

test('全部未覆盖：uncovered，不给 0 分', () => {
  const dims = {};
  const r = computeOverall(dims, W);
  assert.equal(r.weighted_score, null);
  assert.equal(r.grade, 'uncovered');
  assert.deepEqual(r.lowest, []);
  assert.equal(r.pass_rate, 0);
  assert.equal(r.covered, 0);
});

test('加权用维度分不先取整：3.6 参与计算', () => {
  const dims = { stability: { score: 3.6, grade: 'A' } };
  const r = computeOverall(dims, { stability: 0.15, safety: 0.20 });
  // 单维覆盖 → 分母 0.15 → 3.6 归一后仍是 3.6
  assert.equal(r.weighted_score, 3.6);
  assert.equal(r.grade, 'A');
});
