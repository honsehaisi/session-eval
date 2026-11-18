#!/usr/bin/env node
// 分母对账：解释计划书里 184 / 182 / 176 / 173 这几个「主会话数」差在哪。
// 只读日志；不改变 segment.js 的判定。所有数字都按一个显式 cutoff 重算，
// 所以「同一快照」是可复现的，不靠猜。
//
// 输入：dataset 的标准事件流（与 segment.js 同源）。按 cutoff 过滤的是事件时间，
// 与改造前「按记录时间过滤」等价——记录里能进分析的字段都已经被适配器映射成事件。
//
// 用法：
//   node src/tasks/reconcile.js                 # 主快照 = report.json 的 sample.startedAt
//   node src/tasks/reconcile.js --at 2026-11-11T23:00:00+08:00
//   node src/tasks/reconcile.js --scan          # 额外打印 11-11 00:00–11-12 12:00 的逐小时变化
const fs = require('fs');
const path = require('path');
const { loadParsed, segmentSession, run, gradeDelivery } = require('./segment.js');
const { sourceGlob } = require('../dataset.js');

const OUT = path.join(__dirname, 'reconcile.json');
const SESSIONS_BASE = require('../config.js').P.sessionsDir;
const CFG = { N: 3, idleMs: 4 * 3600 * 1000, useIdle: true, useKeywords: true, multiTurnOnly: false, strictFileProducts: false };
// 计划书 §4.2 的旧产物白名单（写文件 / 生图 / ffmpeg 成品 / git 提交）。
// 注意：不含 bash 重定向、present、qq_send_*，也不含 ffmpeg_storyboard/frames 这类检查图。
const OLD_WL = new Set(['write', 'edit', 'ops_write_file', 'ops_edit_file', 'ops_replace',
  'generate_image', 'generate_images', 'edit_image',
  'ffmpeg_encode', 'ffmpeg_concat', 'ffmpeg_cut', 'ffmpeg_adjust', 'ffmpeg_subtitle', 'ffmpeg_gif', 'ffmpeg_extract']);

function readPrimaryCutoff() {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(__dirname, 'report.json'), 'utf8'));
    if (r.sample && r.sample.startedAt) return Date.parse(r.sample.startedAt);
  } catch (e) { /* 没有 report.json 就用现在 */ }
  return Date.now();
}

// 用 cutoff 重建快照：会话 createdAt <= cutoff，事件 time <= cutoff。
function snapshotAt(full, cutoff) {
  const parsed = [];
  for (const x of full.parsed) {
    if (!x.meta.createdAt || x.meta.createdAt > cutoff) continue;
    const events = x.events.filter(e => !e.time || e.time <= cutoff);
    let latest = 0;
    for (const e of events) if (e.time && e.time > latest) latest = e.time;
    parsed.push({ id: x.id, meta: x.meta, events, recsCount: events.length, parseErr: x.parseErr, latest });
  }
  return { parsed, errs: full.errs, files: parsed.length, startedAt: Date.now() };
}

function classify(s) {
  const evs = s.events, meta = s.meta;
  const types = {};
  for (const e of evs) types[e.type] = (types[e.type] || 0) + 1;
  const ends = evs.filter(e => e.type === 'turn_end');
  const reasons = new Set(ends.map(e => e.reasonKind || ''));
  const completed = reasons.has('completed');
  const seg = segmentSession(evs, CFG, meta);
  const prods = seg.turns.flatMap(t => t.products);
  const ver = prods.filter(p => p.verified);
  return {
    id: s.id,
    createdAt: meta.createdAt,
    origin: meta.origin || 'main',
    parentSession: meta.parentSession || null,
    depth: meta.delegationDepth == null ? null : meta.delegationDepth,
    originMain: meta.origin !== 'subagent',
    main: !(meta.origin === 'subagent' || meta.parentSession),
    recs: evs.length,          // 注：改造前是「源记录条数」，这里只用于 >1 判「不止一条」，两者在该快照上等价
    turnStart: types.turn_start || 0,
    turnEnd: ends.length,
    usage: types.usage || 0,
    toolCall: types.tool_call || 0,
    assistant: types.assistant_text || 0,
    user: types.user_message || 0,
    stepStart: 0,              // 标准事件里没有 step 边界事件，这一列从来没有消费方
    completed,
    abortedOnly: ends.length > 0 && !completed,
    reasons: [...reasons],
    active: seg.turns.length > 0,
    tasks: seg.tasks.length,
    hasAnyProduct: prods.length > 0,
    hasVerifiedProduct: ver.length > 0,
    hasFileProduct: ver.some(p => p.cls !== 'message'),
    hasOldWhitelist: ver.some(p => OLD_WL.has(p.name)),
    hasWriteEdit: ver.some(p => ['write', 'edit', 'ops_write_file', 'ops_edit_file'].includes(p.name)),
    hasMessage: ver.some(p => p.cls === 'message'),
  };
}

function summarize(rows, taskRun) {
  const main = rows.filter(r => r.main);
  const cnt = (f) => main.filter(f).length;
  const den = {
    allSessions: rows.length,
    originMain: rows.filter(r => r.originMain).length,
    main: main.length,
    parentOnly: rows.filter(r => r.originMain && r.parentSession).length,
    mainActive: cnt(r => r.active),
    mainZeroTurn: cnt(r => !r.active),
    mainToolCall: cnt(r => r.toolCall > 0),
    mainAnyRecord: cnt(r => r.recs > 1),
    mainUsage: cnt(r => r.usage > 0),
    mainAssistant: cnt(r => r.assistant > 0),
    mainCompleted: cnt(r => r.completed),
    mainAbortedOnly: cnt(r => r.abortedOnly),
    mainVerifiedAny: cnt(r => r.hasVerifiedProduct),
    mainVerifiedFile: cnt(r => r.hasFileProduct),
    mainOldWhitelist: cnt(r => r.hasOldWhitelist),
    mainWriteEdit: cnt(r => r.hasWriteEdit),
    allWithTurns: rows.filter(r => r.active).length,
    allWithToolCall: rows.filter(r => r.toolCall > 0).length,
  };
  const zeroTurn = den.main - den.mainActive;
  const tasks = taskRun.tasks.length;
  const taskAny = taskRun.productTasks;
  const strictRun = run({ ...CFG, strictFileProducts: true }, taskRun.snap);
  const taskFile = strictRun.productTasks;
  const sessionLevel = [
    { label: '会话级 · 含零 turn 主会话 · 任意已验证产物', num: den.mainVerifiedAny, den: den.main },
    { label: '会话级 · 含零 turn 主会话 · 仅文件/图片/视频', num: den.mainVerifiedFile, den: den.main },
    { label: '会话级 · 含零 turn 主会话 · 旧白名单', num: den.mainOldWhitelist, den: den.main },
    { label: '会话级 · 只含非 0 turn 主会话 · 任意已验证产物', num: den.mainVerifiedAny, den: den.mainActive },
    { label: '会话级 · 只含非 0 turn 主会话 · 仅文件/图片/视频', num: den.mainVerifiedFile, den: den.mainActive },
    { label: '会话级 · 只含非 0 turn 主会话 · 旧白名单', num: den.mainOldWhitelist, den: den.mainActive },
  ].map(x => ({ ...x, rate: x.den ? x.num / x.den : null, grade: x.den ? gradeDelivery(x.num / x.den) : null }));
  const taskLevel = [
    { label: '任务级 · 只含任务段 · 任意已验证产物', num: taskAny, den: tasks },
    { label: '任务级 · 只含任务段 · 仅文件/图片/视频', num: taskFile, den: tasks },
    { label: '任务级 · 含零 turn（每会话按 1 个未交付任务）· 任意已验证产物', num: taskAny, den: tasks + zeroTurn },
    { label: '任务级 · 含零 turn（每会话按 1 个未交付任务）· 仅文件/图片/视频', num: taskFile, den: tasks + zeroTurn },
  ].map(x => ({ ...x, rate: x.den ? x.num / x.den : null, grade: x.den ? gradeDelivery(x.num / x.den) : null }));
  return { denominators: den, sessionLevel, taskLevel, zeroTurn, tasks, taskAny, taskFile };
}

function fullAt(full, cutoff) {
  const snap = snapshotAt(full, cutoff);
  const rows = snap.parsed.map(classify);
  const taskRun = run(CFG, snap);
  taskRun.snap = snap;
  return { snap, rows, taskRun, summary: summarize(rows, taskRun) };
}

function scan(full, from, to) {
  const out = [];
  for (let t = from; t <= to; t += 3600 * 1000) {
    const snap = snapshotAt(full, t);
    let originMain = 0, main = 0, parentOnly = 0, active = 0, completed = 0, abortedOnly = 0;
    for (const s of snap.parsed) {
      const evs = s.events, meta = s.meta;
      const os = meta.origin === 'subagent', p = !!meta.parentSession;
      if (!os) originMain++;
      if (os || p) continue;
      main++;
      const ends = evs.filter(e => e.type === 'turn_end');
      const reasons = new Set(ends.map(e => e.reasonKind || ''));
      if (evs.some(e => e.type === 'turn_start')) active++;
      if (reasons.has('completed')) completed++;
      if (ends.length && !reasons.has('completed')) abortedOnly++;
    }
    out.push({ t: new Date(t).toISOString(), total: snap.files, originMain, parentOnly, main, active, zeroTurn: main - active, completed, abortedOnly });
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const atIdx = args.indexOf('--at');
  const full = loadParsed();
  const primaryCutoff = atIdx >= 0 && args[atIdx + 1] ? Date.parse(args[atIdx + 1]) : readPrimaryCutoff();
  if (!isFinite(primaryCutoff)) throw new Error('bad --at');

  const primary = fullAt(full, primaryCutoff);
  const S = primary.summary;
  const parentOnlyRows = primary.rows.filter(r => r.originMain && r.parentSession);
  const zeroTurnRows = primary.rows.filter(r => r.main && !r.active);

  // 目标数：184 / 182 / 176 / 173 分别落在哪个定义上
  const targets = {};
  for (const n of [184, 182, 176, 173]) {
    const hits = [];
    for (const [k, v] of Object.entries(S.denominators)) if (v === n) hits.push(k);
    targets[n] = { hits, exact: hits.length > 0 };
  }

  // 历史快照：找 176 / 173 / 182 各自出现的时段
  const from = Date.parse('2026-11-11T00:00:00+08:00');
  const to = Math.min(Date.parse('2026-11-12T12:00:00+08:00'), primaryCutoff);
  const hist = scan(full, from, to);
  for (const n of [182, 176, 173]) {
    const rows = hist.filter(r => r.main === n);
    targets[n].history = rows.length ? { mainEquals: n, first: rows[0].t, last: rows[rows.length - 1].t, hours: rows.length } : null;
  }

  // 旧数的「同一快照」对照：119 / 112 分别在哪一刻出现
  const cut11_23 = Date.parse('2026-11-11T23:00:00+08:00');
  const cut11_22 = Date.parse('2026-11-11T22:00:00+08:00');
  const cut12_1107 = Date.parse('2026-11-12T11:07:00+08:00');
  const olds = [cut11_22, cut11_23, cut12_1107].map(t => {
    const f = fullAt(full, t);
    return {
      cutoff: new Date(t).toISOString(),
      local: new Date(t + 8 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16),
      denominators: f.summary.denominators,
      sessionLevel: f.summary.sessionLevel,
    };
  });

  const report = {
    meta: {
      title: '主会话分母对账（184 / 182 / 176 / 173）',
      generatedAt: new Date().toISOString(),
      primaryCutoff: new Date(primaryCutoff).toISOString(),
      source: SESSIONS_BASE + '/' + sourceGlob(),
      script: 'src/tasks/reconcile.js',
      rules: { main: 'origin != subagent AND parentSession 为空（§0.8 第 6 条）', config: CFG },
    },
    primary: {
      sample: {
        cutoff: new Date(primaryCutoff).toISOString(),
        sessionFiles: primary.snap.files,
        main: S.denominators.main,
        originMain: S.denominators.originMain,
        parentOnly: S.denominators.parentOnly,
        active: S.denominators.mainActive,
        zeroTurn: S.denominators.mainZeroTurn,
        tasks: S.tasks,
      },
      denominators: S.denominators,
      parentOnlySessions: parentOnlyRows.map(r => ({ id: r.id, origin: r.origin, depth: r.depth, parentSession: r.parentSession })),
      zeroTurnSessions: zeroTurnRows.map(r => r.id),
      sessionLevel: S.sessionLevel,
      taskLevel: S.taskLevel,
    },
    targets,
    history: hist,
    oldSnapshots: olds,
    verdict: [
      '184 = origin != subagent 的主会话（成本 C2 的分母）；182 = 同快照再排除 2 个「有 parentSession 但 origin 不是 subagent」的会话，即 §0.8 的主会话口径。',
      '182 不是「非 0 步」：它包含 47 个零 turn 会话；同快照真正有 turn 的主会话是 137（旧快照 11-12 11:07 是 135）。',
      '176 / 173 不是当前快照的数，而是更早快照的 §0.8 主会话总数（176 在 11-11 16:00–23:00，173 在 11-11 22:00 前后）；它们同样包含零 turn 会话。',
      '119 是 11-11 23:00 快照里「有已验证文件类产物」的主会话数；把它除以 11-12 11:07 的 182 得到的 65.4%，是跨两个快照的混算，不是同一快照的交付率。',
      '112 在同一族快照里只与 11-12 11:07 的「有 write/edit 产物」会话数吻合；同刻 173 的分母并不存在，112/173 也无法在同一快照复现。',
    ],
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log('=== 主快照 ' + report.meta.primaryCutoff + ' ===');
  console.log(JSON.stringify(report.primary.sample, null, 2));
  console.log('--- 分母 ---');
  for (const [k, v] of Object.entries(S.denominators)) console.log(k.padEnd(20), v);
  console.log('--- 目标数命中 ---');
  for (const n of [184, 182, 176, 173]) console.log(n, 'hits', targets[n].hits.join(',') || '(none)', 'history', JSON.stringify(targets[n].history));
  console.log('--- 交付率（两种口径）---');
  for (const x of [...S.sessionLevel, ...S.taskLevel]) console.log(x.label, x.num + '/' + x.den, (x.rate * 100).toFixed(2) + '%', x.grade);
  console.log('--- 旧快照 ---');
  for (const o of olds) {
    const d = o.denominators;
    console.log(o.local, 'main', d.main, 'active', d.mainActive, 'file', d.mainVerifiedFile, 'any', d.mainVerifiedAny, 'oldWL', d.mainOldWhitelist);
  }
  console.log('--- 父会话差（2 个）---');
  console.log(JSON.stringify(report.primary.parentOnlySessions, null, 2));
  console.log('\n wrote', OUT);
}

if (require.main === module) main();
module.exports = { snapshotAt, classify, summarize, fullAt, scan };
