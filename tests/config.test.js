// 配置层自测（S1）：不读真实日志，只验证「换机器 / 换目录 / 坏配置」时路径怎么解析
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CFG = path.resolve(__dirname, '../src/config.js');
const ROOT = path.resolve(__dirname, '..');

function loadWith(file) {
  delete require.cache[require.resolve(CFG)];
  if (file === null) delete process.env.SYSEVAL_CONFIG;
  else process.env.SYSEVAL_CONFIG = file;
  return require(CFG);
}
function writeCfg(obj) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syseval-cfg-'));
  const p = path.join(dir, 'config.json');
  fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj));
  return p;
}

test.afterEach(() => { delete process.env.SYSEVAL_CONFIG; });

test('没配路径时按当前用户推导，不写死用户名', () => {
  const c = loadWith(writeCfg({ paths: {} }));
  const home = c.slash(os.homedir());
  assert.strictEqual(c.P.sessionsDir, home + '/.dsh/sessions');
  assert.strictEqual(c.P.memoryDir, home + '/.memory');
});

test('~ 展开成当前用户主目录', () => {
  const c = loadWith(writeCfg({ paths: { sessionsDir: '~/mylogs' } }));
  assert.strictEqual(c.P.sessionsDir, c.slash(os.homedir()) + '/mylogs');
});

test('相对路径按项目根解析（脚本 cwd 在子目录里也不受影响）', () => {
  const c = loadWith(writeCfg({ paths: { sessionsDir: '_work/demo-logs' } }));
  assert.strictEqual(c.P.sessionsDir, c.slash(path.resolve(ROOT, '_work/demo-logs')));
});

test('反斜杠与结尾斜杠统一成正斜杠', () => {
  const c = loadWith(writeCfg({ paths: { sessionsDir: 'C:\\data\\sessions\\' } }));
  assert.strictEqual(c.P.sessionsDir, 'C:/data/sessions');
});

test('SYSEVAL_CONFIG 指定的文件优先，且能覆盖本机 config.json', () => {
  const p = writeCfg({ paths: { sessionsDir: '~/.dsh/other-sessions' } });
  const c = loadWith(p);
  assert.strictEqual(c.CONFIG_PATH, path.resolve(p));
  assert.ok(c.P.sessionsDir.endsWith('/.dsh/other-sessions'));
});

test('指定的配置坏了要直接报错，不带着默认值偷偷跑', () => {
  const p = writeCfg('{ this is not json }');
  assert.throws(() => loadWith(p), /读不了配置文件/);
});

test('banner 报出实际用的配置与目录', () => {
  const p = writeCfg({ paths: { sessionsDir: '~/.dsh/sessions' } });
  const b = loadWith(p).banner();
  assert.ok(b.includes('会话: '));
  assert.ok(b.includes('/.dsh/sessions'));
});
