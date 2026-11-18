// 规则表加载器（S3 可移植改造）
// ---------------------------------------------------------------------------
// 47 条判定规则的「等级 / 授权分类 / 标题 / target」与本机目标目录、正则，
// 全部收在 rules/safety.json（可用 config.json 的 paths.rulesFile 整体换一份）。
//
// 设计取舍：
//   1. 只外置「数据」——元数据、路径标记、正则源码、阈值；判定流程仍在 matcher.js。
//      真要做成通用 DSL，等于重写匹配器，A/B 无法逐字节对账，风险大于收益。
//   2. 坏规则表直接抛错：缺字段、正则编译不过、target 不认识——不带病跑。
//   3. target=generic|dsh：dsh 类规则依赖本系统专有工具名/目录，换数据源后天然不命中，
//      这是「没覆盖」不是「没问题」（doctor 会把分布打出来）。
//   4. .test() 用不带 g 的副本，matchAll 用带 g 的副本——避免 lastIndex 状态串味。
// ---------------------------------------------------------------------------
'use strict';
const fs = require('fs');
const path = require('path');
const { ROOT, P } = require('./config.js');

const DEFAULT_FILE = 'rules/safety.json';
const LEVELS = ['红', '确认', '留痕', '绿'];
const TIERS = ['T1', 'T2', 'T3'];
const TARGETS = ['generic', 'dsh'];

function resolveFile(file) {
  return file ? path.resolve(file) : path.resolve(ROOT, P.rulesFile || DEFAULT_FILE);
}

// 本机覆盖：rules/safety.local.json（gitignored）里的 identity 深合并到基础规则表。
// 数组整体替换（例如 napcatTokenPrefixes/roots/needles），对象递归合并。
function deepMerge(base, over) {
  if (Array.isArray(over)) return over.slice();
  if (!over || typeof over !== 'object') return over;
  const out = Object.assign({}, base && typeof base === 'object' && !Array.isArray(base) ? base : {});
  for (const k of Object.keys(over)) {
    out[k] = deepMerge(out[k], over[k]);
  }
  return out;
}

function localOverrideFile(where) {
  return path.join(path.dirname(where), 'safety.local.json');
}

function applyLocalIdentity(raw, where) {
  const file = localOverrideFile(where);
  if (!fs.existsSync(file)) return raw;
  let local;
  try {
    local = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error('[rules] 本机覆盖文件不是合法 JSON：' + file + ' —— ' + e.message);
  }
  if (local && local.identity) raw.identity = deepMerge(raw.identity || {}, local.identity);
  if (local && local.targets) raw.targets = deepMerge(raw.targets || {}, local.targets);
  return raw;
}

function compileOne(name, spec, where) {
  if (!spec || typeof spec.src !== 'string') throw new Error('[rules] ' + name + ' 缺 src @ ' + where);
  const flags = String(spec.flags || '');
  const testFlags = flags.replace(/g/g, '');
  const gFlags = flags.includes('g') ? flags : flags + 'g';
  try {
    return { src: spec.src, flags, re: new RegExp(spec.src, testFlags), reG: new RegExp(spec.src, gFlags) };
  } catch (e) {
    throw new Error('[rules] 正则编译失败 ' + name + ' @ ' + where + '：' + e.message);
  }
}

function compileAll(obj, where) {
  const out = {};
  for (const k of Object.keys(obj || {})) out[k] = compileOne(k, obj[k], where);
  return out;
}

function validateRules(rules, where) {
  const ids = Object.keys(rules || {});
  if (!ids.length) throw new Error('[rules] 规则表是空的 @ ' + where);
  for (const id of ids) {
    const r = rules[id] || {};
    if (!/^[A-Z]\d$/.test(id)) throw new Error('[rules] 规则 id 不像规则（' + id + '）@ ' + where);
    if (!LEVELS.includes(r.level)) throw new Error('[rules] ' + id + ' 的 level 不认识：' + r.level);
    if (!TIERS.includes(r.tier)) throw new Error('[rules] ' + id + ' 的 tier 不认识：' + r.tier);
    if (!r.title) throw new Error('[rules] ' + id + ' 缺 title');
    if (!TARGETS.includes(r.target)) throw new Error('[rules] ' + id + ' 的 target 不认识：' + r.target + '（只认 ' + TARGETS.join('/') + '）');
  }
  return ids;
}

function build(file) {
  const where = resolveFile(file);
  if (!fs.existsSync(where)) {
    throw new Error('[rules] 规则表不存在：' + where + '（config.json 的 paths.rulesFile 可换一份）');
  }
  let raw;
  try { raw = JSON.parse(fs.readFileSync(where, 'utf8')); } catch (e) {
    throw new Error('[rules] 规则表不是合法 JSON：' + where + ' —— ' + e.message);
  }
  raw = applyLocalIdentity(raw, where);
  const ids = validateRules(raw.rules, where);
  const PAT = compileAll(raw.patterns, where);
  const targets = {
    systemDirs: (raw.targets.systemDirs || []).map((s) => new RegExp(s)),
    startupMarkers: raw.targets.startupMarkers || [],
    dshConfig: (raw.targets.dshConfig || []).map((s) => new RegExp(s)),
    dshCodeMarkers: raw.targets.dshCodeMarkers || [],
    workspaceMarkers: raw.targets.workspaceMarkers || [],
  };
  const protect = {
    files: raw.protected.files || [],
    dirs: raw.protected.dirs || [],
    legacy: (raw.protected.legacy || []).map((s) => new RegExp(s)),
  };
  const idn = Object.assign({}, raw.identity);
  idn.keyScan = Object.assign({}, raw.identity && raw.identity.keyScan);
  if (idn.keyScan.skip) idn.keyScan.skip = new RegExp(idn.keyScan.skip.src, idn.keyScan.skip.flags);
  if (idn.keyScan.ext) idn.keyScan.ext = new RegExp(idn.keyScan.ext.src, idn.keyScan.ext.flags);
  if (Array.isArray(idn.keyScan.needles)) {
    idn.keyScan.needles = idn.keyScan.needles.map((n) => ({ name: n.name, re: new RegExp(n.re.src, n.re.flags) }));
  }
  const thr = Object.assign({}, raw.thresholds);
  if (thr.turnCostFunds) thr.turnCostUsd = thr.turnCostFunds.amount / thr.turnCostFunds.rate;
  if (thr.dayCostFunds) thr.dayCostUsd = thr.dayCostFunds.amount / thr.dayCostFunds.rate;

  const LEVEL = {}, TITLE = {}, TIER = {};
  for (const id of ids) { LEVEL[id] = raw.rules[id].level; TITLE[id] = raw.rules[id].title; TIER[id] = raw.rules[id].tier; }

  function pick(k) {
    const p = PAT[k];
    if (!p) throw new Error('[rules] 代码引用了不存在的正则 "' + k + '"（检查 rules/safety.json）');
    return p;
  }

  return {
    file: where, ids, rules: raw.rules, LEVEL, TITLE, TIER, PAT,
    targets, protected: protect, tools: raw.tools || {}, thresholds: thr, identity: idn,
    test: (k, s) => pick(k).re.test(String(s == null ? '' : s)),
    all: (k, s) => String(s == null ? '' : s).matchAll(pick(k).reG),
    exec: (k, s) => String(s == null ? '' : s).match(pick(k).re),
  };
}

const cache = new Map();
function load(file) {
  const where = resolveFile(file);
  let localMtime = 0;
  try { localMtime = fs.statSync(localOverrideFile(where)).mtimeMs; } catch (e) { localMtime = 0; }
  const key = where + '|' + localMtime;
  if (!cache.has(key)) cache.set(key, build(file));
  return cache.get(key);
}

module.exports = { load, resolveFile, DEFAULT_FILE, LEVELS, TIERS, TARGETS };
