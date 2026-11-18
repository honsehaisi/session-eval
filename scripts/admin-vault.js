#!/usr/bin/env node
// 内部资料保险箱 CLI（唯一读取入口）。
//
//   node scripts/admin-vault.js init
//   node scripts/admin-vault.js list           [--key-file <path>] [--vault <path>]
//   node scripts/admin-vault.js read <name>    [--key-file <path>] [--vault <path>]
//   node scripts/admin-vault.js add <file> [name]
//   node scripts/admin-vault.js seal <name> <file>
//   node scripts/admin-vault.js extract <name> [dir]
//   node scripts/admin-vault.js remove <name>
//   node scripts/admin-vault.js change-password
//   node scripts/admin-vault.js verify
//   node scripts/admin-vault.js clean <dir>
//
// 安全约定：
//   - 不接受 --password（防进程列表/命令历史泄露）；只走 TTY 隐藏输入、stdin 或 --key-file。
//   - 不默认读记忆库；--key-file 必须显式给。
//   - 失败统一退出码 3（拦截）/ 4（保险箱缺失或损坏），绝不回退读明文。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const V = require('../src/security/vault.js');
const audit = require('../src/security/audit.js');
const guard = require('../src/security/guard.js');

const ROOT = path.resolve(__dirname, '..');

function usage() {
  process.stderr.write([
    '用法：node scripts/admin-vault.js <命令> [参数] [--key-file <path>] [--vault <path>]',
    '命令：init | list | read <name> | add <file> [name] | seal <name> <file> | extract <name> [dir] | remove <name> | change-password | verify | clean <dir>',
    '',
    '没有密码时访问会被终止；失败退出码 3，保险箱缺失/损坏退出码 4。',
    '',
  ].join('\n'));
}

function parseArgs(argv) {
  const opts = { keyFile: '', vault: '', rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--key-file') { opts.keyFile = argv[++i] || ''; continue; }
    if (a === '--vault') { opts.vault = argv[++i] || ''; continue; }
    if (a === '--help' || a === '-h') { opts.help = true; continue; }
    opts.rest.push(a);
  }
  return opts;
}

function vaultPath(opts) {
  return opts.vault ? path.resolve(opts.vault) : V.vaultFile(ROOT);
}

function stripOneNewline(s) {
  return String(s).replace(/\r?\n$/, '');
}

function authError(msg) {
  const e = new Error(msg);
  e.code = 'VAULT_AUTH';
  return e;
}

function readKeyFile(p) {
  const file = path.resolve(p);
  let s;
  try {
    s = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw authError('[vault] 读不了 key 文件：' + file);
  }
  const v = stripOneNewline(s);
  if (!v) throw authError('[vault] key 文件是空的：' + file);
  return v;
}

function askHidden(prompt) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    if (!stdin.isTTY || !stdout.isTTY) {
      reject(authError('[vault] 当前不是交互终端，无法隐藏输入密码；请用 --key-file 或管道'));
      return;
    }
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    const cleanup = () => {
      stdin.removeListener('data', onData);
      try { stdin.setRawMode(false); } catch (e) { /* ignore */ }
      stdin.pause();
    };
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        cleanup();
        stdout.write('\n');
        resolve(buf);
      } else if (ch === '\u0003') {
        cleanup();
        stdout.write('\n');
        process.exit(130);
      } else if (ch === '\u007f' || ch === '\b') {
        if (buf.length) buf = buf.slice(0, -1);
      } else {
        buf += ch;
      }
    };
    stdin.on('data', onData);
  });
}

function readStdinLine() {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (stdin.isTTY) { reject(authError('[vault] 交互终端请直接输入密码')); return; }
    let s = '';
    let done = false;
    const finish = () => { if (done) return; done = true; resolve(stripOneNewline(s)); };
    const timer = setTimeout(() => { if (!done) { done = true; reject(authError('[vault] 等待密码输入超时')); } }, 5000);
    stdin.setEncoding('utf8');
    stdin.on('data', (d) => { s += d; if (s.includes('\n')) { clearTimeout(timer); finish(); } });
    stdin.on('end', () => { clearTimeout(timer); finish(); });
    stdin.on('error', (e) => { clearTimeout(timer); reject(e); });
    stdin.resume();
  });
}

async function getPassword(opts, prompt) {
  if (opts.keyFile) return readKeyFile(opts.keyFile);
  if (process.stdin.isTTY && process.stdout.isTTY) {
    const p = await askHidden(prompt || '管理员密码: ');
    if (!p) throw authError('[vault] 密码为空');
    return p;
  }
  const p = await readStdinLine();
  if (!p) throw authError('[vault] 密码为空');
  return p;
}

async function getNewPassword(opts) {
  if (opts.keyFile) {
    const p = readKeyFile(opts.keyFile);
    if (p.length < 16) throw authError('[vault] 新密码至少 16 位');
    return p;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw authError('[vault] init/change-password 需要交互终端，两次输入确认');
  }
  const a = await askHidden('设置新密码（至少 16 位）: ');
  const b = await askHidden('再输一次: ');
  if (a !== b) throw authError('[vault] 两次输入不一致');
  if (a.length < 16) throw authError('[vault] 新密码至少 16 位');
  return a;
}

function warnBlocked(detail) {
  process.stderr.write(guard.WARNING + (detail ? '\n[详情] ' + detail : '') + '\n');
}

function fail(code, detail) {
  warnBlocked(detail);
  process.exit(code);
}

function ensureNotLocked() {
  const until = audit.lockedUntil(ROOT);
  if (until) fail(3, '失败次数过多，已临时锁定到 ' + new Date(until).toISOString());
}

function defaultName(file) {
  const abs = path.resolve(file);
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
  return path.basename(abs);
}

function printList(entries) {
  const rows = V.list(entries);
  if (!rows.length) {
    process.stdout.write('（保险箱是空的）\n');
    return;
  }
  for (const r of rows) {
    process.stdout.write(String(r.size).padStart(9) + '  ' + r.sha256.slice(0, 12) + '  ' + r.name + '\n');
  }
  process.stdout.write('共 ' + rows.length + ' 项\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.rest.length) { usage(); process.exit(opts.help ? 0 : 2); }
  const cmd = opts.rest[0];
  const file = vaultPath(opts);

  if (cmd === 'init') {
    if (fs.existsSync(file)) throw new Error('[vault] 保险箱已存在：' + file);
    const pwd = await getNewPassword(opts);
    V.withLock(ROOT, () => V.create(file, pwd));
    audit.noteSuccess(ROOT, 'init', { vault: file });
    process.stdout.write('保险箱已创建：' + file + '\n');
    return;
  }

  if (cmd === 'clean') {
    const dir = path.resolve(opts.rest[1] || '');
    const tmp = path.resolve(os.tmpdir());
    if (!dir || !(dir === tmp || dir.startsWith(tmp + path.sep))) {
      throw new Error('[vault] clean 只允许清理系统临时目录下的解密目录');
    }
    fs.rmSync(dir, { recursive: true, force: true });
    process.stdout.write('已清理：' + dir + '\n');
    return;
  }

  ensureNotLocked();

  if (cmd === 'change-password') {
    const oldPwd = await getPassword(opts, '当前密码: ');
    let entries;
    try {
      entries = V.loadEntries(file, oldPwd);
    } catch (e) {
      audit.noteFailure(ROOT, 'change-password');
      fail(e.code === 'VAULT_AUTH' ? 3 : 4, e.message);
    }
    const newPwd = await getNewPassword({ keyFile: '' });
    V.withLock(ROOT, () => V.saveEntries(file, newPwd, entries));
    audit.noteSuccess(ROOT, 'change-password');
    process.stdout.write('密码已更新（保险箱文件：' + file + '）\n');
    return;
  }

  const pwd = await getPassword(opts, '管理员密码: ');
  let entries;
  try {
    entries = V.loadEntries(file, pwd);
  } catch (e) {
    if (e.code === 'VAULT_AUTH') {
      audit.noteFailure(ROOT, cmd);
      fail(3, '密码错误或保险箱被篡改');
    }
    audit.append(ROOT, { action: cmd, result: 'error', error: e.message });
    fail(4, e.message);
  }

  if (cmd === 'list') {
    printList(entries);
    audit.noteSuccess(ROOT, 'list');
    return;
  }

  if (cmd === 'read') {
    const name = opts.rest[1];
    if (!name) throw new Error('缺少条目名');
    const buf = V.get(entries, name);
    process.stdout.write(buf);
    audit.noteSuccess(ROOT, 'read', { name });
    return;
  }

  if (cmd === 'add' || cmd === 'seal') {
    const src = opts.rest[1];
    const name = cmd === 'add' ? (opts.rest[2] || defaultName(src || '')) : opts.rest[1];
    const source = cmd === 'add' ? src : opts.rest[2];
    if (!source) throw new Error('缺少文件路径');
    const buf = fs.readFileSync(path.resolve(source));
    if (cmd === 'add' && entries[name]) throw new Error('[vault] 条目已存在，改用 seal：' + name);
    V.withLock(ROOT, () => {
      const fresh = V.loadEntries(file, pwd); // 锁内重读，避免覆盖并发修改
      V.put(fresh, name, buf);
      V.saveEntries(file, pwd, fresh);
      entries = fresh;
    });
    audit.noteSuccess(ROOT, cmd, { name, size: buf.length, sha256: V.sha256(buf) });
    process.stdout.write('已写入 ' + name + '（' + buf.length + ' 字节）\n');
    return;
  }

  if (cmd === 'remove') {
    const name = opts.rest[1];
    if (!name) throw new Error('缺少条目名');
    V.withLock(ROOT, () => {
      const fresh = V.loadEntries(file, pwd);
      if (!fresh[name]) throw new Error('[vault] 没有这个条目：' + name);
      delete fresh[name];
      V.saveEntries(file, pwd, fresh);
    });
    audit.noteSuccess(ROOT, 'remove', { name });
    process.stdout.write('已删除 ' + name + '\n');
    return;
  }

  if (cmd === 'extract') {
    const name = opts.rest[1];
    if (!name) throw new Error('缺少条目名');
    const dir = path.resolve(opts.rest[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'fish-vault-')));
    const tmp = path.resolve(os.tmpdir());
    if (!(dir === tmp || dir.startsWith(tmp + path.sep))) {
      throw new Error('[vault] 为了安全，extract 只允许解到系统临时目录；用完执行 clean <dir>');
    }
    const out = V.extract(entries, name, dir);
    audit.noteSuccess(ROOT, 'extract', { name, dir });
    process.stdout.write(out + '\n');
    return;
  }

  if (cmd === 'verify') {
    const r = V.verify(entries);
    process.stdout.write('共 ' + r.total + ' 项，校验失败 ' + r.bad.length + ' 项\n');
    for (const b of r.bad) process.stdout.write('  ! ' + b.name + '：' + b.error + '\n');
    audit.noteSuccess(ROOT, 'verify', { total: r.total, bad: r.bad.length });
    if (r.bad.length) process.exit(4);
    return;
  }

  usage();
  process.exit(2);
}

main().catch((e) => {
  const code = e && e.code === 'VAULT_AUTH' ? 3 : (e && (e.code === 'VAULT_MISSING' || e.code === 'VAULT_CORRUPT') ? 4 : 0);
  if (code) {
    audit.noteFailure(ROOT, (process.argv[2] || 'unknown'));
    fail(code, e.message);
  }
  process.stderr.write('[vault] ' + (e && e.message ? e.message : String(e)) + '\n');
  process.exit(1);
});
