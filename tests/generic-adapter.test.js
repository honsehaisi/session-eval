// 通用 JSONL 适配器自测：合成行 → 标准事件。不依赖任何真实日志或 config.json。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const G = require('../src/adapters/generic.js');

const ROWS = [
  { t: '2026-11-14T09:00:00Z', turn: 1, role: 'user', text: '把报告生成一下' },
  { t: '2026-11-14T09:00:04Z', turn: 1, role: 'assistant', text: '好', in: 1000, out: 120 },
  { t: '2026-11-14T09:00:06Z', turn: 1, role: 'assistant', tool: 'Write', args: { path: 'a.md' }, ok: true, in: 900, out: 200, stop: 'completed' },
  { t: '2026-11-14T09:05:00Z', turn: 2, role: 'user', text: '再改一下' },
  { t: '2026-11-14T09:05:03Z', turn: 2, role: 'assistant', tool: 'Bash', args: { command: 'exit 1' }, ok: false, error: 'code 1', in: 800, out: 90, stop: 'completed' },
];

function tmpDir(files) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'syseval-generic-'));
  for (const [rel, content] of Object.entries(files)) {
    const f = path.join(base, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  }
  return base;
}
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

test('globToRegex：** 跨目录，* 只在本层', () => {
  const deep = G.globToRegex('**/*.jsonl');
  assert.ok(deep.test('a.jsonl'));
  assert.ok(deep.test('x/y/a.jsonl'));
  assert.ok(!deep.test('a.ndjson'));
  const top = G.globToRegex('*.ndjson');
  assert.ok(top.test('a.ndjson'));
  assert.ok(!top.test('x/a.ndjson'));
  const star = G.globToRegex('logs/**/*.json');
  assert.ok(star.test('logs/2026/a.json'));
  assert.ok(star.test('logs/a.json'));
});

test('toMs：ISO / 毫秒 / 秒 / 数字字符串都能归一', () => {
  assert.strictEqual(G.toMs('2026-11-14T09:00:00Z', 'auto'), Date.UTC(2026, 10, 14, 9, 0, 0));
  assert.strictEqual(G.toMs(1793859667301, 'auto'), 1793859667301);
  assert.strictEqual(G.toMs(1793859667, 'auto'), 1793859667000);
  assert.strictEqual(G.toMs('1793859667', 's'), 1793859667000);
  assert.strictEqual(G.toMs(null, 'auto'), 0);
});

test('最小格式 → 标准事件：轮边界、工具、token、结束原因', () => {
  const evs = G.toEvents(ROWS);
  const types = evs.map((e) => e.type);
  assert.deepEqual(types, [
    'turn_start', 'user_message',
    'assistant_text', 'usage',
    'tool_call', 'tool_result', 'usage',
    'turn_end',
    'turn_start', 'user_message',
    'tool_call', 'tool_result', 'usage',
    'turn_end',
  ]);
  const starts = evs.filter((e) => e.type === 'turn_start');
  assert.deepEqual(starts.map((e) => e.turn), [1, 2]);
  // turn 耗时 = 末行 − 首行
  const t1 = starts[0];
  const e1 = evs.filter((e) => e.type === 'turn_end')[0];
  assert.strictEqual(e1.time - t1.time, 6000);
  assert.strictEqual(e1.reason, 'completed');
  assert.strictEqual(e1.reasonKind, 'completed');
  const usage = evs.filter((e) => e.type === 'usage');
  assert.strictEqual(usage.length, 3, '三行带 token 的调用各一条 usage');
  assert.strictEqual(usage[0].usage.inputTokens, 1000);
  assert.strictEqual(usage[0].usage.cacheReadTokens, 0, '没配缓存字段补 0，不补 undefined');
  const calls = evs.filter((e) => e.type === 'tool_call');
  assert.deepEqual(calls.map((e) => e.name), ['Write', 'Bash']);
  assert.deepEqual(calls[0].args, { path: 'a.md' });
  const results = evs.filter((e) => e.type === 'tool_result');
  assert.strictEqual(results[0].isError, false);
  assert.strictEqual(results[1].isError, true);
  // callId 自动生成，两两配对
  assert.strictEqual(calls[0].callId, results[0].callId);
});

test('没有 ok/error 字段：isError 记 null，不装成「没报错」', () => {
  const rows = [{ t: '2026-11-14T09:00:00Z', turn: 1, tool: 'Read', args: {}, in: 10, out: 1, stop: 'completed' }];
  const c = { fields: { ok: '', error: '' } };
  const evs = G.toEvents(rows, c);
  const r = evs.find((e) => e.type === 'tool_result');
  assert.strictEqual(r.isError, null);
  assert.strictEqual(G.capabilities(c).canJudgeError, false);
  assert.strictEqual(G.capabilities({}).canJudgeError, true);
});

test('stop 为空时记 unknown，不当成异常', () => {
  const rows = [{ t: '2026-11-14T09:00:00Z', turn: 1, tool: 'Read', args: {}, ok: true, in: 5, out: 1 }];
  const evs = G.toEvents(rows);
  const end = evs.find((e) => e.type === 'turn_end');
  assert.strictEqual(end.reason, 'unknown');
  assert.strictEqual(end.reasonKind, null);
});

test('字段名映射：别人的字段名、嵌套取值、tool 是对象', () => {
  const rows = [
    { ts: '2026-11-14T09:00:00Z', conversation: { turn: 7 }, message: { role: 'assistant', content: '写好了' }, usage: { prompt_tokens: 20, completion_tokens: 3 } },
    {
      ts: '2026-11-14T09:00:01Z',
      conversation: { turn: 7 },
      message: { role: 'assistant' },
      call: { name: 'str_replace_editor', args: { path: 'b.md' }, ok: true },
      usage: { prompt_tokens: 55, completion_tokens: 9 },
      finish: 'stop',
    },
  ];
  const c = {
    fields: {
      time: 'ts', turn: 'conversation.turn', text: 'message.content', role: 'message.role',
      tool: 'call', args: 'call.args', ok: 'call.ok',
      inputTokens: 'usage.prompt_tokens', outputTokens: 'usage.completion_tokens', stop: 'finish',
    },
  };
  const evs = G.toEvents(rows, c);
  assert.strictEqual(evs.filter((e) => e.type === 'turn_start')[0].turn, 7);
  const at = evs.find((e) => e.type === 'assistant_text');
  assert.strictEqual(at.text, '写好了');
  const call = evs.find((e) => e.type === 'tool_call');
  assert.strictEqual(call.name, 'str_replace_editor');
  assert.deepEqual(call.args, { path: 'b.md' });
  const u = evs.find((e) => e.type === 'usage');
  assert.strictEqual(u.usage.inputTokens, 20);
  assert.strictEqual(evs.find((e) => e.type === 'turn_end').reason, 'stop');
});

test('turns=infer：没 turn 字段时按 user 行切轮', () => {
  const rows = [
    { t: '2026-11-14T09:00:00Z', role: 'user', text: '一' },
    { t: '2026-11-14T09:00:02Z', role: 'assistant', tool: 'Read', args: {}, ok: true, in: 1, out: 1 },
    { t: '2026-11-14T09:00:09Z', role: 'user', text: '二' },
    { t: '2026-11-14T09:00:11Z', role: 'assistant', tool: 'Write', args: {}, ok: true, in: 1, out: 1 },
  ];
  const evs = G.toEvents(rows, { turns: 'infer' });
  const starts = evs.filter((e) => e.type === 'turn_start');
  assert.deepEqual(starts.map((e) => e.turn), [1, 2]);
  assert.strictEqual(evs.filter((e) => e.type === 'turn_end').length, 2);
});

test('listSessions：一个文件一个会话，stats/meta/事件都对得上', () => {
  const base = tmpDir({ 'sessions/a.jsonl': jsonl(ROWS), 'sessions/nested/b.jsonl': jsonl([ROWS[0]]) });
  const list = G.listSessions(base);
  assert.strictEqual(list.length, 2);
  const a = list.find((s) => s.id === 'sessions-a');
  assert.ok(a, 'id 用相对路径，防止同名文件互撞：' + JSON.stringify(list.map((s) => s.id)));
  assert.strictEqual(a.stats.records, ROWS.length);
  assert.strictEqual(a.meta.origin, 'main');
  assert.ok(a.stats.latestTime > 0);
  assert.ok(a.events.length > 0);
  assert.strictEqual(a.records, undefined, '默认不留原始记录');
  const withRecs = G.listSessions(base, { withRecords: true });
  assert.strictEqual(withRecs[0].records.length > 0, true);
});

test('listSessions：坏行只计数，不拖垮整个文件；整份非 JSON 也能读', () => {
  const base = tmpDir({ 'a.jsonl': '{"t":"2026-11-14T09:00:00Z","turn":1,"tool":"Read","ok":true,"in":1,"out":1,"stop":"completed"}\n坏行\n' });
  const list = G.listSessions(base);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].stats.parseErr, 1);
  assert.strictEqual(list[0].stats.records, 1);
  assert.ok(list[0].events.some((e) => e.type === 'tool_call'));
});

test('sessionMode=field：一个文件里多个会话按 session 字段拆开', () => {
  const rows = [
    ROWS[0], ROWS[2],
    { t: '2026-11-14T10:00:00Z', turn: 1, session: 's-2', role: 'user', text: '另一个会话' },
    { t: '2026-11-14T10:00:02Z', turn: 1, session: 's-2', tool: 'Write', ok: true, in: 10, out: 2, stop: 'completed' },
  ];
  const base = tmpDir({ 'all.jsonl': jsonl(rows) });
  const list = G.listSessions(base, {}, { sessionMode: 'field', fields: { session: 'session' } });
  assert.strictEqual(list.length, 2, '按 session 字段拆成 2 个会话');
  assert.ok(list.some((s) => s.id.endsWith('s-2')));
  for (const s of list) assert.ok(s.events.some((e) => e.type === 'tool_call'));
  // 默认 file 模式：还是一个文件一个会话
  const one = G.listSessions(base, {}, { sessionMode: 'file' });
  assert.strictEqual(one.length, 1);
});

test('sourceGlob / capabilities 如实报告能算哪些纬度', () => {
  assert.strictEqual(G.sourceGlob(), '**/*.jsonl');
  const cap = G.capabilities({ productTools: ['Write'] });
  assert.strictEqual(cap.canJudgeError, true);
  assert.strictEqual(cap.canCostTokens, true);
  assert.deepStrictEqual(cap.productTools, ['Write']);
  assert.strictEqual(G.capabilities({ fields: { inputTokens: '', outputTokens: '' } }).canCostTokens, false);
});
