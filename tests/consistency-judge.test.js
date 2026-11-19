// src/consistency/lib.js 判分口径自测（§6.2 严判：结论 + 关键数字都要对上）
// v3（2026-11-19）：剥出处括注 + 关键数字去噪 + 实体先判。下面每一条都可脱离数据集单独看懂。
const test = require('node:test');
const assert = require('node:assert');
const {
  classify, nums, jaccard, bigrams,
  stripCitations, coreNumbers, fileEntities, covers,
} = require('../src/consistency/lib.js');

const A = (answer, verdict = 'hit') => ({ answer, verdict });
const V = (a, b) => classify(A(a), A(b)).verdict;

test('两边都 unknown → same', () => {
  assert.equal(classify(A('不知道', 'unknown'), A('不知道', 'unknown')).verdict, 'same');
});

test('一边 hit 一边 unknown → diff', () => {
  assert.equal(classify(A('621395071'), A('不知道', 'unknown')).verdict, 'diff');
});

test('数字集相同、措辞不同 → same', () => {
  assert.equal(V('621395071（红色海嗣OvO）', '621395071'), 'same');
});

test('数字不同、措辞远 → diff', () => {
  assert.equal(V('621395071', '123456789'), 'diff');
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

// ---- v3：出处括注 ------------------------------------------------------

test('v3 剥出处：页面路径括注整段不算答案', () => {
  assert.equal(
    V('621395071（identity/accounts.md：B 站「红色海嗣OvO」）', '621395071'),
    'same',
  );
  assert.equal(stripCitations('3.67 字/秒（decisions/voice-xinghui.md：p10 2.51 / p90 4.61）'), '3.67 字/秒');
});

test('v3 剥出处：普通括注不剥', () => {
  assert.equal(stripCitations('认证系数提到 ×1.25（与同盟持平）'), '认证系数提到 ×1.25（与同盟持平）');
  assert.equal(stripCitations('52 条（含 5 条废止留痕）'), '52 条（含 5 条废止留痕）');
});

test('v3 剥出处：整段都是出处时退回原文，不判空', () => {
  assert.equal(stripCitations('（identity/accounts.md）'), '（identity/accounts.md）');
});

test('v3 出处里的数字不参与比较（旧规则最大的假红源）', () => {
  // 括号里 7–12 这种页内编号不许把「52 条」比成不一致
  assert.equal(
    V('52 条（projects/active/plugin-restore-2026-11-03.md：含 5 条废止留痕）', '52 条'),
    'same',
  );
});

// ---- v3：关键数字去噪 --------------------------------------------------

test('v3 日期 / 时刻 / 版本号 / 章节号不是关键数字', () => {
  assert.deepEqual([...coreNumbers('2026-11-05 23:15 拍板，v1.8 作废，见 §8.6')], []);
  assert.equal(V('旧口径已作废，v1.8 拍板统一 0–4 制', '百分制已作废，八维统一 0–4 制；综合 2.77、B 档'), 'same');
});

test('v3 取整差放行：9.5 分钟 ↔ 9 分半', () => {
  assert.equal(V('重渲 Live2D 3219 帧约 9.5 分钟', '返工重渲 Live2D 3219 帧，约 9 分半'), 'same');
});

test('v3 一方只是补充细节 → same；但 74 与 84、2.77 与 2.87 不算取整差', () => {
  assert.equal(V('selected-100 84 张', '101 张 = selected-100 84 + batch2 17'), 'same');
  assert.equal(covers(new Set(['84']), new Set(['74'])), false);
  assert.equal(covers(new Set(['2.77']), new Set(['2.87'])), false);
  assert.equal(covers(new Set(['9.5']), new Set(['9'])), true);
});

// ---- v3：实体先判 ------------------------------------------------------

test('v3 实体：点了不同程序 → review（不白给 same）', () => {
  const r = classify(
    A('NapCatWinBootMain.exe -q 1234567890 起废止，改 WebUI 6099'),
    A('旧法是 napcat.bat -q 后跟机器人 QQ 号，此做法已作废，现在开 WebUI 6099 扫码'),
  );
  assert.equal(r.verdict, 'review');
  assert.match(r.why, /不同程序\/文件/);
});

test('v3 实体：同一个文件、路径不同 → 不算冲突', () => {
  assert.equal(
    V('由 `C:\\Users\\me\\notify-qq.mjs` 接手', '由 notify-qq.mjs 接手，另配 dsh-onebot-qq'),
    'same',
  );
  assert.deepEqual([...fileEntities('见 a/b.md 与 a\\b.md')], ['b.md']);
});

// ---- v3：冲突分档 ------------------------------------------------------

test('v3 数字冲突但措辞近 → review（交人工，不硬判 diff 也不白给）', () => {
  assert.equal(V('综合 2.77、B 档、合格率 71%，最低维安全 D', '综合 2.87、B 档、合格率 71%，最低维安全 D'), 'review');
});

test('v3 数字互不相干且措辞远 → diff', () => {
  assert.equal(V('终态 101 张', '端口 62166'), 'diff');
});
