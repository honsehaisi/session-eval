'use strict';
// 大肥鱼测评 · Electron 主进程
// 职责：①把测评运行时准备到可写目录 ②开窗口 ③跑 run-all / build-report 并把输出推给界面
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');

// 应用名要早设：userData 目录、开始菜单、任务栏全都跟着它
app.setName('大肥鱼测评');
if (process.platform === 'win32') app.setAppUserModelId('com.dafeiyu.fisheval');

const isDev = !app.isPackaged;
let win = null;
let running = false;
let RUNTIME = '';
let CONFIG_PATH = '';
let REPORT_HTML = '';
let WELCOME = path.join(__dirname, 'welcome.html');
let lastRun = null;

// 不打进运行时的东西
const SKIP = new Set(['app', 'node_modules', '.git', '.githooks', '.github', '_tmp', '_work', 'internal', 'docs', 'tests', '.gitignore', 'sess.json', 'config.json', 'config.seed.json']);

function srcRoot() {
  return isDev ? path.resolve(__dirname, '..') : path.join(process.resourcesPath, 'eval');
}

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  let n = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) n += copyTree(s, d);
    else if (e.isFile()) { fs.copyFileSync(s, d); n++; }
  }
  return n;
}

function seedConfig() {
  const cands = [path.join(srcRoot(), 'config.seed.json'), path.join(srcRoot(), 'config.json')];
  for (const p of cands) {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      JSON.parse(raw);
      fs.writeFileSync(CONFIG_PATH, raw);
      return p;
    } catch (e) { /* 继续找下一个 */ }
  }
  const fallback = {
    _note: '由桌面软件生成，可在设置里改',
    paths: {
      sessionsDir: '~/.dsh/sessions', memoryDir: '~/.memory', homeDir: '~',
      dshDir: '~/.dsh', qbankFile: '', defaultCwd: '', dataSource: 'dsh',
      memoryEvidence: '', speedEvidence: '', consistencyEvidence: ''
    },
    roots: { extraWriteRoots: [] }
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(fallback, null, 2));
  return '(内置默认)';
}

function ensureRuntime() {
  const root = srcRoot();
  if (isDev) {
    RUNTIME = root;
  } else {
    RUNTIME = path.join(app.getPath('userData'), 'runtime');
    let buildId = '';
    try { buildId = JSON.parse(fs.readFileSync(path.join(__dirname, 'build-id.json'), 'utf8')).id; } catch (e) {}
    let stamped = '';
    try { stamped = fs.readFileSync(path.join(RUNTIME, '.stamp'), 'utf8').trim(); } catch (e) {}
    const ok = fs.existsSync(path.join(RUNTIME, 'scripts', 'run-all.js'));
    if (!ok || (buildId && stamped !== buildId)) {
      // 版本变了整包重铺：先清掉旧运行时，避免上一版遗留的证据样本混进来
      for (const d of ['src', 'scripts', 'rules', 'report']) {
        try { fs.rmSync(path.join(RUNTIME, d), { recursive: true, force: true }); } catch (e) { /* ignore */ }
      }
      copyTree(root, RUNTIME);
      fs.mkdirSync(RUNTIME, { recursive: true });
      fs.writeFileSync(path.join(RUNTIME, '.stamp'), buildId || 'dev');
    }
  }
  CONFIG_PATH = path.join(RUNTIME, 'config.json');
  REPORT_HTML = path.join(RUNTIME, 'report', 'report.html');
  if (!fs.existsSync(CONFIG_PATH)) seedConfig();
}

function send(ch, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(ch, payload);
}

function loadReport() {
  if (fs.existsSync(REPORT_HTML)) win.loadFile(REPORT_HTML);
  else win.loadFile(WELCOME);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 1020, minWidth: 900, minHeight: 640,
    title: '大肥鱼测评',
    backgroundColor: '#f6f7f9',
    icon: path.join(__dirname, 'build-icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.setMenuBarVisibility(false);
  // 有些启动路径（后台/快捷方式）会把窗口折叠成最小化；最小化时不出帧，ready-to-show 也不会来
  const bringFront = () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };
  win.once('ready-to-show', bringFront);
  win.webContents.on('did-finish-load', () => setTimeout(bringFront, 300));
  setTimeout(bringFront, 1500);
  loadReport();
  if (process.env.FE_SHOT) {
    win.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        try {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(process.env.FE_SHOT, img.toPNG());
          console.log("[shot] saved", process.env.FE_SHOT);
        } catch (e) { console.error("[shot] fail", e.message); }
        app.quit();
      }, 2000);
    });
  }
  win.on('closed', () => { win = null; });
}

// 跑一个脚本，逐行回传
function runScript(scriptRel, onLine) {
  return new Promise((resolve) => {
    const full = path.join(RUNTIME, scriptRel);
    if (!fs.existsSync(full)) return resolve({ code: -1, err: '找不到脚本: ' + full });
    const env = Object.assign({}, process.env, {
      ELECTRON_RUN_AS_NODE: '1',
      SYSEVAL_CONFIG: CONFIG_PATH
    });
    const p = cp.spawn(process.execPath, [full], {
      cwd: RUNTIME, env, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let tail = '';
    let buf = '';
    const feed = (chunk, isErr) => {
      buf += chunk.toString('utf8');
      const parts = buf.split('\n');
      buf = parts.pop();
      for (const line of parts) {
        if (onLine) onLine(line, isErr);
        tail = (tail + '\n' + line).slice(-4000);
      }
    };
    p.stdout.on('data', (d) => feed(d, false));
    p.stderr.on('data', (d) => feed(d, true));
    p.on('error', (e) => resolve({ code: -1, err: String(e && e.message) }));
    p.on('close', (code) => {
      if (buf.trim() && onLine) onLine(buf, false);
      resolve({ code, tail });
    });
  });
}

async function runEval() {
  if (running) return { ok: false, error: '已经有一个测评在跑' };
  running = true;
  const t0 = Date.now();
  send('eval:start', { total: 10 });
  try {
    let step = 0;
    const r = await runScript(path.join('scripts', 'run-all.js'), (line) => {
      send('eval:log', line);
      const m = line.match(/^===\s+(.+?)\s+\(([^)]+)\)/);
      if (m) {
        step = Math.min(step + 1, 10);
        send('eval:progress', { step, total: 10, name: m[1] });
      }
    });
    if (r.code !== 0) {
      send('eval:log', '!!! run-all 退出码 ' + r.code + '，产物可能不完整');
      running = false;
      return { ok: false, error: 'run-all 失败（退出码 ' + r.code + '）', sec: (Date.now() - t0) / 1000 };
    }
    send('eval:log', '→ 正在生成报告页');
    const b = await runScript(path.join('scripts', 'build-report.js'), (line) => send('eval:log', line));
    if (b.code !== 0) {
      running = false;
      return { ok: false, error: 'build-report 失败（退出码 ' + b.code + '）', sec: (Date.now() - t0) / 1000 };
    }
    const sec = (Date.now() - t0) / 1000;
    lastRun = { sec, at: Date.now() };
    running = false;
    send('eval:log', '完成，用时 ' + sec.toFixed(1) + 's');
    return { ok: true, sec };
  } catch (e) {
    running = false;
    return { ok: false, error: String((e && e.message) || e) };
  }
}

ipcMain.handle('app:info', () => ({
  runtime: RUNTIME,
  reportPath: REPORT_HTML,
  configPath: CONFIG_PATH,
  hasReport: fs.existsSync(REPORT_HTML),
  running,
  lastRun,
  version: app.getVersion(),
  electron: process.versions.electron
}));

ipcMain.handle('eval:run', async () => {
  const res = await runEval();
  if (res.ok) send('eval:done', res);
  else send('eval:error', res);
  return res;
});

ipcMain.handle('app:openReport', () => shell.openPath(REPORT_HTML));
ipcMain.handle('app:openRuntime', () => shell.openPath(RUNTIME));

ipcMain.handle('config:read', () => {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch (e) { return { paths: {}, roots: {} }; }
});

ipcMain.handle('config:save', (evt, next) => {
  try {
    const cur = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const merged = Object.assign({}, cur, next);
    merged.paths = Object.assign({}, cur.paths || {}, next.paths || {});
    merged.roots = Object.assign({}, cur.roots || {}, next.roots || {});
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e.message) }; }
});

ipcMain.handle('app:reloadReport', () => { loadReport(); return true; });

app.whenReady().then(() => {
  ensureRuntime();
  if (process.argv.includes('--selftest')) {
    const out = {
      ok: true,
      runtime: RUNTIME,
      configPath: CONFIG_PATH,
      configExists: fs.existsSync(CONFIG_PATH),
      hasReport: fs.existsSync(REPORT_HTML),
      reportBytes: fs.existsSync(REPORT_HTML) ? fs.statSync(REPORT_HTML).size : 0,
      runAllExists: fs.existsSync(path.join(RUNTIME, 'scripts', 'run-all.js')),
      stamp: (function () { try { return fs.readFileSync(path.join(RUNTIME, '.stamp'), 'utf8').trim(); } catch (e) { return ''; } })(),
      electron: process.versions.electron,
      packed: app.isPackaged,
      argv: process.argv
    };
    const t = process.env.FE_SELFTEST_OUT || path.join(app.getPath('temp'), 'fe-selftest.json');
    fs.writeFileSync(t, JSON.stringify(out, null, 2));
    app.quit();
    return;
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
