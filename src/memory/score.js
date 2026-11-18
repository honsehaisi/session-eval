// 记忆维度算分：读 answers.json（判分结果）→ M1/M2/M3 → 档 → 维度分
// 口径唯一真源：docs/计划书.md §7（7.1 分母、7.3 四档线、7.2.8 判分五类）
// 用法：node src/memory/score.js
//
// 2026-11-12 追加（实测发现）：作答代理会用联网搜索/配置文件/记忆备份回答，
// 所以每题除了 verdict（对错）还记 channel（答案从哪来）。
//   M1 主口径 = 只算 channel=memory 的命中（「从记忆里召回」）
//   M1 宽松口径 = 所有 verdict=hit（「答对了」）——单列，不进维度分
// 这一条是对 §7.2.8 的补充，已在 report.json 的 notes 里写明。

const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, 'report.json');

const SCORE = { A: 4, B: 3, C: 2, D: 1, E: 0 };

function tierM1(v) { return v >= 95 ? 'A' : v >= 85 ? 'B' : v >= 70 ? 'C' : v >= 50 ? 'D' : 'E'; }
function tierM3(v) { return v >= 98 ? 'A' : v >= 95 ? 'B' : v >= 90 ? 'C' : v >= 80 ? 'D' : 'E'; }
function tierM2(v) { return v === 0 ? 'A' : v <= 2 ? 'B' : v <= 5 ? 'C' : v <= 10 ? 'D' : 'E'; }

function main(){
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'answers.json'), 'utf8'));
const items = raw.items.filter((x) => !x.stale);

const R = items.filter((x) => /^R/.test(x.type));
const H = items.filter((x) => x.type === 'H');
const F = items.filter((x) => x.type === 'F');

const memHit = (x) => x.verdict === 'hit' && x.channel === 'memory';
const anyHit = (x) => x.verdict === 'hit';
const fabricated = (x) => x.verdict === 'fabricated';

const m1 = R.length ? R.filter(memHit).length / R.length : null;
const m1Loose = R.length ? R.filter(anyHit).length / R.length : null;
const m2 = items.length ? items.filter(fabricated).length / items.length : null;
const m3 = F.length ? F.filter(anyHit).length / F.length : null;

const t1 = m1 === null ? null : tierM1(m1 * 100);
const t2 = m2 === null ? null : tierM2(m2 * 100);
const t3 = m3 === null ? null : tierM3(m3 * 100);

const w = { M1: 5, M2: 3, M3: 2 };
const parts = [['M1', m1, t1], ['M2', m2, t2], ['M3', m3, t3]].filter((p) => p[2]);
const denom = parts.reduce((s, p) => s + w[p[0]], 0);
const dim = parts.reduce((s, p) => s + w[p[0]] * SCORE[p[2]], 0) / denom;
const dimTier = dim >= 3.5 ? 'A' : dim >= 2.5 ? 'B' : dim >= 1.5 ? 'C' : dim >= 0.5 ? 'D' : 'E';

// 敏感性：若不区分通道（只要答对就算），分数会变成多少
const looseParts = [['M1', m1Loose, tierM1(m1Loose * 100)], ['M2', m2, t2], ['M3', m3, t3]];
const looseDim = looseParts.reduce((s, p) => s + w[p[0]] * SCORE[p[2]], 0) / denom;

const report = {
  generatedAt: new Date().toISOString(),
  sample: raw.sample || null,
  counts: {
    total: items.length,
    recall: R.length, hallucination: H.length, forgetting: F.length,
    stale: raw.items.length - items.length,
  },
  rates: { M1: m1, M1Loose: m1Loose, M2: m2, M3: m3 },
  tiers: { M1: t1, M2: t2, M3: t3 },
  partial: parts.length < 3,
  dimensionScore: Number(dim.toFixed(2)),
  dimensionTier: dimTier,
  sensitivity: { ifChannelIgnored: Number(looseDim.toFixed(2)), note: '只算「答对」，不区分是记忆召回还是联网/配置文件' },
  channelHistogram: items.reduce((m, x) => (m[x.channel] = (m[x.channel] || 0) + 1, m), {}),
  verdictHistogram: items.reduce((m, x) => (m[x.verdict] = (m[x.verdict] || 0) + 1, m), {}),
  composition: '0.5*M1 + 0.3*M2 + 0.2*M3（§7.1），分档按 §7.3 与 §0.8 第 1–3 条',
  notes: ['M1 主口径只算 channel=memory；联网/配置/备份答对的记在 M1Loose',
    'M1/M2/M3 分母各自定义：召回题数 / 全部题数 / 应忘题数（§7.1 注）'],
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));
}
if (require.main === module) main();
module.exports = { SCORE, tierM1, tierM2, tierM3 };
