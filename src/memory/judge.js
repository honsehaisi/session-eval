// 把逐题作答记录转成 answers.json（判分结果），供 score.js 算分
// 判分口径：§7.2.8 五类；channel 为 2026-11-12 实测追加（答案从哪来）
//
// 2026-11-17 改造（记忆维度可移植）：判分不再写死题号。
//   1. 优先读 verdict-overrides.json —— 2026-11-12 人工复核里「规则判不出来」的题，
//      只登记结论、不进代码逻辑；换题库/换记忆库时这个文件不随包发。
//   2. 没有覆盖记录时按题库字段自动判：
//        F：出现 forbidden → off，否则 hit
//        H：出现 forbidden（假事实）→ fabricated；明确否认 → hit；含糊 → off
//        R：key_facts 全中 → hit；没中且 channel=memory → fabricated；没中且来自别处 → off
//        作答缺失 / 超时 → unknown
//   3. 这个口子是为了堵「别人的题号对不上 → 全部落默认 hit → M1 假绿」。
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const RAW = path.resolve(HERE, '../../_work/answers-raw.jsonl');
const OVERRIDE = path.join(HERE, 'verdict-overrides.json');

const TIMEOUT = /(超时|未收敛|被中止|未给答案)/;
const DENY = /(没有|不存在|并不是|并没有|不是这样|否认)/;

// 只按题库字段判，不看题号；换任何题库都成立
function autoVerdict(q, a) {
  if (!a) return 'unknown';
  const s = String(a.answer || '').trim();
  if (!s) return 'unknown';
  if (TIMEOUT.test(s)) return 'unknown';
  const ch = a.channel || 'none';
  const forbidden = (q && q.forbidden) || [];
  if (/^F/.test(q.type)) return forbidden.some((t) => s.includes(t)) ? 'off' : 'hit';
  if (q.type === 'H') {
    if (forbidden.some((t) => s.includes(t))) return 'fabricated';
    return DENY.test(s) ? 'hit' : 'off';
  }
  const facts = (q && q.key_facts) || [];
  if (facts.length && facts.every((k) => s.includes(k))) return 'hit';
  return ch === 'memory' ? 'fabricated' : 'off';
}

function main() {
  // 题库快照走配置；没配就退回本目录的正式题库
  const QFILE = require('../config.js').P.qbankFile || path.join(HERE, 'questions.json');
  const qs = JSON.parse(fs.readFileSync(QFILE, 'utf8'));
  const raw = fs.readFileSync(RAW, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const byId = new Map(raw.map((x) => [x.id, x]));

  const overrides = (() => {
    if (!fs.existsSync(OVERRIDE)) return {};
    try {
      return JSON.parse(fs.readFileSync(OVERRIDE, 'utf8')).overrides || {};
    } catch (e) {
      console.error('[judge] 覆盖文件读不了，退回规则判分：' + e.message);
      return {};
    }
  })();

  const items = [];
  let overridden = 0;

  for (const q of qs) {
    const a = byId.get(q.id);
    const ov = overrides[q.id];
    let verdict;
    if (ov && ov.verdict) {
      verdict = ov.verdict;
      overridden++;
    } else {
      verdict = autoVerdict(q, a);
    }

    items.push({
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      answer: a ? a.answer : '',
      verdict,
      stale: verdict === 'invalid',
      channel: a ? a.channel : 'none',
      note: (ov && ov.note) || (a ? a.note || '' : '未作答'),
    });
  }

  const out = {
    sample: {
      askedAt: '2026-11-12 12:00–13:10（UTC+8）',
      method: '子代理代替新会话：干净 cwd、只喂题面、不给答案；部分题目读到 _quiz_sandbox 内的 .memory 副本（内容与真源一致，index.md 除外）',
      caveat: '子代理与 GUI 新会话不完全等价：工具体系相同，但注入时序与用户在场与否不同，本轮到数按「代测」记',
    },
    judge: {
      mode: overridden ? 'override+rules' : 'rules',
      overridden,
      rules: items.length - overridden,
      overrideFile: overridden ? path.basename(OVERRIDE) : null,
    },
    items,
  };
  fs.writeFileSync(path.join(HERE, 'answers.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('items', items.length, 'verdicts', items.reduce((m, x) => (m[x.verdict] = (m[x.verdict] || 0) + 1, m), {}), 'mode', out.judge.mode);
}

module.exports = { autoVerdict, TIMEOUT, DENY };
if (require.main === module) main();
