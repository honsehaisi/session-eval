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

// 2026-11-19 扩题库时踩到的坑：题面本身就带着假事实的词，答对的人会复述它（「不是版本冲突」），
// 只按 includes 判会把答对的算成 fabricated。
test('H 题：否定式复述假事实不算编造', () => {
  const q = { type: 'H', forbidden: ['版本冲突'], key_facts: ['是 cookie 撑爆请求头'] };
  assert.equal(autoVerdict(q, { answer: '不是版本冲突，是 71 个 cookie 撑过 16 KB', channel: 'memory' }), 'hit');
  assert.equal(autoVerdict(q, { answer: '样本是 9 组，没有扩到 30 组', channel: 'memory' }), 'hit');
  assert.equal(autoVerdict(q, { answer: '就是版本冲突，插件打架', channel: 'memory' }), 'fabricated');
});

test('F 题：把旧值当现行说出来才算复述；否定式提及算答对', () => {
  const q = { type: 'F', forbidden: ['纯黑底'] };
  assert.equal(autoVerdict(q, { answer: '对，默认纯黑底', channel: 'memory' }), 'off');
  // 2026-11-19 改口径：答对的人会顺手说「不是纯黑底，是白底加黑框」，
  // 光按 includes 会把这种判成复述；改成「断言才算」（前后 30 字内有否定/作废类字眼就不算）
  assert.equal(autoVerdict(q, { answer: '不是纯黑底，是白底加黑框', channel: 'memory' }), 'hit');
  assert.equal(autoVerdict(q, { answer: '底色那事早改成白底了', channel: 'memory' }), 'hit');
});

test('题号不影响判定：同一个答案配不同 id 结果相同', () => {
  const a = { answer: '是 621395071', channel: 'memory' };
  assert.equal(autoVerdict({ id: 'R1-001', type: 'R1', key_facts: ['621395071'] }, a),
    autoVerdict({ id: 'X-777', type: 'R2', key_facts: ['621395071'] }, a));
});
