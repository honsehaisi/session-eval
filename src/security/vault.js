// 密文保险箱：整包（清单 + 文件内容）一起加密，文件名也不泄露。
// 文件格式见 crypto.encrypt 的返回值：kdf.salt/iv/tag/data。
// 约定：任何异常都抛错，由 CLI 统一转成“拒绝访问”，绝不回退读明文目录。
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./crypto.js');

const VAULT_REL = 'internal/vault.json';
const LOCK_REL = 'internal/vault.lock';
const STALE_LOCK_MS = 5 * 60 * 1000;

function vaultFile(root) {
  return path.join(root, VAULT_REL);
}

function exists(root) {
  return fs.existsSync(vaultFile(root));
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function safeName(name) {
  const raw = String(name == null ? '' : name).replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(raw) || raw.startsWith('/')) {
    throw new Error('[vault] 非法的条目名（不允许绝对路径）：' + JSON.stringify(name));
  }
  const n = raw;
  if (!n || n.includes('\0') || n.startsWith('../') || n.includes('/../') || n === '..' || n.includes('//')) {
    throw new Error('[vault] 非法的条目名：' + JSON.stringify(name));
  }
  return n;
}

function loadEntries(file, password) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    const err = new Error('[vault] 保险箱不存在或不是合法 JSON：' + file);
    err.code = 'VAULT_MISSING';
    throw err;
  }
  let buf;
  try {
    buf = C.decrypt(password, raw);
  } catch (e) {
    const err = new Error('[vault] 解密失败（密码错误或文件被篡改）');
    err.code = 'VAULT_AUTH';
    throw err;
  }
  let obj;
  try {
    obj = JSON.parse(buf.toString('utf8'));
  } catch (e) {
    const err = new Error('[vault] 解密后的清单不是合法 JSON');
    err.code = 'VAULT_CORRUPT';
    throw err;
  }
  if (!obj || obj.format !== 'fish-vault-entries/v1' || !obj.entries || typeof obj.entries !== 'object') {
    const err = new Error('[vault] 清单结构不正确');
    err.code = 'VAULT_CORRUPT';
    throw err;
  }
  return obj.entries;
}

function saveEntries(file, password, entries) {
  const body = JSON.stringify({ format: 'fish-vault-entries/v1', entries });
  const payload = C.encrypt(password, body);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.rmSync(file, { force: true }); } catch (e2) { /* ignore */ }
    fs.renameSync(tmp, file);
  }
}

function create(file, password) {
  if (fs.existsSync(file)) throw new Error('[vault] 保险箱已存在，拒绝覆盖：' + file);
  saveEntries(file, password, {});
}

function put(entries, name, buf) {
  const n = safeName(name);
  const body = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf), 'utf8');
  entries[n] = { sha256: sha256(body), size: body.length, content: body.toString('base64') };
}

function get(entries, name) {
  const n = safeName(name);
  const e = entries[n];
  if (!e) throw new Error('[vault] 没有这个条目：' + n);
  const buf = Buffer.from(e.content || '', 'base64');
  if (buf.length !== e.size || sha256(buf) !== e.sha256) {
    throw new Error('[vault] 条目校验失败（内容被篡改或损坏）：' + n);
  }
  return buf;
}

function list(entries) {
  return Object.keys(entries).sort().map((n) => ({
    name: n,
    size: entries[n].size,
    sha256: entries[n].sha256,
  }));
}

function extract(entries, name, dir) {
  const n = safeName(name);
  const out = path.join(dir, n.replace(/\//g, path.sep));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, get(entries, n));
  return out;
}

function verify(entries) {
  const bad = [];
  for (const n of Object.keys(entries)) {
    try { get(entries, n); } catch (e) { bad.push({ name: n, error: e.message }); }
  }
  return { total: Object.keys(entries).length, bad };
}

function withLock(root, fn) {
  const lock = path.join(root, LOCK_REL);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  let fd = null;
  try {
    try {
      fd = fs.openSync(lock, 'wx');
      fs.writeFileSync(fd, String(process.pid));
    } catch (e) {
      let st = null;
      try { st = fs.statSync(lock); } catch (e2) { st = null; }
      if (st && Date.now() - st.mtimeMs > STALE_LOCK_MS) {
        fs.rmSync(lock, { force: true });
        fd = fs.openSync(lock, 'wx');
        fs.writeFileSync(fd, String(process.pid));
      } else {
        const err = new Error('[vault] 另一个进程正在写保险箱，请稍后重试');
        err.code = 'VAULT_BUSY';
        throw err;
      }
    }
    return fn();
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (e) { /* ignore */ }
      try { fs.rmSync(lock, { force: true }); } catch (e) { /* ignore */ }
    }
  }
}

module.exports = {
  VAULT_REL, vaultFile, exists, sha256, safeName,
  loadEntries, saveEntries, create, put, get, list, extract, verify, withLock,
};
