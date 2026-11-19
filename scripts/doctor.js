#!/usr/bin/env node
// 自检（S5 打包）：换一台机器 / 换一份日志目录，**先跑这个**，别一上来就 run-all。
// 只读：不写报告、不改配置、不碰日志。退出码 1 = 有致命项（现在跑不了）。
//
//   node scripts/doctor.js           人看的清单
//   node scripts/doctor.js --json    给脚本/CI 吃的结构化结果
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIN_NODE = [22, 15, 0];   // zlib.zstdDecompressSync 的最低版本
const OUT_DIRS = ['', 'src/cost', 'src/honesty', 'src/safety', 'src/stability', 'src/delivery', 'src/tasks', 'src/score'];

/* ---------- 纯函数（有单测） ---------- */
function parseVersion(v) {
  const m = String(v || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function versionAtLeast(cur, min) {
  const c = parseVersion(cur), m = parseVersion(min.join('.'));
  if (!c || !m) return false;
  for (let i = 0; i < 3; i++) {
    if (c[i] > m[i]) return true;
    if (c[i] < m[i]) return false;
  }
  return true;
}

/* ---------- 检查项 ---------- */
function checkNode(ver) {
  const v = ver || process.versions.node;
  const ok = versionAtLeast(v, MIN_NODE);
  return {
    level: ok ? 'ok' : 'fail',
    name: 'Node 版本',
    detail: 'v' + v + (ok ? '' : '（需要 ≥ v' + MIN_NODE.join('.') + '，多帧 zstd 解压要用）'),
    fix: ok ? '' : '装 Node ≥ ' + MIN_NODE.join('.') + ' 再跑',
  };
}

function checkConfig(cfg, configPath) {
  const src = configPath ? path.relative(ROOT, configPath).replace(/\\/g, '/') : '内置默认（没有 config.json）';
  return { level: 'ok', name: '配置来源', detail: src, fix: '' };
}

function checkDataSource(name, adapters) {
  const ok = !!(adapters && adapters[name]);
  return {
    level: ok ? 'ok' : 'fail',
    name: '数据源',
    detail: name + (ok ? '' : '（未注册；可用：' + Object.keys(adapters || {}).join(' / ') + '）'),
    fix: ok ? '' : '改 config.json 的 paths.dataSource，或在 src/adapters/ 里加一个',
  };
}

function checkDir(label, p, optional) {
  if (!p) return { level: optional ? 'warn' : 'fail', name: label, detail: '(未配置)', fix: '在 config.json 里填上路径' };
  let st;
  try { st = fs.statSync(p); } catch (e) { st = null; }
  if (!st) {
    return { level: optional ? 'warn' : 'fail', name: label, detail: p + '（不存在）', fix: optional ? '不影响跑分，但依赖它的维度会报「未覆盖」' : '先确认路径；换机器时改 config.json 的 paths' };
  }
  if (!st.isDirectory()) return { level: 'fail', name: label, detail: p + '（不是目录）', fix: 'paths 里填目录，不是文件' };
  return { level: 'ok', name: label, detail: p, fix: '' };
}

function countSessions(adapter, dir) {
  if (!adapter || !dir) return { n: 0, files: [] };
  if (typeof adapter.listSessionFiles === 'function') {
    const files = adapter.listSessionFiles(dir);
    return { n: files.length, files };
  }
  // 没有 listSessionFiles 的适配器：按目录数一层（够 doctor 用）
  let n = 0;
  try {
    for (const d of fs.readdirSync(dir)) {
      const sd = path.join(dir, d);
      try { if (fs.statSync(sd).isDirectory()) n += fs.readdirSync(sd).length; } catch (e) { /* skip */ }
    }
  } catch (e) { /* skip */ }
  return { n, files: [] };
}

function checkSample(adapter, files) {
  if (!adapter || !files || !files.length) {
    return { level: 'fail', name: '样本解码', detail: '没有可解码的会话文件', fix: '先看「会话目录」这一项；新机器上还没跑过 DSH 就是空的' };
  }
  const picks = files.slice(0, 3);
  let recs = 0, evs = 0, bad = 0, errs = 0;
  for (const f of picks) {
    let p;
    try { p = adapter.parseSession(f.f); } catch (e) { p = { err: e.message }; }
    if (p.err) { errs++; continue; }
    recs += p.recs.length;
    bad += p.parseErr || 0;
    evs += adapter.toEvents(p.recs).length;
  }
  if (errs === picks.length) {
    return { level: 'fail', name: '样本解码', detail: '前 ' + picks.length + ' 份全解不开（多帧 zstd？）', fix: '确认日志没加密、没被别的工具改写过；DSH 日志要走 src/zframes.js' };
  }
  const ok = evs > 0;
  return {
    level: ok ? 'ok' : 'warn',
    name: '样本解码',
    detail: '抽查 ' + picks.length + ' 份：' + recs + ' 条记录 → ' + evs + ' 条标准事件' + (bad ? '，' + bad + ' 行解析失败' : '') + (errs ? '，' + errs + ' 份解不开' : ''),
    fix: ok ? '' : '日志类型适配器不认识（event 为 0），检查 dataSource 是否选对',
  };
}

// 非 DSH 数据源：如实说清「哪些维度能算、哪些只会假装 0 分」
function checkGenericCoverage(name, adapter) {
  if (!name || name === 'dsh') return null;
  const mark = { level: 'warn', name: '数据源覆盖', detail: '', fix: '' };
  if (!adapter || typeof adapter.capabilities !== 'function') {
    mark.detail = name + '（适配器没导出 capabilities()，覆盖率不明）';
    mark.fix = '在适配器里加 capabilities()：至少报出工具名/token/ok 字段配没配';
    return mark;
  }
  let cap;
  try { cap = adapter.capabilities(); } catch (e) { cap = null; }
  if (!cap) {
    mark.detail = name + '（capabilities() 抛错）';
    mark.fix = '先修适配器；doctor 拿不到覆盖率就没法判断哪些分是真的';
    return mark;
  }
  const gaps = [];
  if (!cap.canJudgeError) gaps.push('没配 ok/error → 稳定 T1 判不了（会是 0%，别当没报错）');
  if (!cap.canCostTokens) gaps.push('没配 token 字段 → 成本维度出不了数');
  if (!cap.productTools || !cap.productTools.length) gaps.push('generic.productTools 为空 → 交付维度只认内置工具名');
  mark.detail = '工具=' + (cap.toolField || '(未配)') +
    '｜错误=' + (cap.errorField || cap.okField || '(未配)') +
    '｜token=' + (cap.tokenField || '(未配)') +
    '｜turn=' + cap.turnMode +
    '｜产物工具=' + ((cap.productTools || []).join(',') || '(未配)') +
    '｜安全维度只覆盖 generic 类规则：dsh 类规则依赖 DSH 工具名/目录，天然 0 命中，不是「没问题」';
  mark.fix = gaps.length
    ? '缺：' + gaps.join(' / ') + '（按 README §5.2 补字段映射；缺的维度会显示未覆盖或 0，不是真水平）'
    : '解读安全分时记住上面那条：换数据源后它只证明「没碰 generic 类红线」';
  return mark;
}

function checkMemory(cfg) {
  const dir = cfg.P.memoryDir;
  const qbank = cfg.P.qbankFile;
  if (!dir) return { level: 'warn', name: '记忆维度', detail: '没配 memoryDir', fix: '不配也能跑，记忆维度会报「未覆盖」' };
  let has = false;
  try { has = fs.statSync(dir).isDirectory(); } catch (e) { has = false; }
  const qb = qbank ? fs.existsSync(qbank) : false;
  const detail = (has ? dir : dir + '（不存在）') + '｜题库 ' + (qbank ? (qb ? qbank : qbank + '（不存在）') : '未配置');
  return {
    level: has ? 'ok' : 'warn',
    name: '记忆维度',
    detail,
    fix: has ? '' : '别人的机器上没有你的记忆库是正常的：该维度会报「未覆盖」，不按 0 分罚',
  };
}

function checkConsistency(cfg) {
  // S4：一致性靠「题库 + 题面模板」跑 T1/T2，两样缺一样就只能报未覆盖
  const qbank = cfg.P.qbankFile || path.join(ROOT, 'src/memory/questions.json');
  const tpl = cfg.P.consistencyTemplate || path.join(ROOT, 'src/consistency/prompt-template.md');
  const okQ = fs.existsSync(qbank);
  const okT = fs.existsSync(tpl);
  const ev = cfg.P.consistencyEvidence;
  const okE = ev ? fs.existsSync(ev) : false;
  const bit = (ok, p) => (ok ? path.relative(ROOT, p).replace(/\\/g, '/') : path.relative(ROOT, p).replace(/\\/g, '/') + '（缺失）');
  return {
    level: okQ && okT ? 'ok' : 'warn',
    name: '一致性',
    detail: '题库 ' + bit(okQ, qbank) + '｜模板 ' + bit(okT, tpl) + '｜证据 ' + (ev ? bit(okE, ev) : '未配置'),
    fix: okQ && okT
      ? (okE ? '' : '没证据 = 该维度报「未覆盖」；跑完 T1/T2 后用 paths.consistencyEvidence 指过去，不按 0 分罚')
      : '题库或模板缺失：一致性维度会报「未覆盖」；在 config.json 的 paths 里补 qbankFile / consistencyTemplate',
  };
}

function checkRules() {
  let R;
  try { R = require('../src/rules.js'); } catch (e) { R = null; }
  if (!R) {
    return { level: 'warn', name: '规则表', detail: '未外置（S3 未做，规则仍写死在 src/safety/matcher.js）', fix: 'S3 会把 46 条挪到 rules/safety.json' };
  }
  let table;
  try { table = R.load(); } catch (e) {
    return { level: 'fail', name: '规则表', detail: '读不了：' + e.message, fix: '检查 rules/safety.json 是不是合法 JSON' };
  }
  const ids = Object.keys(table.rules || {});
  const byTarget = {};
  for (const id of ids) { const t = table.rules[id].target || '?'; byTarget[t] = (byTarget[t] || 0) + 1; }
  const dist = Object.keys(byTarget).sort().map((t) => t + ' ' + byTarget[t]).join(' / ');
  return {
    level: ids.length ? 'ok' : 'fail',
    name: '规则表',
    detail: (table.file ? path.relative(ROOT, table.file).replace(/\\/g, '/') : 'rules/safety.json') + '：' + ids.length + ' 条（' + dist + '）',
    fix: ids.length ? '' : '规则表是空的，安全维度会全绿——这是假绿，别信',
  };
}

function checkOutputs() {
  const bad = [];
  for (const d of OUT_DIRS) {
    const p = d ? path.join(ROOT, d) : ROOT;
    try { fs.accessSync(p, fs.constants.W_OK); } catch (e) { bad.push(d || '.'); }
  }
  return {
    level: bad.length ? 'fail' : 'ok',
    name: '产物可写',
    detail: bad.length ? '不能写：' + bad.join(', ') : 'report.json / 各维度产物目录都可写',
    fix: bad.length ? '把项目拷到有写权限的目录（只读盘跑不了）' : '',
  };
}

function checkPlatform(platform) {
  const p = platform || process.platform;
  if (p === 'win32') return { level: 'ok', name: '平台', detail: 'win32（系统目录判据 C:\\Windows / Program Files 生效）', fix: '' };
  return {
    level: 'warn',
    name: '平台',
    detail: p + '（Windows 系统目录判据不生效，其余规则照跑）',
    fix: '非 Windows 上 A2/B3 类命中会天然为 0；要适配就在 rules/safety.json 里改 targets',
  };
}

/* ---------- 主流程 ---------- */
function run(opts) {
  const o = opts || {};
  const CFG = require('../src/config.js');
  if (CFG.BLOCKED) process.exit(3);
  let DS = null;
  try { DS = require('../src/dataset.js'); } catch (e) { DS = null; }
  const adapters = DS ? DS.ADAPTERS : {};
  const name = o.dataSource || (DS ? DS.sourceName() : '');
  const adapter = adapters[name] || null;
  const count = countSessions(adapter, CFG.P.sessionsDir);

  const items = [
    checkNode(o.nodeVersion),
    checkPlatform(o.platform),
    checkConfig(CFG, CFG.CONFIG_PATH),
    checkDataSource(name, adapters),
    checkDir('会话目录', CFG.P.sessionsDir, false),
    { level: count.n ? 'ok' : 'fail', name: '会话数量', detail: count.n + ' 份' + (count.n ? '' : '（读到 0 条，先别跑报告）'), fix: count.n ? '' : 'paths.sessionsDir 指错，或这台机器还没产生日志' },
    checkSample(adapter, count.files),
    checkRules(),
    checkMemory(CFG),
    checkConsistency(CFG),
    checkOutputs(),
  ].filter(Boolean);
  const cov = checkGenericCoverage(name, adapter);
  if (cov) items.splice(7, 0, cov);   // 紧跟在「样本解码」后：先看能不能读，再说能算什么
  return { items, sessions: count.n, config: CFG.CONFIG_PATH || '(内置默认)', dataSource: name };
}

const MARK = { ok: '✓', warn: '!', fail: '✗' };
function print(res) {
  console.log('系统测评 · 自检');
  console.log('项目根: ' + ROOT);
  console.log('');
  for (const it of res.items) {
    console.log('  ' + MARK[it.level] + ' ' + it.name.padEnd(6, '　') + ' ' + it.detail);
    if (it.fix) console.log('      → ' + it.fix);
  }
  const bad = res.items.filter((x) => x.level === 'fail');
  const warn = res.items.filter((x) => x.level === 'warn');
  console.log('');
  if (bad.length) {
    console.log('结论：现在跑不了（' + bad.length + ' 项致命）。按上面 → 的建议改完再跑 doctor。');
  } else {
    console.log('结论：可以跑。下一步：node scripts/run-all.js（约 1–3 分钟）' + (warn.length ? '；' + warn.length + ' 项提醒不影响出分。' : '。'));
  }
}

function main() {
  const json = process.argv.includes('--json');
  const res = run({});
  if (json) console.log(JSON.stringify(res, null, 2));
  else print(res);
  process.exit(res.items.some((x) => x.level === 'fail') ? 1 : 0);
}

if (require.main === module) main();
module.exports = { run, parseVersion, versionAtLeast, checkNode, checkDir, countSessions, checkRules, MIN_NODE };
