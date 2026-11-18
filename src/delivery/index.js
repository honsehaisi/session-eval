// 交付维度（计划书 §3.4）：会话级
// 交付率 = 有产物动作的会话数 ÷ 有 turn/start 的会话数 ×100（排除子会话）
// 空会话（无 turn/start）不进分母，单列 idle_rate
const fs = require('fs'), path = require('path');
const { loadCached } = require('../dataset.js');
const { cfg } = require('../config.js');
const NUM = { A: 4, B: 3, C: 2, D: 1, E: 0 };
const TIER = v => v >= 70 ? 'A' : v >= 50 ? 'B' : v >= 30 ? 'C' : v >= 15 ? 'D' : 'E';

// 产物工具名：DSH 的固定名单 + config.generic.productTools（通用日志用自己的工具名）
const PRODUCT = new Set(['ops_write_file', 'write', 'edit', 'ops_edit_file', 'ops_replace', 'generate_image', 'generate_images']);
for (const n of ((cfg && cfg.generic && cfg.generic.productTools) || [])) {
  if (n) PRODUCT.add(String(n));
}
function isProduct(name, args) {
  if (PRODUCT.has(name)) return true;
  if (typeof name === 'string' && name.startsWith('ffmpeg_')) return true;
  if (name === 'ops_bash' && typeof args === 'string' && /git\s+(commit|push)/.test(args)) return true;
  return false;
}

function main() {
  let total = 0, withTurn = 0, delivered = 0, idle = 0, answerDelivered = 0;
  for (const sess of loadCached().sessions) {
    if (sess.err) continue;
    if (sess.meta.origin === 'subagent') continue;
    total++;
    const hasTurn = sess.events.some(e => e.type === 'turn_start');
    if (!hasTurn) { idle++; continue; }
    withTurn++;
    const prod = sess.events.some(e => e.type === 'tool_call' && isProduct(e.name, e.rawArgs));
    if (prod) delivered++;
    let lastText = '';
    for (const e of sess.events) {
      if (e.type === 'assistant_text' && e.texts.length) lastText = e.texts[e.texts.length - 1];
    }
    if (lastText.trim()) answerDelivered++;
  }
  const pct = withTurn ? 100 * delivered / withTurn : null;
  const idleRate = total ? 100 * idle / total : 0;
  const g = pct === null ? null : TIER(pct);
  const out = {
    dim: 'delivery',
    delivery_pct: pct === null ? null : +pct.toFixed(1),
    delivered, with_turn: withTurn,
    idle_rate: +idleRate.toFixed(1), idle, total_sessions: total,
    answer_delivered: answerDelivered,
    score: g ? NUM[g] : null, grade: g || 'uncovered',
  };
  fs.writeFileSync(path.join(__dirname, 'report.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out));
}
if (require.main === module) main();
module.exports = { TIER, NUM, isProduct };
