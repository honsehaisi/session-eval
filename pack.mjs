// 打包：把 app/ 打成独立 exe，并把测评运行时放进 resources/eval
import { packager } from '@electron/packager';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const STAGE = path.join(HERE, 'eval');

// 1) 清空并重建运行时暂存目录
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
// 中间产物不带：跑分时会重新生成，带着只会让包大 100MB
const SKIP_FILE = /^[a-z]*sessions?\.json$|^report\.html$/;
// S6：本机证据产物不进包——记忆/速度两维未开放前，别人的报告不该出现我的数
// 1.0.4：把其余维度的本机样本也排掉（成本/稳定/交付/诚实/安全证据），跑时由各步重算
const SKIP_REL = new Set([
  'src/memory/report.json',
  'src/memory/report-offline.json',
  'src/memory/questions.json',
  'src/memory/answers.json',
  'src/tasks/report.json',
  'src/tasks/reconcile.json',
  'src/cost/sess.json',
  'src/stability/report.json',
  'src/delivery/report.json',
  'src/honesty/report.json',
  'src/honesty/claims-all.json',
  'src/honesty/out-L.json',
  'src/honesty/out-M.json',
  'src/honesty/out-S.json',
  'src/safety/a2.json',
  'src/safety/report.json',
  'src/safety/sample.json',
  'src/safety/报告-安全维度v1.md',
  'src/safety/c7-hits.json',
  'src/safety/seq.json',
  'src/consistency/t0b-plan.json',
  'src/consistency/t1-plan.json',
  'src/consistency/answers-t0b.json',
  'src/consistency/snapshots.json',
  'src/memory/verdict-overrides.json',
  // 1.0.5：素材同步工具只给开发用（依赖本机表情库 + ffmpeg），不进运行包
  'scripts/sync-memes.js',
  // 安全层工具只给本机/开发用，不进运行包
  'scripts/admin-vault.js',
  'scripts/check-public.js',
  'scripts/export-public.js',
  'scripts/setup-hooks.js',
  'scripts/setup-security.js',
  'rules/safety.local.json',
]);
const MAX_BYTES = 4 * 1024 * 1024;
function copyTree(src, dst, rel) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) { copyTree(s, d, r); continue; }
    if (!e.isFile()) continue;
    if (SKIP_FILE.test(e.name)) continue;
    if (SKIP_REL.has(r)) continue;
    const st = fs.statSync(s);
    if (st.size > MAX_BYTES) continue;
    fs.copyFileSync(s, d);
  }
}
for (const d of ['src', 'scripts', 'rules', 'report']) {
  copyTree(path.join(PROJECT, d), path.join(STAGE, d), d);
}

// 版本戳：运行时只在版本变化时才重新拷一遍
fs.writeFileSync(path.join(HERE, 'build-id.json'), JSON.stringify({ id: Date.now().toString(36), at: new Date().toISOString() }, null, 2));
for (const f of ['package.json', 'config.sample.json', 'README.md']) {
  const from = path.join(PROJECT, f);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(STAGE, f));
}
// 给 AI 的使用方式（人读版在界面「使用方式」按钮里；沿用 docs 原文，不另起一份）
const aiDoc = path.join(PROJECT, 'docs', '给AI的使用方式.md');
if (fs.existsSync(aiDoc)) fs.copyFileSync(aiDoc, path.join(STAGE, '给AI的使用方式.md'));
// 1.0.4：对外发布做本机身份脱敏（只改包内副本，源项目不动）
// 安全规则表的 identity 段是本机配置：QQ 号、信任名单、NapCat token 前缀、本机扫描根
const safetyP = path.join(STAGE, 'rules', 'safety.json');
if (fs.existsSync(safetyP)) {
  try {
    const j = JSON.parse(fs.readFileSync(safetyP, 'utf8'));
    if (j.identity) {
      j.identity.ownerUid = '';
      j.identity.trustedUid = '';
      j.identity.ownerPrivate = '';
      j.identity.napcatTokenPrefixes = [];
      if (j.identity.keyPool) j.identity.keyPool.napcatPrefix = '';
      if (j.identity.keyScan) j.identity.keyScan.roots = [];
    }
    const txt = JSON.stringify(j, null, 2);
    fs.writeFileSync(safetyP, txt);
  } catch (e) { console.warn('  ! 脱敏 safety.json 跳过：' + e.message); }
}
// 一致性模板里写死了记忆库路径，换成通用占位（用当前用户主目录，不写死用户名）
const HOME = os.homedir();
for (const rel of ['src/consistency/prompt-template.md', 'src/consistency/README.md']) {
  const p = path.join(STAGE, rel);
  if (!fs.existsSync(p)) continue;
  const s = fs.readFileSync(p, 'utf8')
    .split(HOME + '\\.memory').join('<你的记忆库路径>')
    .split(HOME).join('C:\\Users\\User');
  fs.writeFileSync(p, s);
}
// S6：不再把本机 config.json 当种子带进包——它含本机路径、工作区豁免和旧证据路径。
// 首次启动由 main.js 写「内置默认」（~/.dsh/sessions + 空证据），用户可在设置里改。

// 2) 打包
const outDir = path.join(PROJECT, 'dist');
const built = await packager({
  dir: HERE,
  name: '大肥鱼测评',
  executableName: '大肥鱼测评',
  platform: 'win32',
  arch: 'x64',
  electronVersion: '43.3.0',
  out: outDir,
  overwrite: true,
  asar: true,
  prune: true,
  extraResource: ['eval'],
  icon: path.join(HERE, 'build-icon.ico'),
  ignore: [/^\/eval(\/|$)/, /^\/_work(\/|$)/, /^\/_tmp(\/|$)/, /^\/_test(\/|$)/, /^\/internal(\/|$)/, /^\/\.githooks(\/|$)/, /^\/\.github(\/|$)/, /^\/pack\.mjs$/, /^\/_mkicon/],
});
// 兼容启动器：沙箱/杀软导致直接双击无反应时，用 --no-sandbox 再试一次
fs.writeFileSync(path.join(outDir, "大肥鱼测评-win32-x64", "打不开就试这个.cmd"),
  '@echo off\r\nstart "" "%~dp0大肥鱼测评.exe" --no-sandbox\r\n');

// 快捷方式用的独立图标文件：放在 exe 旁边，路径稳定，改图标时缓存好刷
fs.copyFileSync(path.join(HERE, "build-icon.ico"), path.join(outDir, "大肥鱼测评-win32-x64", "大肥鱼图标.ico"));

console.log('打包完成：');
for (const p of built) console.log('  ' + p);
