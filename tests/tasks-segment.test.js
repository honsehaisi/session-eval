// src/tasks/segment.js 的口径自测（只测纯函数与合成会话，不读真实日志）
const test = require('node:test');
const assert = require('node:assert');
const { productsOfCall, parseShellProducts, classOfPath, segmentSession, median, gradeS2Plan, gradeS2User, gradeDelivery } = require('../src/tasks/segment.js');

test('扩展名归 5 类 + other', () => {
  assert.equal(classOfPath('a/b/c.md'), 'doc');
  assert.equal(classOfPath('a/b/c.html'), 'doc');
  assert.equal(classOfPath('a/b/c.py'), 'code');
  assert.equal(classOfPath('a/b/c.js'), 'code');
  assert.equal(classOfPath('a/b/c.ps1'), 'code');
  assert.equal(classOfPath('a/b/c.json'), 'data');
  assert.equal(classOfPath('a/b/c.png'), 'image');
  assert.equal(classOfPath('a/b/c.mp4'), 'media');
  assert.equal(classOfPath('a/b/c.zip'), 'other');
  assert.equal(classOfPath('noext'), 'other');
});

test('bash 重定向 / -o / ffmpeg 输出', () => {
  assert.deepEqual(parseShellProducts('echo hi > out.md'), ['out.md']);
  assert.deepEqual(parseShellProducts('node x.mjs --out result.json'), ['result.json']);
  assert.deepEqual(parseShellProducts('ffmpeg -i in.mp4 -y D:/v/out.mp4'), ['D:/v/out.mp4']);
  assert.deepEqual(parseShellProducts('echo hi > /dev/null'), []);
  assert.deepEqual(parseShellProducts('echo hi > C:/tmp/a.log'), []);
});

test('write / present / 生图 / 发消息 的产物', () => {
  assert.deepEqual(productsOfCall('write', { file_path: 'x.py' }).map(x => x.cls), ['code']);
  assert.deepEqual(productsOfCall('present', { files: [{ path: 'a.md' }, { path: 'b.png' }] }).map(x => x.cls), ['doc', 'image']);
  assert.deepEqual(productsOfCall('generate_image', {}).map(x => x.cls), ['image']);
  assert.deepEqual(productsOfCall('qq_send_image', {}).map(x => x.cls), ['message']);
  assert.deepEqual(productsOfCall('read', { file_path: 'x.md' }), []);
});

test('中位数', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

test('四档线', () => {
  assert.equal(gradeS2Plan(600), 'A');
  assert.equal(gradeS2Plan(601), 'B');
  assert.equal(gradeS2Plan(1801), 'C');
  assert.equal(gradeS2Plan(10801), 'E');
  assert.equal(gradeS2User(10), 'B');
  assert.equal(gradeS2User(301), 'E');
  assert.equal(gradeDelivery(0.70), 'A');
  assert.equal(gradeDelivery(0.699), 'B');
  assert.equal(gradeDelivery(0.14), 'E');
});

// 合成事件流（标准事件）：code×2 → doc×3 → code×3；N=3 应在 doc 首个产物切一刀
const META = { id: 's1' };
function events() {
  const out = [];
  let seq = 1;
  const calls = [
    ['t1', 'write', { file_path: 'a.js' }, 1000, 2000],
    ['t2', 'write', { file_path: 'b.js' }, 3000, 4000],
    ['t3', 'write', { file_path: 'c.md' }, 5000, 6000],
    ['t4', 'edit', { file_path: 'd.md' }, 7000, 8000],
    ['t5', 'edit', { file_path: 'e.md' }, 9000, 10000],
    ['t6', 'write', { file_path: 'f.py' }, 11000, 12000],
    ['t7', 'write', { file_path: 'g.py' }, 13000, 14000],
    ['t8', 'write', { file_path: 'h.py' }, 15000, 16000],
  ];
  calls.forEach(([turn, name, args, start, end], i) => {
    const tn = i + 1, callId = 'c' + tn;
    out.push({ type: 'turn_start', turn: tn, seq: seq++, time: start });
    out.push({ type: 'tool_call', turn: tn, step: 1, callId, name, args, seq: seq++, time: start + 10 });
    out.push({ type: 'tool_result', turn: tn, step: 1, callId, isError: false, text: 'ok', seq: seq++, time: start + 20 });
    out.push({ type: 'turn_end', turn: tn, reason: 'completed', seq: seq++, time: end });
  });
  return out;
}

test('产物类型 run >= N 才切（N=3）', () => {
  const r = segmentSession(events(), { N: 3, useIdle: false, useKeywords: false, idleMs: 4 * 3600 * 1000 }, META);
  assert.equal(r.tasks.length, 3);
  assert.deepEqual(r.tasks.map(x => x.turns), [2, 3, 3]);
  assert.deepEqual(r.tasks.map(x => x.types.join(',')), ['code', 'doc', 'code']);
  assert.equal(r.tasks[1].durationSec, 5); // 5000 → 10000
});

test('N=2 时同样三段；N=5 时 doc 段被并掉（只剩 1 段）', () => {
  const r2 = segmentSession(events(), { N: 2, useIdle: false, useKeywords: false, idleMs: 4 * 3600 * 1000 }, META);
  assert.equal(r2.tasks.length, 3);
  const r5 = segmentSession(events(), { N: 5, useIdle: false, useKeywords: false, idleMs: 4 * 3600 * 1000 }, META);
  assert.equal(r5.tasks.length, 1);
});

test('显式切换信号：用户消息开头「新任务」切一刀', () => {
  const rs = events();
  // 在第 5 轮前插入一条用户消息（标准事件里 turn 由适配器或 core 归属，这里直接给）
  const i = rs.findIndex(r => r.type === 'turn_start' && r.turn === 5);
  rs.splice(i + 1, 0, { type: 'user_message', turn: 5, text: '新任务：另一件事', seq: 4.5, time: 9000 });
  const r = segmentSession(rs, { N: 3, useIdle: false, useKeywords: true, idleMs: 4 * 3600 * 1000 }, META);
  assert.ok(r.tasks.some(x => x.fromTurn === 5), '应在第 5 轮切出新任务');
});
