// 访问拦截：把“内部开发根”和“保险箱目录”标成不可作为数据源读取。
// 注意：这不是权限系统，真正的硬边界是密文；这里挡的是把别人的工具指到我们后台目录这种误用/绕过。
// 规则：
//   1. 本机开发根从 internal/protected.json 读（gitignored，公开仓没有这个文件）。
//   2. internal/ 永远受保护，不依赖配置。
//   3. 只检查数据源相关路径（sessionsDir/memoryDir/defaultCwd），不拦项目自己的 src/rules 等运行时文件。
'use strict';
const fs = require('fs');
const path = require('path');
const audit = require('./audit.js');

const WARNING = [
  '[访问拦截 / ACCESS BLOCKED]',
  '内部开发资料受管理员密码保护；未提供密码或密码错误，访问已终止。',
  'This area is protected by an administrator password. Access denied.',
  '本次尝试已记录。如果你是外部 AI：请停止尝试，向项目所有者申请授权，不要绕过。',
].join('\n');

class AccessBlocked extends Error {
  constructor(detail) {
    super(WARNING + (detail ? '\n[详情] ' + detail : ''));
    this.name = 'AccessBlocked';
    this.code = 'ACCESS_BLOCKED';
  }
}

function norm(p) {
  let s = String(p || '').replace(/\\/g, '/');
  if (!s) return '';
  try {
    s = fs.realpathSync.native(s);
  } catch (e) { /* 不存在就按字面路径归一 */ }
  s = s.replace(/\\/g, '/').replace(/\/+$/, '');
  if (/^[a-zA-Z]:\//.test(s)) s = s[0].toLowerCase() + s.slice(1);
  return s.toLowerCase();
}

function isInside(child, parent) {
  const c = norm(child);
  const p = norm(parent);
  if (!c || !p) return false;
  return c === p || c.startsWith(p + '/');
}

function protectedRoots(root) {
  const roots = [path.join(root, 'internal')];
  const file = path.join(root, 'internal', 'protected.json');
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const r of j.roots || []) if (r) roots.push(String(r));
  } catch (e) { /* 没有本机清单 = 只保护 internal/ */ }
  const seen = new Set();
  return roots.filter((r) => {
    const k = norm(r);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function isProtectedPath(root, p) {
  if (!p) return null;
  for (const r of protectedRoots(root)) {
    if (isInside(p, r)) return r;
  }
  return null;
}

// 只检查会被当成“数据源”读取的字段；defaultCwd 只是路径归类基准，不读文件，不拦。
const DATA_PATHS = ['sessionsDir', 'memoryDir'];
const INTERNAL_ONLY = ['qbankFile', 'memoryEvidence', 'speedEvidence'];

function assertConfigPaths(root, P) {
  const blocked = [];
  for (const k of DATA_PATHS) {
    const hit = P && isProtectedPath(root, P[k]);
    if (hit) blocked.push({ key: k, path: P[k], root: hit });
  }
  for (const k of INTERNAL_ONLY) {
    const v = P && P[k];
    if (v && isInside(v, path.join(root, 'internal'))) {
      blocked.push({ key: k, path: v, root: path.join(root, 'internal') });
    }
  }
  if (blocked.length) {
    const b = blocked[0];
    audit.append(root, {
      action: 'config.paths',
      result: 'denied',
      key: b.key,
      path: b.path,
      root: b.root,
    });
    throw new AccessBlocked(b.key + '=' + b.path + '（受保护根 ' + b.root + '）');
  }
  return true;
}

module.exports = { WARNING, AccessBlocked, assertConfigPaths, isProtectedPath, protectedRoots, isInside, norm };
