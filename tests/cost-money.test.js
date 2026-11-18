// src/cost/money.js 口径自测：峰谷判定 + 单价表（§3.2）
// 不读真实日志：isPeak 只吃时间戳；P 是常量表
const test = require('node:test');
const assert = require('node:assert');
const { isPeak, P } = require('../src/cost/money.js');

const bj = (d) => Date.parse(d + '+08:00'); // 北京时间 → 时间戳

test('工作日高峰：9:00 起、12:00 止', () => {
  assert.equal(isPeak(bj('2026-11-12T09:00:00')), true);   // 边界内
  assert.equal(isPeak(bj('2026-11-12T11:59:00')), true);
  assert.equal(isPeak(bj('2026-11-12T08:59:00')), false);  // 边界外
  assert.equal(isPeak(bj('2026-11-12T12:00:00')), false);  // 边界外
});

test('工作日高峰：14:00 起、18:00 止', () => {
  assert.equal(isPeak(bj('2026-11-12T14:00:00')), true);
  assert.equal(isPeak(bj('2026-11-12T17:59:00')), true);
  assert.equal(isPeak(bj('2026-11-12T13:59:00')), false);
  assert.equal(isPeak(bj('2026-11-12T18:00:00')), false);
});

test('周末全天低谷，哪怕在 9–12 点', () => {
  // 2026-11-14 周六 / 11-15 周日
  assert.equal(isPeak(bj('2026-11-14T10:00:00')), false);
  assert.equal(isPeak(bj('2026-11-15T15:00:00')), false);
});

test('凌晨与深夜不是高峰', () => {
  assert.equal(isPeak(bj('2026-11-12T01:00:00')), false);
  assert.equal(isPeak(bj('2026-11-12T23:30:00')), false);
});

test('单价表：高峰各项恰好是低谷的 2 倍', () => {
  assert.equal(P.peak.hit, P.low.hit * 2);
  assert.equal(P.peak.miss, P.low.miss * 2);
  assert.equal(P.peak.out, P.low.out * 2);
  // 基价与官方文档一致（USD / 1M tokens，2026-11-11 查证）
  assert.equal(P.low.hit, 0.003);
  assert.equal(P.low.miss, 0.15);
  assert.equal(P.low.out, 0.60);
});

// ---- P1: isOver 纯函数 ----
const { isOver } = require('../src/cost/money.js');

test('P1: isOver 严格大于阈值，等于不算超（与旧 s.low>thr 等价）', () => {
  assert.equal(isOver(0.0704, 0.0704), false);
  assert.equal(isOver(0.0705, 0.0704), true);
  assert.equal(isOver(0.0703, 0.0704), false);
  assert.equal(isOver(0, 0.0704), false);
});
