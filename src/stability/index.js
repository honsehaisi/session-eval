// 稳定性维度（计划书 §3.2）
// T1 = isError=true 的 tool/result ÷ tool/result 总数 ×100（排除子会话）
// T2 = {aborted, interrupted, error} 的 turn/end ÷ turn/end 总数 ×100（含子会话）
// blocked 是拦截成功，不算 T2（它不在集合里，天然排除）
const fs = require('fs'), path = require('path');
const { loadCached } = require('../dataset.js');

const T1_TIER = v => v <= 5 ? 'A' : v <= 10 ? 'B' : v <= 20 ? 'C' : v <= 35 ? 'D' : 'E';
const T2_TIER = v => v <= 2 ? 'A' : v <= 5 ? 'B' : v <= 10 ? 'C' : v <= 20 ? 'D' : 'E';
const NUM = { A: 4, B: 3, C: 2, D: 1, E: 0 };
const GRADE = s => s >= 3.5 ? 'A' : s >= 2.5 ? 'B' : s >= 1.5 ? 'C' : s >= 0.5 ? 'D' : 'E';

function main() {
  let tr = 0, trErr = 0, te = 0, teAbn = 0;
  for (const sess of loadCached().sessions) {
    if (sess.err) continue;
    const isSub = sess.meta.origin === 'subagent';
    for (const e of sess.events) {
      if (e.type === 'tool_result' && !isSub) {
        tr++;
        if (e.isError === true) trErr++;
      } else if (e.type === 'turn_end') {
        te++;
        const k = e.reasonKind;
        if (k === 'aborted' || k === 'interrupted' || k === 'error') teAbn++;
      }
    }
  }
  const t1 = tr ? (100 * trErr / tr) : null;
  const t2 = te ? (100 * teAbn / te) : null;
  const g1 = t1 === null ? null : T1_TIER(t1);
  const g2 = t2 === null ? null : T2_TIER(t2);
  const parts = [];
  if (g1) parts.push([0.6, g1]);
  if (g2) parts.push([0.4, g2]);
  const denom = parts.reduce((a, p) => a + p[0], 0);
  const score = denom ? parts.reduce((a, p) => a + p[0] * NUM[p[1]], 0) / denom : null;
  const out = {
    dim: 'stability',
    t1: t1 === null ? null : +t1.toFixed(2),
    t2: t2 === null ? null : +t2.toFixed(2),
    t1_score: g1 ? NUM[g1] : null,
    t2_score: g2 ? NUM[g2] : null,
    score: score === null ? null : +score.toFixed(2),
    grade: score === null ? 'uncovered' : GRADE(score),
    tool_results: tr, errors: trErr, turn_ends: te, abnormal: teAbn,
    blocked_excluded: true,
  };
  fs.writeFileSync(path.join(__dirname, 'report.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out));
}
if (require.main === module) main();
module.exports = { T1_TIER, T2_TIER, NUM, GRADE };
