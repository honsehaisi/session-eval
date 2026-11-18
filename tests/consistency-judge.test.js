// src/consistency/lib.js 判分口径自测（§6.5 严判：结论 + 数字都要对上）
const test = require('node:test');
const assert = require('node:assert');
const { classify, nums, jaccard, bigrams } = require('../src/consistency/lib.js');

const A = (answer, verdict = 'hit') => ({ answer, verdict });

test('两边都 unknown → same', () => {
  assert.equal(classify(A('不知道', 'unknown'), A('不知道', 'unknown')).verdict, 'same');
});

test('一边 hit 一边 unknown → diff', () => {
  assert.equal(classify(A('621395071'), A('不知道', 'unknown')).verdict, 'diff');
});

test('数字集相同、措辞不同 → same', () => {
  assert.equal(classify(A('621395071（红色海嗣OvO）'), A('621395071')).verdict, 'same');
});

test('数字不同、措辞远 → diff', () => {
  assert.equal(classify(A('621395071'), A('123456789')).verdict, 'diff');
});

test('缺题 → missing', () => {
  assert.equal(classify(A('x'), null).verdict, 'missing');
});

test('数字提取：小数、多个数字排序', () => {
  assert.equal(nums('3.67 字/秒（2.51 / 4.61）'), '2.51|3.67|4.61');
  assert.equal(nums('没有数字'), '');
});

test('jaccard 边界：完全相同 1、完全无关 0', () => {
  assert.equal(jaccard(bigrams('abcdef'), bigrams('abcdef')), 1);
  assert.ok(jaccard(bigrams('abc'), bigrams('xyz')) < 0.2);
});
