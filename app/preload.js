'use strict';
// 界面层：不碰报告页的 DOM，全部塞进 shadow DOM，避免和 report.html 的 CSS 打架
const { ipcRenderer } = require('electron');

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif; }
.bar {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
  display: flex; align-items: center; gap: 8px;
  background: #ffffff; border: 1px solid #e5e7eb; border-radius: 999px;
  padding: 8px 10px 8px 14px; box-shadow: 0 8px 24px rgba(15,23,42,.12);
}
.status { font-size: 13px; color: #475569; display: flex; align-items: center; gap: 6px; max-width: 320px; }
.status .dot { width: 7px; height: 7px; border-radius: 50%; background: #94a3b8; flex: none; }
.status.run .dot { background: #6366f1; animation: pulse 1.2s infinite; }
.status.ok .dot { background: #16a34a; }
.status.bad .dot { background: #dc2626; }
@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .25 } }
button {
  border: 1px solid transparent; border-radius: 999px; cursor: pointer;
  font-size: 13px; padding: 7px 14px; background: #f1f5f9; color: #1f2937;
  transition: filter .15s; white-space: nowrap;
}
button:hover { filter: brightness(.96); }
button:disabled { opacity: .55; cursor: default; }
button.primary { background: #6366f1; color: #fff; font-weight: 600; }
button.ghost { background: transparent; border-color: #e2e8f0; color: #475569; padding: 7px 11px; }
.progress { position: fixed; left: 0; top: 0; right: 0; height: 3px; z-index: 2147483001; background: transparent; }
.progress i { display: block; height: 100%; width: 0%; background: #6366f1; transition: width .3s; }
.log {
  position: fixed; right: 20px; bottom: 84px; z-index: 2147483000;
  width: min(720px, calc(100vw - 40px)); height: 300px;
  background: #0f172a; color: #cbd5e1; border-radius: 14px; overflow: hidden;
  box-shadow: 0 16px 40px rgba(15,23,42,.28); display: flex; flex-direction: column;
}
.log-head { display: flex; justify-content: space-between; align-items: center;
  padding: 9px 14px; font-size: 12px; color: #94a3b8; border-bottom: 1px solid #1e293b; }
.log-head b { font-weight: 600; }
.log-head span { cursor: pointer; }
.log pre { margin: 0; padding: 10px 14px; overflow: auto; font-size: 12px; line-height: 1.55;
  font-family: Consolas, "Cascadia Mono", monospace; white-space: pre-wrap; word-break: break-all; flex: 1; }
.modal { position: fixed; inset: 0; z-index: 2147483002; background: rgba(15,23,42,.38);
  display: flex; align-items: center; justify-content: center; }
.card { width: min(620px, calc(100vw - 48px)); background: #fff; border-radius: 16px; padding: 22px 24px;
  box-shadow: 0 24px 60px rgba(15,23,42,.3); }
.card h3 { margin: 0 0 4px; font-size: 17px; color: #0f172a; }
.card p.tip { margin: 0 0 16px; font-size: 12px; color: #64748b; line-height: 1.6; }
.field { margin-bottom: 12px; }
.field label { display: block; font-size: 12px; color: #475569; margin-bottom: 4px; }
.field input, .field textarea {
  width: 100%; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 10px;
  font-size: 13px; color: #0f172a; background: #fbfcfe; outline: none;
}
.field textarea { height: 62px; resize: vertical; font-family: Consolas, monospace; }
.field input:focus, .field textarea:focus { border-color: #6366f1; background: #fff; }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
.toast { position: fixed; left: 50%; top: 18px; transform: translateX(-50%); z-index: 2147483003;
  background: #0f172a; color: #fff; font-size: 13px; padding: 9px 16px; border-radius: 10px;
  box-shadow: 0 10px 30px rgba(15,23,42,.3); }
.card.usage { width: min(760px, calc(100vw - 48px)); max-height: 82vh; overflow: auto; }
.card.usage h3 { font-size: 19px; margin-bottom: 2px; }
.card.usage h4 { margin: 20px 0 6px; font-size: 14px; color: #0f172a; }
.card.usage p, .card.usage li { font-size: 13.5px; line-height: 1.8; color: #334155; margin: 5px 0; }
.card.usage ul, .card.usage ol { margin: 6px 0; padding-left: 22px; }
.card.usage code { background: #f1f5f9; border-radius: 4px; padding: 1px 5px; font-size: 12px; font-family: Consolas, monospace; }
.card.usage .muted { color: #64748b; font-size: 12.5px; }
.hidden { display: none !important; }
`;

const TPL = `
<div class="progress"><i id="bar"></i></div>
<div class="bar">
  <div class="status" id="status"><span class="dot"></span><span id="status-text">就绪</span></div>
  <button class="primary" id="btn-run">重新测评</button>
  <button class="ghost" id="btn-use">使用方式</button>
  <button class="ghost" id="btn-log">日志</button>
  <button class="ghost" id="btn-set">设置</button>
</div>
<div class="log hidden" id="log">
  <div class="log-head"><b>运行日志</b><span id="log-close">收起</span></div>
  <pre id="log-body"></pre>
</div>
<div class="modal hidden" id="usage">
  <div class="card usage">
    <h3>怎么用「大肥鱼测评」</h3>
    <p class="muted">给 AI 助手做一次体检：读会话日志 → 八项打分 → 出一份网页报告。</p>

    <h4>三步开始</h4>
    <ol>
      <li>把整个 <code>大肥鱼测评-win32-x64</code> 文件夹原样放着，别把里面的文件拆出来——程序要跟 resources 放一起。</li>
      <li>双击 <code>大肥鱼测评.exe</code>，等窗口出来。第一次打开显示欢迎页，这是正常的。</li>
      <li>点右下角「重新测评」，进度条会一格一格走，一般 1～4 分钟。跑完报告会自动刷新出来。</li>
    </ol>

    <h4>它读哪儿的日志？</h4>
    <ul>
      <li>默认读 DSH 的日志：<code>~/.dsh/sessions</code>。如果你也用 DSH，点「重新测评」就行，不用改设置。</li>
      <li>用的是别的 AI 工具？把会话日志导出成「一行一条」的 JSONL，点「设置」把日志目录指过去，数据源切成 <code>generic</code>，字段名照包内 README §5.2 填。包里的《给AI的使用方式.md》有给 AI 看的详细版。</li>
      <li>还没有任何日志？先点「设置」确认日志目录对不对，没数据的话跑出来会是空的。</li>
    </ul>

    <h4>看到「未覆盖」别慌</h4>
    <p>记忆、一致性这两格现在还没对外开放，显示「未覆盖」不是 0 分，是不参与算分。等后续版本开放。</p>

    <h4>几个提醒</h4>
    <ul>
      <li>安全这一格在通用日志模式下只覆盖部分规则，报告给 A <b>不代表绝对安全</b>。</li>
      <li>第一次打开可能被 Windows 拦一下（程序没签名），点「更多信息 → 仍要运行」。</li>
      <li>跑出来的分都是按你这次的日志算的，不会混进别人的数据。</li>
    </ul>

    <p class="muted">想看得更细：交付目录里有 <code>使用说明.md</code>；想让 AI 帮你接数据源：包里的 <code>resources/eval/给AI的使用方式.md</code>。</p>
    <div class="actions"><button class="ghost" id="btn-use-close">知道了</button></div>
  </div>
</div>
<div class="modal hidden" id="modal">
  <div class="card">
    <h3>数据源设置</h3>
    <p class="tip">改完保存，下次测评生效。路径支持 <code>~</code> 表示当前用户目录。</p>
    <div class="field"><label>会话日志目录 sessionsDir</label><input id="f-sessions"></div>
    <div class="field"><label>记忆库目录 memoryDir</label><input id="f-memory"></div>
    <div class="field"><label>默认工作目录 defaultCwd</label><input id="f-cwd"></div>
    <div class="field"><label>记忆题库文件 qbankFile（可空）</label><input id="f-qbank"></div>
    <div class="field"><label>记忆证据文件 memoryEvidence（可空 = 未覆盖）</label><input id="f-mem-ev"></div>
    <div class="field"><label>速度证据文件 speedEvidence（可空 = 用现算）</label><input id="f-speed-ev"></div>
    <div class="field"><label>额外可写根（每行一个）</label><textarea id="f-roots"></textarea></div>
    <div class="actions">
      <button class="ghost" id="btn-open-runtime">打开数据目录</button>
      <button class="ghost" id="btn-cancel">取消</button>
      <button class="primary" id="btn-save">保存</button>
    </div>
  </div>
</div>
<div class="toast hidden" id="toast"></div>
`;

const state = { busy: false, lines: [], step: 0, total: 10 };

function boot() {
  if (document.getElementById('fe-host')) return;
  const host = document.createElement('div');
  host.id = 'fe-host';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<style>' + CSS + '</style>' + TPL;

  const $ = (id) => root.getElementById(id);
  const statusEl = $('status');
  const statusText = $('status-text');
  const bar = $('bar');
  const logEl = $('log');
  const logBody = $('log-body');
  const modal = $('modal');
  const toastEl = $('toast');

  function setStatus(kind, text) {
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
    statusText.textContent = text;
  }
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.add('hidden'), ms || 2600);
  }
  function pushLog(line) {
    state.lines.push(line);
    if (state.lines.length > 600) state.lines.splice(0, state.lines.length - 600);
    const atBottom = logBody.scrollTop + logBody.clientHeight >= logBody.scrollHeight - 24;
    logBody.textContent = state.lines.join('\n');
    if (atBottom) logBody.scrollTop = logBody.scrollHeight;
  }

  async function run() {
    if (state.busy) return;
    state.busy = true;
    state.lines = [];
    state.step = 0;
    logBody.textContent = '';
    bar.style.width = '0%';
    $('btn-run').disabled = true;
    $('btn-run').textContent = '测评中…';
    setStatus('run', '正在测评 0/' + state.total);
    logEl.classList.remove('hidden');
    try {
      const res = await ipcRenderer.invoke('eval:run');
      if (res && res.ok) {
        setStatus('ok', '刚跑完 · ' + Number(res.sec).toFixed(1) + 's');
        toast('测评完成，用时 ' + Number(res.sec).toFixed(1) + ' 秒');
        setTimeout(() => ipcRenderer.invoke('app:reloadReport'), 900);
      } else {
        setStatus('bad', '失败：' + ((res && res.error) || '未知'));
        toast('测评失败：' + ((res && res.error) || '未知'), 6000);
        logEl.classList.remove('hidden');
      }
    } catch (e) {
      setStatus('bad', '异常：' + e.message);
      toast('异常：' + e.message, 6000);
    } finally {
      state.busy = false;
      $('btn-run').disabled = false;
      $('btn-run').textContent = '重新测评';
      bar.style.width = '0%';
    }
  }

  $('btn-run').addEventListener('click', run);
  $('btn-use').addEventListener('click', () => $('usage').classList.remove('hidden'));
  $('btn-use-close').addEventListener('click', () => $('usage').classList.add('hidden'));
  $('btn-log').addEventListener('click', () => logEl.classList.toggle('hidden'));
  $('log-close').addEventListener('click', () => logEl.classList.add('hidden'));
  $('btn-cancel').addEventListener('click', () => modal.classList.add('hidden'));
  $('btn-open-runtime').addEventListener('click', () => ipcRenderer.invoke('app:openRuntime'));

  $('btn-set').addEventListener('click', async () => {
    const cfg = await ipcRenderer.invoke('config:read');
    const p = cfg.paths || {};
    $('f-sessions').value = p.sessionsDir || '';
    $('f-memory').value = p.memoryDir || '';
    $('f-cwd').value = p.defaultCwd || '';
    $('f-qbank').value = p.qbankFile || '';
    $('f-mem-ev').value = p.memoryEvidence || '';
    $('f-speed-ev').value = p.speedEvidence || '';
    $('f-roots').value = ((cfg.roots && cfg.roots.extraWriteRoots) || []).join('\n');
    modal.classList.remove('hidden');
  });

  $('btn-save').addEventListener('click', async () => {
    const next = {
      paths: {
        sessionsDir: $('f-sessions').value.trim(),
        memoryDir: $('f-memory').value.trim(),
        defaultCwd: $('f-cwd').value.trim(),
        qbankFile: $('f-qbank').value.trim(),
        memoryEvidence: $('f-mem-ev').value.trim(),
        speedEvidence: $('f-speed-ev').value.trim()
      },
      roots: {
        extraWriteRoots: $('f-roots').value.split('\n').map((s) => s.trim()).filter(Boolean)
      }
    };
    const r = await ipcRenderer.invoke('config:save', next);
    if (r && r.ok) { modal.classList.add('hidden'); toast('已保存，下次测评生效'); }
    else toast('保存失败：' + ((r && r.error) || '未知'), 5000);
  });

  ipcRenderer.on('eval:start', (e, p) => {
    state.total = p.total || 10;
    state.step = 0;
    bar.style.width = '2%';
  });
  ipcRenderer.on('eval:progress', (e, p) => {
    state.step = p.step;
    bar.style.width = Math.max(3, Math.round((p.step / (p.total || 10)) * 100)) + '%';
    setStatus('run', '正在测评 ' + p.step + '/' + (p.total || 10) + ' · ' + p.name);
  });
  ipcRenderer.on('eval:log', (e, line) => pushLog(line));

  ipcRenderer.invoke('app:info').then((info) => {
    if (info && info.lastRun && Date.now() - info.lastRun.at < 120000) {
      setStatus('ok', '刚跑完 · ' + Number(info.lastRun.sec).toFixed(1) + 's');
    }
  });
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
