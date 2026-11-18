// 综合评分（计划书 §2.2 / §2.3）
// 综合分 = Σ(权重 × 维度分) ÷ Σ(已覆盖维度的权重)
// 缺维从分母里拿掉再归一，不按 0 分算
// 加权用维度分（可含小数），不先四舍五入成字母
const NUM = { A: 4, B: 3, C: 2, D: 1, E: 0 };
const TIER = s => s === null || s === undefined ? null : (s >= 3.5 ? 'A' : s >= 2.5 ? 'B' : s >= 1.5 ? 'C' : s >= 0.5 ? 'D' : 'E');

function computeOverall(dims, weights) {
  const ids = Object.keys(weights);
  const covered = ids.filter(id => dims[id] && typeof dims[id].score === 'number');
  const totalW = covered.reduce((a, id) => a + weights[id], 0);
  const weighted = covered.reduce((a, id) => a + weights[id] * dims[id].score, 0);
  const ws = totalW > 0 ? weighted / totalW : null;
  const grade = TIER(ws) || 'uncovered';

  let lowest = [];
  if (covered.length) {
    const min = Math.min(...covered.map(id => dims[id].score));
    lowest = covered
      .filter(id => dims[id].score === min)
      .map(id => ({ dim: id, grade: dims[id].grade || TIER(dims[id].score) }));
  }

  const pass = covered.filter(id => dims[id].score >= 2.5).length;
  const passRate = covered.length ? Math.round(100 * pass / covered.length) : 0;

  // below_line：分数 < 2.5，按权重降序（同权重再按分数升序）
  const below = covered
    .filter(id => dims[id].score < 2.5)
    .sort((a, b) => (weights[b] - weights[a]) || (dims[a].score - dims[b].score));

  return {
    weighted_score: ws === null ? null : Math.round(ws * 100) / 100,
    grade,
    lowest,
    pass_rate: passRate,
    covered: covered.length,
    total: ids.length,
    below_line: below,
  };
}

module.exports = { computeOverall, TIER, NUM };
