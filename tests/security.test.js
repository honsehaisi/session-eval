'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('../src/security/crypto.js');
const V = require('../src/security/vault.js');
const G = require('../src/security/guard.js');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'eval-sec-'));
}

test('crypto：往返一致，错密码/篡改都失败', () => {
  const pwd = 'correct horse battery staple 32';
  const msg = Buffer.from('内部计划：11-19 开工\n第二行', 'utf8');
  const enc = C.encrypt(pwd, msg);
  const dec = C.decrypt(pwd, enc);
  assert.ok(dec.equals(msg));
  assert.throws(() => C.decrypt('wrong password', enc), /解密|auth|Unsupported|bad/i);
  const tampered = JSON.parse(JSON.stringify(enc));
  tampered.data = Buffer.from('x').toString('base64');
  assert.throws(() => C.decrypt(pwd, tampered));
});

test('vault：创建、写入、列出、重载、校验、提取', () => {
  const root = tmpRoot();
  const file = V.vaultFile(root);
  const pwd = 'a-very-long-test-password-123';
  V.create(file, pwd);
  let entries = V.loadEntries(file, pwd);
  assert.deepStrictEqual(V.list(entries), []);
  V.put(entries, 'docs/plan.md', Buffer.from('11-19 计划正文', 'utf8'));
  V.saveEntries(file, pwd, entries);
  entries = V.loadEntries(file, pwd);
  assert.strictEqual(entries['docs/plan.md'].size, Buffer.byteLength('11-19 计划正文'));
  assert.ok(V.get(entries, 'docs/plan.md').toString('utf8').includes('11-19'));
  assert.strictEqual(V.verify(entries).bad.length, 0);
  const out = V.extract(entries, 'docs/plan.md', fs.mkdtempSync(path.join(os.tmpdir(), 'eval-out-')));
  assert.ok(fs.readFileSync(out, 'utf8').includes('11-19'));
  assert.throws(() => V.loadEntries(file, 'wrong password'), /解密失败/);
});

test('vault：非法条目名与损坏内容被拒绝', () => {
  const root = tmpRoot();
  const file = V.vaultFile(root);
  const pwd = 'a-very-long-test-password-123';
  V.create(file, pwd);
  let entries = V.loadEntries(file, pwd);
  assert.throws(() => V.put(entries, '../escape.md', 'x'), /非法/);
  assert.throws(() => V.put(entries, '/abs.md', 'x'), /非法/);
  V.put(entries, 'ok.md', 'hello');
  entries['ok.md'].content = Buffer.from('tampered').toString('base64');
  assert.throws(() => V.get(entries, 'ok.md'), /校验失败/);
});

test('guard：受保护根被拦截，普通路径放行，internal 永远保护', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'internal'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dev'), { recursive: true });
  fs.writeFileSync(path.join(root, 'internal', 'protected.json'),
    JSON.stringify({ roots: [path.join(root, 'dev')] }), 'utf8');
  assert.throws(() => G.assertConfigPaths(root, {
    sessionsDir: path.join(root, 'dev', 'logs'),
    memoryDir: path.join(root, 'mem'),
    defaultCwd: '',
  }), /访问拦截|ACCESS BLOCKED/);
  assert.doesNotThrow(() => G.assertConfigPaths(root, {
    sessionsDir: path.join(root, 'sessions'),
    memoryDir: path.join(root, 'mem'),
    defaultCwd: '',
  }));
  assert.throws(() => G.assertConfigPaths(root, {
    sessionsDir: path.join(root, 'sessions'),
    memoryDir: path.join(root, 'mem'),
    defaultCwd: '',
    qbankFile: path.join(root, 'internal', 'vault.json'),
  }), /访问拦截|ACCESS BLOCKED/);
});
