// src/memory/score.js 口径自测：M1/M2/M3 三条档线 + 0–4 映射（§7.3）
// 不读 answers.json：只测纯档位函数
const test = require('node:test');
const assert = require('node:assert');
const { SCORE, tierM1, tierM2, tierM3 } = require('../src/memory/score.js');

test('M1 档线：95 / 85 / 70 / 50', () => {
  assert.equal(tierM1(95), 'A');
  assert.equal(tierM1(94.9), 'B');
  assert.equal(tierM1(85), 'B');
  assert.equal(tierM1(84.9), 'C');
  assert.equal(tierM1(70), 'C');
  assert.equal(tierM1(69.9), 'D');
  assert.equal(tierM1(50), 'D');
  assert.equal(tierM1(49.9), 'E');
});

test('M2 档线：0 才 A，其余 2 / 5 / 10', () => {
  assert.equal(tierM2(0), 'A');
  assert.equal(tierM2(0.1), 'B');
  assert.equal(tierM2(2), 'B');
  assert.equal(tierM2(2.1), 'C');
  assert.equal(tierM2(5), 'C');
  assert.equal(tierM2(5.1), 'D');
  assert.equal(tierM2(10), 'D');
  assert.equal(tierM2(10.1), 'E');
});

test('M3 档线：98 / 95 / 90 / 80', () => {
  assert.equal(tierM3(98), 'A');
  assert.equal(tierM3(97.9), 'B');
  assert.equal(tierM3(95), 'B');
  assert.equal(tierM3(94.9), 'C');
  assert.equal(tierM3(90), 'C');
  assert.equal(tierM3(89.9), 'D');
  assert.equal(tierM3(80), 'D');
  assert.equal(tierM3(79.9), 'E');
});

test('0–4 映射：A4 B3 C2 D1 E0，且全五档都在', () => {
  assert.deepEqual(SCORE, { A: 4, B: 3, C: 2, D: 1, E: 0 });
});
