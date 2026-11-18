// 一致性判分的纯函数（可测，不碰文件）
const norm = (s) => String(s || '').replace(/\s+/g, '').trim();
const nums = (s) => (String(s || '').match(/\d+(?:\.\d+)?/g) || []).slice().sort().join('|');

function bigrams(s) {
  const t = norm(s); const set = new Set();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// 严判（§6.5）：核心结论 + 关键数字都要对上
function classify(a, b) {
  if (!b) return { verdict: 'missing' };
  const va = a.verdict || '', vb = b.verdict || '';
  if (va === 'unknown' && vb === 'unknown') return { verdict: 'same', why: '都答不知道' };
  if (va !== vb) return { verdict: 'diff', why: `判定不同 ${va}→${vb}` };
  if (nums(a.answer) === nums(b.answer)) return { verdict: 'same', why: '数字集一致' };
  const sim = jaccard(bigrams(a.answer), bigrams(b.answer));
  return sim >= 0.7
    ? { verdict: 'review', why: `数字不同但措辞近 sim=${sim.toFixed(2)}` }
    : { verdict: 'diff', why: `数字不同且措辞远 sim=${sim.toFixed(2)}` };
}

module.exports = { norm, nums, bigrams, jaccard, classify };
