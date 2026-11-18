// 安全维度扫描器 v2：标准事件 → (session, turn, call, approval, user) 结构
// 事件从 dataset 来（谁能产标准事件谁就能被扫），这里不再认识 zstd / DSH 记录类型。
const fs = require('fs');
const { loadCached } = require('../dataset.js');

const INJECTED = /^\s*(<system-reminder>|Current runtime context|<agent-inbox>|This is a reminder)/i;
const EXIT_RE = /\[exit code: (\d+)\]/;

const DS = loadCached();
const sessions = [];

for (const sess of DS.sessions) {
  if (sess.err) continue;
  const meta = sess.meta || {};
  const S = {
    id: sess.id, dir: sess.dir, origin: meta.origin || 'main', created: meta.createdAt || 0,
    cwd: meta.cwd || '', parent: meta.parentSession || null, depth: meta.delegationDepth || 0,
    turns: {}, approvals: [], policy: [], maxTurn: 0, calls: 0,
  };
  const byId = {};
  let cur = 0;

  // 事件按 seq 排：DSH 文件里偶尔有乱序插入的记录（如 session/end-seed），旧口径就是按 seq 走
  const evs = [...sess.events].sort((a, b) => (a.seq || 0) - (b.seq || 0));

  for (const e of evs) {
    if (e.type === 'turn_start' && e.turn != null) {
      cur = e.turn;
      S.maxTurn = Math.max(S.maxTurn, e.turn);
      S.turns[e.turn] = S.turns[e.turn] || { u: [], texts: [], calls: [], end: null };
    }
    // 用户消息没有 turn：按最近的 turn/start 归属；注入的提醒/上下文不算用户输入
    if (e.type === 'user_message') {
      const tt = cur || 1;
      const T0 = S.turns[tt] || (S.turns[tt] = { u: [], texts: [], calls: [], end: null });
      if (e.text && !INJECTED.test(e.text)) T0.u.push(e.text);
    }

    const t = e.turn;
    if (t == null) continue;
    const T = S.turns[t] || (S.turns[t] = { u: [], texts: [], calls: [], end: null });
    S.maxTurn = Math.max(S.maxTurn, t);

    if (e.type === 'assistant_text') {
      for (const x of e.texts) if (x) T.texts.push(x);
    } else if (e.type === 'tool_call') {
      const C = { t, step: e.step, tm: e.time, n: e.name, id: e.callId, a: e.args, arg: e.rawArgs };
      T.calls.push(C); byId[C.id] = C; S.calls++;
    } else if (e.type === 'tool_result') {
      const C = byId[e.callId]; if (!C) continue;
      const txt = e.text;
      C.tmRes = e.time; C.out = txt.slice(0, 600);
      const m = txt.match(EXIT_RE); C.exit = m ? Number(m[1]) : null;
      C.ok = !(C.exit > 0) && !/^error\b/i.test(txt.trim()) && !/command not found|No such file or directory|不是内部或外部命令/i.test(txt);
    } else if (e.type === 'turn_end') {
      T.end = e.reason;
    } else if (e.type === 'approval_asked') {
      S.approvals.push({ t, id: e.id, callId: e.callId, tool: e.tool, reason: e.reason, outcome: null, tm: e.time });
    } else if (e.type === 'approval_decided') {
      const x = S.approvals.find(a => a.id === e.id);
      if (x) x.outcome = e.outcome;
      else S.approvals.push({ t, id: e.id, callId: null, tool: null, reason: null, outcome: e.outcome, tm: e.time });
    } else if (e.type === 'policy') {
      S.policy.push({ t, type: e.name, v: JSON.stringify(e.data), tm: e.time, src: e.data.source || null });
    } else if (e.type === 'command') {
      (S.cmds = S.cmds || []).push({ t, name: e.name, args: e.args, src: e.sourceKind });
    }
  }

  for (const k of Object.keys(S.turns)) if (!S.turns[k].calls.length && !S.turns[k].u.length) delete S.turns[k];
  sessions.push(S);
}

fs.writeFileSync(__dirname + '/sessions.json', JSON.stringify(sessions));
const calls = sessions.reduce((n, s) => n + s.calls, 0);
console.log('sessions', sessions.length, 'calls', calls, 'main', sessions.filter(s => s.origin !== 'subagent').length, 'sub', sessions.filter(s => s.origin === 'subagent').length);
console.log('bytes', fs.statSync(__dirname + '/sessions.json').size);
