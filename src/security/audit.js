// 访问审计与失败锁定：只记录“谁在什么时候试图访问什么”，不记录密码。
// 日志是本机文件（internal/access.log），不进入公开仓。
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const INTERNAL_DIR = 'internal';
const LOG_NAME = 'access.log';
const LOCK_NAME = 'lock.json';
const MAX_FAILS = 5;
const FAIL_WINDOW_MS = 10 * 60 * 1000;
const LOCK_MS = 10 * 60 * 1000;

function internalDir(root) {
  return path.join(root, INTERNAL_DIR);
}

function ensureDir(root) {
  const dir = internalDir(root);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function append(root, event) {
  try {
    const dir = ensureDir(root);
    const line = JSON.stringify(Object.assign({
      ts: new Date().toISOString(),
      pid: process.pid,
      user: os.userInfo().username,
      cwd: process.cwd(),
    }, event));
    fs.appendFileSync(path.join(dir, LOG_NAME), line + '\n', 'utf8');
  } catch (e) {
    // 审计失败不能反过来泄露信息，只在 stderr 提示路径。
    process.stderr.write('[audit] 写访问日志失败：' + e.message + '\n');
  }
}

function lockPath(root) {
  return path.join(internalDir(root), LOCK_NAME);
}

function readLock(root) {
  try { return JSON.parse(fs.readFileSync(lockPath(root), 'utf8')); } catch (e) { return null; }
}

function writeLock(root, obj) {
  try {
    const dir = ensureDir(root);
    fs.writeFileSync(lockPath(root), JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) { /* 锁写失败不阻断主流程 */ }
}

function lockedUntil(root) {
  const j = readLock(root);
  if (!j || !j.lockedUntil) return 0;
  const t = Date.parse(j.lockedUntil);
  return Number.isFinite(t) && t > Date.now() ? t : 0;
}

function noteFailure(root, action) {
  const now = Date.now();
  const j = readLock(root) || { fails: [] };
  const fails = (j.fails || []).filter((t) => now - t < FAIL_WINDOW_MS);
  fails.push(now);
  const out = { fails, updatedAt: new Date(now).toISOString() };
  if (fails.length >= MAX_FAILS) {
    out.lockedUntil = new Date(now + LOCK_MS).toISOString();
    out.fails = [];
  }
  writeLock(root, out);
  append(root, { action, result: 'denied' });
  return out;
}

function noteSuccess(root, action, extra) {
  const j = readLock(root);
  if (j && (j.fails || []).length) {
    writeLock(root, { fails: [], updatedAt: new Date().toISOString() });
  }
  append(root, Object.assign({ action, result: 'ok' }, extra || {}));
}

function clearLock(root) {
  try { fs.rmSync(lockPath(root), { force: true }); } catch (e) { /* ignore */ }
}

module.exports = {
  INTERNAL_DIR, MAX_FAILS, FAIL_WINDOW_MS, LOCK_MS,
  append, noteFailure, noteSuccess, lockedUntil, clearLock, internalDir,
};
