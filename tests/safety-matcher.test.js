// src/safety/matcher.js 口径自测：46 条判定器的路径分类（§5.3）
// 只测路径纯函数 + 规则表；不跑真实会话（SESS 在 require 时加载，但不参与断言）
const test = require('node:test');
const assert = require('node:assert');
const { norm, under, isProt, isSys, isDshCfg, isDshCode, isStartup, LEVEL, TIER } = require('../src/safety/matcher.js');
// 家目录从配置来（换用户名这些断言跟着变，不用改测试）
const H = require('../src/config.js').P.homeDir.toLowerCase();

test('norm：反斜杠、盘符、macC 风路径归一', () => {
  assert.equal(norm('C:\\Users\\a\\b.md'), 'c:/users/a/b.md');
  assert.equal(norm('/c/Users/a'), 'c:/users/a');
  assert.equal(norm('D:/x//y/'), 'd:/x/y');
  assert.equal(norm('~/.dsh/a.json'), H + '/.dsh/a.json');
});

test('系统目录判定（A2）：Windows / System32 / Program Files', () => {
  assert.equal(isSys('c:/windows/system32/a.dll'), true);
  assert.equal(isSys('c:/program files/x/y.exe'), true);
  assert.equal(isSys('c:/programdata/x'), true);
  assert.equal(isSys('d:/project/video/out.mp4'), false);
  assert.equal(isSys(H + '/desktop/a.md'), false);
});

test('记忆库保护页判定（F1）：soul / identity / rules 受保护，skills 不受', () => {
  assert.equal(isProt(H + '/.memory/soul.md'), true);
  assert.equal(isProt(H + '/.memory/identity/values.md'), true);
  assert.equal(isProt(H + '/.memory/rules/x.md'), true);
  assert.equal(isProt(H + '/.memory/memory.md'), true);
  assert.equal(isProt(H + '/.memory/skills/x.md'), false);
});

test('DSH 配置判定（F4）：配置目录命中，工作区不命中', () => {
  assert.equal(isDshCfg(H + '/.dsh/settings.json'), true);
  assert.equal(isDshCfg(H + '/.dsh/plugins.json'), true);
  assert.equal(isDshCfg(H + '/.dsh/workspace/a/settings.json'), false);
  assert.equal(isDshCfg('d:/project/project/settings.json'), false);
});

test('DSH 代码与开机自启判定（F6 / B3）', () => {
  assert.equal(isDshCode('d:/project/deepseek/resources/app.asar/dsh/x.js'), true);
  assert.equal(isDshCode('d:/project/video/a.mp4'), false);
  assert.equal(isStartup(H + '/appdata/roaming/microsoft/windows/start menu/programs/startup/x.vbs'), true);
  assert.equal(isStartup(H + '/desktop/x.vbs'), false);
});

test('零命中：普通工作区产物不触发任何危险路径判定', () => {
  for (const p of ['d:/project/video/sixgaps/out.mp4', H + '/.dsh/workspace/x/y.md', 'd:/tmp/a.json']) {
    const n = norm(p);
    assert.equal(isSys(n) || isProt(n) || isDshCfg(n) || isDshCode(n) || isStartup(n), false, p);
  }
});

test('规则表自洽：每条规则都有等级与授权分类，绿档只有 3 条', () => {
  const rules = Object.keys(LEVEL);
  assert.ok(rules.length >= 46, '规则数应 ≥46，实际 ' + rules.length);
  for (const r of rules) {
    assert.ok(['留痕', '红', '确认', '绿'].includes(LEVEL[r]), r + ' 等级异常');
    assert.ok(['T1', 'T2', 'T3'].includes(TIER[r]), r + ' 授权分类异常');
  }
  assert.deepEqual(rules.filter((r) => LEVEL[r] === '绿').sort(), ['C1', 'D1', 'F2']);
});
