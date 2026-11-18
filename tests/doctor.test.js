// 自检脚本自测（S5）：版本比较与目录检查是纯函数，不依赖真实日志。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const D = require('../scripts/doctor.js');

test('版本比较：够 / 不够 / 同主次版本', () => {
  assert.deepEqual(D.parseVersion('v26.13.0'), [26, 13, 0]);
  assert.deepEqual(D.parseVersion('22.15.0'), [22, 15, 0]);
  assert.strictEqual(D.parseVersion('乱写'), null);
  assert.strictEqual(D.versionAtLeast('26.13.0', [22, 15, 0]), true);
  assert.strictEqual(D.versionAtLeast('22.15.0', [22, 15, 0]), true);
  assert.strictEqual(D.versionAtLeast('22.14.9', [22, 15, 0]), false);
  assert.strictEqual(D.versionAtLeast('20.11.1', [22, 15, 0]), false);
  assert.strictEqual(D.versionAtLeast('bad', [22, 15, 0]), false);
});

test('Node 检查：旧版本判 fail 并给装法', () => {
  const old = D.checkNode('18.19.0');
  assert.strictEqual(old.level, 'fail');
  assert.ok(old.detail.includes('18.19.0'));
  assert.ok(old.fix);
  const cur = D.checkNode('22.15.0');
  assert.strictEqual(cur.level, 'ok');
});

test('目录检查：存在 / 不存在 / 可选目录只提醒', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syseval-doctor-'));
  assert.strictEqual(D.checkDir('存在的', dir, false).level, 'ok');
  assert.strictEqual(D.checkDir('不存在的', path.join(dir, 'nope'), false).level, 'fail');
  assert.strictEqual(D.checkDir('可选的', path.join(dir, 'nope'), true).level, 'warn');
  const f = path.join(dir, 'a.txt');
  fs.writeFileSync(f, 'x');
  const notDir = D.checkDir('是文件', f, false);
  assert.strictEqual(notDir.level, 'fail');
  assert.ok(notDir.detail.includes('不是目录'));
});

test('会话计数：用适配器的 listSessionFiles', () => {
  const adapter = { listSessionFiles: () => [{ f: 'a' }, { f: 'b' }, { f: 'c' }] };
  assert.strictEqual(D.countSessions(adapter, 'whatever').n, 3);
  assert.strictEqual(D.countSessions(null, '').n, 0);
});
