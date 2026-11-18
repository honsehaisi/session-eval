// 唯一配置入口（S1 可移植改造）
// ---------------------------------------------------------------------------
// 读顺序：SYSEVAL_CONFIG 指定的文件 > <项目根>/config.json > 内置默认值
// 规则：
//   1. 路径里的 ~ 展开成当前用户主目录；相对路径按**项目根**解析（不是 cwd，脚本都在子目录里跑）。
//   2. 统一成正斜杠、去掉结尾斜杠——下游 matcher/seq 是按 '/' 做字符串比较的。
//   3. 缺配置不是错误：没有 config.json 就按 ~ 推导，换台机器也能跑。
//   4. 会话目录不存在时大声警告，别静默读到 0 条。
// ---------------------------------------------------------------------------
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const ENV_KEY = 'SYSEVAL_CONFIG';

// 内置默认：只依赖当前用户，不写死任何用户名/盘符
const DEFAULTS = {
  paths: {
    sessionsDir: '~/.dsh/sessions',   // 会话日志根目录（DSH 默认布局）
    memoryDir: '~/.memory',           // 记忆库根目录
    homeDir: '~',                     // 用户目录（路径归类、~ 展开用）
    dshDir: '~/.dsh',                 // DSH 配置目录
    qbankFile: '',                    // 记忆题库快照（judge 用）
    defaultCwd: '',                   // 会话记录里没写 cwd 时的兜底
    dataSource: 'dsh',                // 数据源适配器（adapters/ 下的名字）
    rulesFile: 'rules/safety.json',   // 安全规则表（换一份规则不动代码）
    // S6 证据开关：这两维要靠「本机题库/实测产物」才成立，换机器就是别人的旧数据。
    // 不填 = 未覆盖（不按 0 分罚）。本机用 config.json 指向自己的产物；外发包不带 config.json。
    memoryEvidence: '',               // 记忆维度证据文件（report-offline.json 或 report.json 结构）
    speedEvidence: '',                // 速度维度证据文件（src/tasks/report.json 结构）
  },
  roots: {
    extraWriteRoots: [],              // 额外允许写的根（私有工作区/项目目录）
  },
  // 通用 JSONL 适配器（dataSource=generic）的字段映射。
  // 默认值是「最小格式」（README §5.1）；别人的日志字段不一样时改这里，不用动代码。
  generic: {
    fileGlob: '**/*.jsonl',           // 日志文件匹配（支持 * ? **）
    timeUnit: 'auto',                 // auto | ms | s | iso
    turns: 'field',                   // field（用 turn 字段）| infer（无 turn：按 user 行切）
    sessionMode: 'file',              // file（一个文件一个会话）| field（按 session 字段分组）
    productTools: [],                 // 额外算作「产物动作」的工具名（交付维度用）
    fields: {
      time: 't', turn: 'turn', type: '', role: 'role', text: 'text',
      tool: 'tool', args: 'args', ok: 'ok', error: '',
      callId: 'id', inputTokens: 'in', outputTokens: 'out',
      cacheReadTokens: '', cacheWriteTokens: '',
      stop: 'stop', session: '',
    },
  },
};

const slash = (s) => String(s).replace(/\\/g, '/');

function expand(p) {
  if (p == null) return '';
  let s = slash(String(p).trim());
  if (!s) return '';
  if (s === '~') s = slash(os.homedir());
  else if (s.startsWith('~/')) s = slash(os.homedir()) + s.slice(1);
  if (!/^[a-zA-Z]:\//.test(s) && !s.startsWith('/')) s = slash(path.resolve(ROOT, s));
  return s.replace(/\/+$/, '');
}

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

function pickConfigPath() {
  const env = process.env[ENV_KEY];
  if (env) return path.resolve(env);
  const local = path.join(ROOT, 'config.json');
  return fs.existsSync(local) ? local : null;
}

const CONFIG_PATH = pickConfigPath();
const file = CONFIG_PATH ? readJSON(CONFIG_PATH) : null;
if (CONFIG_PATH && !file) {
  // 明确指定了却读不出来 = 配置坏了，别带着默认值继续
  if (process.env[ENV_KEY]) throw new Error('[config] 读不了配置文件: ' + CONFIG_PATH);
  console.error('[config] 配置文件解析失败，改用默认值: ' + CONFIG_PATH);
}

const merged = {
  paths: Object.assign({}, DEFAULTS.paths, (file && file.paths) || {}),
  roots: Object.assign({}, DEFAULTS.roots, (file && file.roots) || {}),
  generic: Object.assign({}, DEFAULTS.generic, (file && file.generic) || {}, {
    fields: Object.assign({}, DEFAULTS.generic.fields, ((file && file.generic) || {}).fields || {}),
  }),
};

// 展开 + 规整
const PATHLESS = new Set(['dataSource']); // 不是路径，别展开
const P = {};
for (const k of Object.keys(merged.paths)) P[k] = PATHLESS.has(k) ? String(merged.paths[k] || '') : expand(merged.paths[k]);
const R = { extraWriteRoots: (merged.roots.extraWriteRoots || []).map(expand).filter(Boolean) };

// 访问拦截：数据源路径如果指到内部开发根/保险箱，拒绝继续。
// 不在这里 process.exit——库也可能被测试/界面引用；由 CLI 入口检查 BLOCKED。
let BLOCKED = null;
try {
  require('./security/guard.js').assertConfigPaths(ROOT, P);
} catch (e) {
  if (e && e.code === 'ACCESS_BLOCKED') {
    BLOCKED = e;
    console.error(e.message);
  } else {
    throw e;
  }
}

// 会话目录缺失要看得见
const missing = [];
if (!P.sessionsDir || !fs.existsSync(P.sessionsDir)) missing.push('sessionsDir=' + (P.sessionsDir || '(空)'));
if (P.memoryDir && !fs.existsSync(P.memoryDir)) missing.push('memoryDir=' + P.memoryDir);
if (missing.length) {
  console.error('[config] 目录不存在：' + missing.join(' · ') + '（来源 ' + (CONFIG_PATH || '内置默认') + '）');
}

function banner() {
  const src = CONFIG_PATH ? CONFIG_PATH : '内置默认（无 config.json）';
  return '配置: ' + src + '\n会话: ' + P.sessionsDir + '\n记忆: ' + (P.memoryDir || '(未设)');
}

module.exports = { ROOT, CONFIG_PATH, DEFAULTS, P, R, cfg: merged, expand, slash, banner, BLOCKED };
