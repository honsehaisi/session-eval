// 一致性判分的纯函数（可测，不碰文件）
//
// v3 口径（2026-11-19）：
//   1. 比较前先剥「出处括注」——T0′ 的答案爱把（identity/accounts.md：…）挂在结论后面，
//      里面的数字和路径全不是答案，旧规则直接拿数字比 → 29 条假红（strict 47.3% / E）。
//   2. 关键数字去噪：日期（2026-11-05）、时刻（23:00）、版本号（v1.8）、章节号（§8.6）
//      不算关键数字；小数允许 ±0.5 / 2% 的取整差（「9.5 分钟」↔「9 分半」）。
//   3. 实体先判：两边都点到程序/文件名（.exe/.bat/.mjs/.md…）且一个都不重合 → review，
//      这是真分歧（F-005：NapCatWinBootMain.exe ↔ napcat.bat），不能算 same。
//   4. 数字只要一方能覆盖另一方（另一方只是补充细节）就算 same；互不相干才往下走。
//   5. 剩下的冲突按措辞距离分档：措辞也远 → diff；措辞近 → review（交人工）。
//
// 已知边界：纯文字对（双方都没有关键数字，本批 30/55）v3 没有可比的硬证据，只能报
// 「无冲突」——它排除矛盾，不证明等价。正式数仍以人工全量判的 judge-t1-manual.json 为准。

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

// ---- 出处剥除 ----------------------------------------------------------

// 括注里出现这些后缀（且带路径或本身就是页面名）就当出处
const CITE_EXT = /\.(?:md|json|jsonl|js|cjs|mjs|ps1|py|sh|cmd|bat|exe|txt|html)\b/i;
const looksLikeCitation = (group) => {
  const inner = group.slice(1, -1);
  if (!CITE_EXT.test(inner)) return false;
  // 「5 条」这类普通括注没有文件名后缀，天然被上面挡掉
  return /[/\\]/.test(inner) || /\.(?:md|json|jsonl)\b/i.test(inner);
};

/** 剥掉出处括注；整段都是出处时退回原文（别把答案剥成空） */
function stripCitations(s) {
  let t = String(s || '').replace(/\r\n/g, '\n');
  for (let i = 0; i < 3; i++) {
    t = t.replace(/[（(][^（()）]{0,200}?[)）]/g, (m) => (looksLikeCitation(m) ? '' : m));
  }
  const out = t.replace(/[ \t]+/g, ' ').replace(/\n+/g, ' ').trim();
  return out || String(s || '').trim();
}

// ---- 关键数字 ----------------------------------------------------------

const DATE = /\d{4}-\d{2}-\d{2}/g;
const CLOCK = /\d{1,2}:\d{2}(?::\d{2})?/g;
const VERSION = /\bv\d+(?:\.\d+)*\b/gi;
const SECTION = /§\s*\d+(?:\.\d+)*/g;

/** 关键数字集合（日期/时刻/版本号/章节号去掉） */
function coreNumbers(s) {
  const t = String(s || '')
    .replace(DATE, ' ')
    .replace(CLOCK, ' ')
    .replace(VERSION, ' ')
    .replace(SECTION, ' ');
  return new Set(t.match(/\d+(?:\.\d+)?/g) || []);
}

/**
 * 取整差容差：9.5 ↔ 9 视为同一个数（一边是整数、差 ≤ 0.5）；62166 ↔ 62167 放得过（2%）。
 * 注意别放太宽：2.77 与 2.87 只差 3.6%，但那是真差，不能算同一条。
 */
function nearNum(x, y) {
  const a = Number(x), b = Number(y);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a === b) return true;
  const d = Math.abs(a - b);
  if ((Number.isInteger(a) !== Number.isInteger(b)) && d <= 0.5) return true;
  return d / Math.max(Math.abs(a), Math.abs(b), 1e-9) <= 0.02;
}

/** a 里每个数都能在 b 里找到（允许取整差）；空集视为被任何集合覆盖 */
function covers(a, b) {
  for (const x of a) {
    let hit = false;
    for (const y of b) if (nearNum(x, y)) { hit = true; break; }
    if (!hit) return false;
  }
  return true;
}

// ---- 实体（程序 / 文件 / 页面名）--------------------------------------

const ENTITY = /[\w.\-\\/]*[\w\-]\.(?:exe|bat|cmd|ps1|cjs|mjs|js|json|jsonl|md|py|sh|html|txt)\b/gi;
const basename = (p) => p.split(/[\\/]/).pop().toLowerCase();

/** 程序/文件名集合（只取 basename，路径不同不影响） */
function fileEntities(s) {
  return new Set((String(s || '').match(ENTITY) || []).map(basename));
}
const shares = (a, b) => { for (const x of a) if (b.has(x)) return true; return false; };

// ---- 判分 --------------------------------------------------------------

// 严判（§6.2）：核心结论 + 关键数字都要对上
function classify(a, b) {
  if (!b) return { verdict: 'missing' };
  const va = a.verdict || '', vb = b.verdict || '';
  if (va === 'unknown' && vb === 'unknown') return { verdict: 'same', why: '都答不知道' };
  if (va !== vb) return { verdict: 'diff', why: `判定不同 ${va}→${vb}` };

  const ta = stripCitations(a.answer);
  const tb = stripCitations(b.answer);

  const ea = fileEntities(ta), eb = fileEntities(tb);
  if (ea.size && eb.size && !shares(ea, eb)) {
    return { verdict: 'review', why: `引用了不同程序/文件 ${[...ea].join(',')} vs ${[...eb].join(',')}` };
  }

  const na = coreNumbers(ta), nb = coreNumbers(tb);
  if (covers(na, nb) || covers(nb, na)) {
    const why = (!na.size && !nb.size)
      ? '无冲突证据（双方都无关键数字）'
      : '关键数字一方覆盖另一方';
    return { verdict: 'same', why };
  }

  const sim = jaccard(bigrams(ta), bigrams(tb));
  if (sim < 0.15) return { verdict: 'diff', why: `关键数字互不相干且措辞远 sim=${sim.toFixed(2)}` };
  return { verdict: 'review', why: `关键数字冲突但措辞近 sim=${sim.toFixed(2)}` };
}

module.exports = {
  norm, nums, bigrams, jaccard,
  stripCitations, coreNumbers, nearNum, covers, fileEntities,
  classify,
};
