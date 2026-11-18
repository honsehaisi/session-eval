// src/memory/judge.js 的规则判分自测：不读题库、不写 answers.json
// 重点：换题库/换记忆库时判分不能「全部落默认 hit」（M1 假绿）
const test = require('node:test');
const assert = require('node:assert');
const { autoVerdict } = require('../src/memory/judge.js');

const R = (facts) => ({ id: 'R-999', type: 'R1', key_facts: facts });

test('R 题：key_facts 全中 → hit', () => {
  assert.equal(autoVerdict(R(['621395071']), { answer: '是 621395071', channel: 'memory' }), 'hit');
});

test('R 题：key_facts 没中且 channel=memory → fabricated（记错，不是没记）', () => {
  assert.equal(autoVerdict(R(['621395071']), { answer: '大概是 123456', channel: 'memory' }), 'fabricated');
});

test('R 题：key_facts 没中且来自先验 → off（答偏，不算编造）', () => {
  assert.equal(autoVerdict(R(['621395071']), { answer: '我记得是另一个号', channel: 'prior' }), 'off');
});

test('R 题：key_facts 为空不会误判 hit', () => {
  assert.equal(autoVerdict(R([]), { answer: '随便说点什么', channel: 'memory' }), 'fabricated');
});

test('F 题：命中 forbidden → off；没命中 → hit', () => {
  const q = { type: 'F', forbidden: ['2.8MB'], key_facts: ['旧口径已作废'] };
  assert.equal(autoVerdict(q, { answer: '还是 2.8MB 那条线', channel: 'memory' }), 'off');
  assert.equal(autoVerdict(q, { answer: '那条体积口径已经作废了', channel: 'memory' }), 'hit');
});

test('H 题：顺着假前提答 → fabricated；明确否认 → hit；含糊 → off', () => {
  const q = { type: 'H', forbidden: ['第五位是'], key_facts: ['第五位另有其人'] };
  assert.equal(autoVerdict(q, { answer: '第五位是乌尔比安', channel: 'web' }), 'fabricated');
  assert.equal(autoVerdict(q, { answer: '记忆里没有第五个人，这个前提不对', channel: 'memory' }), 'hit');
  assert.equal(autoVerdict(q, { answer: '这个我印象不深', channel: 'none' }), 'off');
});

test('作答缺失或超时 → unknown', () => {
  assert.equal(autoVerdict(R(['x']), undefined), 'unknown');
  assert.equal(autoVerdict(R(['x']), { answer: '   ', channel: 'none' }), 'unknown');
  assert.equal(autoVerdict(R(['x']), { answer: '（超时）20 分钟未收敛，被中止', channel: 'none' }), 'unknown');
});

test('题号不影响判定：同一个答案配不同 id 结果相同', () => {
  const a = { answer: '是 621395071', channel: 'memory' };
  assert.equal(autoVerdict({ id: 'R1-001', type: 'R1', key_facts: ['621395071'] }, a),
    autoVerdict({ id: 'X-777', type: 'R2', key_facts: ['621395071'] }, a));
});
