// DSH 适配器自测（S2 留下的尾巴，S5 补上）：合成记录 → 标准事件。
// 不读真实日志：在临时目录里拼一个「两帧 zstd」的会话文件，走完整读取链路。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const z = require('node:zlib');

const A = require('../src/adapters/dsh.js');
const { decompressAll, frameOffsets } = require('../src/zframes.js');

const RECS = [
  // 真日志里 session 这条是扁平的（没有 data 包裹），其余记录在 data 里
  { type: 'session', version: 4, id: 's1', time: 1000, seq: 1, cwd: 'C:/work/proj', createdAt: 900, origin: 'main' },
  { type: 'turn/start', time: 1001, seq: 2, data: { turn: 1 } },
  { type: 'user/message', time: 1002, seq: 3, data: { content: '帮我改一下 a.js' } },
  {
    type: 'assistant/message', time: 1003, seq: 4,
    data: {
      turn: 1, step: 1,
      message: { content: [{ type: 'text', text: '好' }, { type: 'text', text: '我看看' }] },
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
    },
  },
  { type: 'tool/call', time: 1004, seq: 5, data: { turn: 1, step: 1, callId: 'c1', name: 'ops_read_files', arguments: '{"files":[{"path":"a.js"}]}' } },
  { type: 'tool/call', time: 1005, seq: 6, data: { turn: 1, step: 1, callId: 'c2', name: 'ops_bash', arguments: '{坏 json' } },
  { type: 'tool/result', time: 1006, seq: 7, data: { turn: 1, step: 1, toolCallId: 'c1', message: { content: [{ type: 'text', text: 'x' }], isError: false } } },
  { type: 'approval/asked', time: 1007, seq: 8, data: { turn: 1, id: 'a1', callId: 'c2', toolName: 'ops_bash', reason: '写文件' } },
  { type: 'approval/decided', time: 1008, seq: 9, data: { turn: 1, id: 'a1', outcome: 'allowed' } },
  { type: 'sandbox/mode', time: 1009, seq: 10, data: { turn: 1, mode: 'danger-full-access' } },
  { type: 'command/run', time: 1010, seq: 11, data: { turn: 1, name: 'permission', args: 'danger-full-access', source: { kind: 'user' } } },
  { type: 'compaction/summary', time: 1011, seq: 12, data: { turn: 1, usage: { inputTokens: 8, outputTokens: 2 } } },
  { type: 'turn/end', time: 1012, seq: 13, data: { turn: 1, reason: { kind: 'completed' } } },
  { type: 'unknown/record', time: 1013, seq: 14, data: { anything: true } },
];

function tmpSession() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'syseval-dsh-'));
  const dir = path.join(base, '20261114', 'sess-1');
  fs.mkdirSync(dir, { recursive: true });
  // 两帧：前半 / 后半各写一次，模拟 DSH 的续写行为
  const half = Math.ceil(RECS.length / 2);
  const frame = (list) => z.zstdCompressSync(Buffer.from(list.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8'));
  const buf = Buffer.concat([frame(RECS.slice(0, half)), frame(RECS.slice(half))]);
  const file = path.join(dir, A.SESSION_FILE);
  fs.writeFileSync(file, buf);
  return { base, dir, file, buf };
}

test('多帧文件：两帧都解出来，顺序不乱', () => {
  const { buf } = tmpSession();
  assert.strictEqual(frameOffsets(buf).length, 2, '应识别出 2 帧');
  const txt = decompressAll(buf).toString('utf8');
  assert.ok(txt.includes('"type":"session"'));
  assert.ok(txt.includes('"type":"turn/end"'));
  assert.strictEqual(txt.trim().split('\n').length, RECS.length);
});

test('parseSession：读完两帧，记录数与解析失败数对得上', () => {
  const { file } = tmpSession();
  const p = A.parseSession(file);
  assert.ok(!p.err, p.err);
  assert.strictEqual(p.recs.length, RECS.length);
  assert.strictEqual(p.parseErr, 0);
});

test('toEvents：记录类型 → 标准事件（含 usage / 审批 / 策略 / 命令）', () => {
  const evs = A.toEvents(RECS);
  const types = evs.map((e) => e.type);
  assert.deepEqual(types, [
    'turn_start', 'user_message', 'assistant_text', 'usage', 'tool_call', 'tool_call',
    'tool_result', 'approval_asked', 'approval_decided', 'policy', 'command', 'usage', 'turn_end',
  ]);
  const at = evs.find((e) => e.type === 'assistant_text');
  assert.deepEqual(at.texts, ['好', '我看看']);
  assert.strictEqual(at.text, '好\n我看看');
  const usage = evs.filter((e) => e.type === 'usage');
  assert.strictEqual(usage.length, 2, 'assistant/message 与 compaction/summary 都带 usage');
  assert.strictEqual(usage[1].source, 'compaction');
  const call = evs.find((e) => e.type === 'tool_call');
  assert.deepEqual(call.args, { files: [{ path: 'a.js' }] });
  const bad = evs.filter((e) => e.type === 'tool_call')[1];
  assert.ok(bad.args.__raw, '坏 JSON 不丢参数原文');
  assert.strictEqual(evs.find((e) => e.type === 'tool_result').callId, 'c1');
});

test('toEvents：seq 原样保留（下游要自己按 seq 排）', () => {
  const evs = A.toEvents(RECS);
  assert.deepEqual(evs.map((e) => e.seq), [2, 3, 4, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
});

test('listSessions：目录布局 + meta + stats 都能给出来', () => {
  const { base } = tmpSession();
  const list = A.listSessions(base);
  assert.strictEqual(list.length, 1);
  const s = list[0];
  assert.strictEqual(s.id, 'sess-1');
  assert.strictEqual(s.meta.cwd, 'C:/work/proj');
  assert.strictEqual(s.meta.origin, 'main');
  assert.strictEqual(s.stats.records, RECS.length);
  assert.ok(s.stats.bytes > 0);
  assert.strictEqual(s.records, undefined, '默认不保留原始记录');
});

test('listSessions：坏文件单独标 err，不拖垮其它会话', () => {
  const { base } = tmpSession();
  const bad = path.join(base, '20261114', 'sess-broken');
  fs.mkdirSync(bad, { recursive: true });
  fs.writeFileSync(path.join(bad, A.SESSION_FILE), Buffer.from('not zstd'));
  const list = A.listSessions(base);
  assert.strictEqual(list.length, 2);
  assert.ok(list.find((s) => s.id === 'sess-broken').err);
});

test('sourceGlob 报给 core 的匹配模式', () => {
  assert.strictEqual(A.sourceGlob(), '**/' + A.SESSION_FILE);
});
