// src/advice/index.js 口径自测（计划书 §5.5）
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { generate } = require('../src/advice/index.js');

const W = { safety: 0.20, stability: 0.15, delivery: 0.15, honesty: 0.15, memory: 0.10, speed: 0.10, cost: 0.075, consistency: 0.075 };

function mock(dims) {
  return { meta: { weights: W }, dims, overall: { below_line: [] } };
}

test('坏数据：成本 + 安全各出建议，含 evidence 且不编因果', () => {
  const r = generate(mock({
    cost: { score: 0, grade: 'E', avg_cny: 3.4, total_cny: 520, c2_pct: 72.5, over: 110, sessions: 204 },
    safety: { score: 1, grade: 'D', a1_per_k: 5.54, a2_pct: 55.7, top_rule: 'F1', top_rule_n: 111 },
    stability: { score: 3.6, grade: 'A', t2: 3.59 },
    delivery: { score: 4, grade: 'A', delivery_pct: 87.6 },
    memory: { score: 3.2, grade: 'B', m3: 0.6 },
    honesty: { score: 3, grade: 'B', wide_pct: 79.6 },
    speed: { score: 3, grade: 'B' },
    consistency: { score: null, grade: 'uncovered' },
  }));
  const dims = r.map(x => x.dim);
  assert.ok(dims.includes('cost'), '成本建议缺失');
  assert.ok(dims.includes('safety'), '安全建议缺失');
  assert.ok(r.length >= 2);
  r.forEach(s => {
    assert.ok(Array.isArray(s.evidence) && s.evidence.length > 0, s.dim + ' 缺 evidence');
    assert.ok(s.finding && s.finding.length > 0, s.dim + ' 缺 finding');
    assert.ok(s.action && s.action.length > 0, s.dim + ' 缺 action');
  });
});

test('cost 改成 A 后，成本建议消失', () => {
  const base = {
    cost: { score: 0, grade: 'E', avg_cny: 3.4, total_cny: 520, c2_pct: 72.5, over: 110, sessions: 204 },
    safety: { score: 1, grade: 'D', a1_per_k: 5.54, a2_pct: 55.7 },
    stability: { score: 3.6, grade: 'A', t2: 3.59 },
    delivery: { score: 4, grade: 'A', delivery_pct: 87.6 },
    memory: { score: 3.2, grade: 'B', m3: 0.6 },
    honesty: { score: 3, grade: 'B', wide_pct: 79.6 },
    speed: { score: 3, grade: 'B' },
    consistency: { score: null, grade: 'uncovered' },
  };
  const before = generate(mock(base)).map(x => x.dim);
  assert.ok(before.includes('cost'));
  const after = generate(mock(Object.assign({}, base, { cost: { score: 4, grade: 'A', avg_cny: 0.2, total_cny: 30, c2_pct: 0, over: 0, sessions: 204 } }))).map(x => x.dim);
  assert.ok(!after.includes('cost'), '成本已 A 但建议还在');
});

test('全部 ≥2.5：只出 ok 一条', () => {
  const r = generate(mock({
    cost: { score: 3, grade: 'B', avg_cny: 0.5, total_cny: 25, c2_pct: 10, over: 5, sessions: 50 },
    safety: { score: 3, grade: 'B', a1_per_k: 0.5, a2_pct: 90 },
    stability: { score: 3.6, grade: 'A', t2: 3 },
    delivery: { score: 4, grade: 'A', delivery_pct: 90 },
    memory: { score: 3.2, grade: 'B', m3: 0.95 },
    honesty: { score: 3, grade: 'B', wide_pct: 80 },
    speed: { score: 3, grade: 'B' },
    consistency: { score: 3, grade: 'B', pct: 85 },
  }));
  assert.equal(r.length, 1);
  assert.equal(r[0].severity, 'ok');
});

test('排序 priority 升序、权重降序，且上限 10', () => {
  const r = generate(mock({
    cost: { score: 0, grade: 'E', avg_cny: 3.4, total_cny: 520, c2_pct: 72.5, over: 110, sessions: 204 },
    safety: { score: 1, grade: 'D', a1_per_k: 5.54, a2_pct: 55.7 },
    stability: { score: 1, grade: 'D', t2: 9 },
    delivery: { score: 1, grade: 'D', delivery_pct: 20 },
    memory: { score: 1.4, grade: 'D', m3: 0.4 },
    honesty: { score: 1, grade: 'D', wide_pct: 50 },
    speed: { score: 1, grade: 'D' },
    consistency: { score: 1, grade: 'D', pct: 50 },
  }));
  assert.ok(r.length <= 10);
  for (let i = 1; i < r.length; i++) {
    const a = r[i - 1], b = r[i];
    if (a.priority !== b.priority) assert.ok(a.priority < b.priority, 'priority 未升序');
    else assert.ok(W[a.dim] >= W[b.dim], '同 priority 未按权重降序');
  }
});

test('示例 report：evidence 指向的字段真实存在', () => {
  const p = path.join(__dirname, 'fixtures', 'report.sample.json');
  const report = JSON.parse(fs.readFileSync(p, 'utf8'));
  const sug = generate(report);
  assert.ok(sug.length >= 2, '示例数据应至少 2 条');
  sug.forEach(s => {
    s.evidence.forEach(e => {
      const m = e.match(/^report\.json:\s*([\w.]+)/);
      if (!m) return; // 明细文件证据不查
      let cur = report;
      for (const k of m[1].split('.')) {
        assert.ok(cur && Object.prototype.hasOwnProperty.call(cur, k), 'evidence 字段不存在: ' + m[1]);
        cur = cur[k];
      }
    });
  });
});
