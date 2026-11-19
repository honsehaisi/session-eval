// 报告页 UI 自测：把 report.html 里的渲染脚本跑在最小 DOM 桩上，检查真正渲染出来的 HTML（需先 node scripts/build-report.js）
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const REPORT_FILE = path.join(ROOT, 'report.json');
const HTML_FILE = path.join(ROOT, 'report', 'report.html');
const TPL = fs.readFileSync(path.join(ROOT, 'report', 'template.html'), 'utf8');
const HAS = fs.existsSync(REPORT_FILE) && fs.existsSync(HTML_FILE);
if (!HAS) {
  // 公开仓/干净检出没有本机产物：跳过，不是失败。先跑 run-all + build-report 再测。
  test('report UI 产物缺失（跳过；先跑 run-all + build-report）', { skip: true }, () => {});
  return;
}
const REPORT = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));
const HTML = fs.readFileSync(HTML_FILE, 'utf8');

const GRADE_KEY = g => {
  if (!g) return 'none';
  const s = String(g).toLowerCase();
  if (s === 'uncovered' || s === 'none') return 'none';
  return /^[abcde]$/.test(s) ? s : 'none';
};

// 用最小 DOM 桩跑页面内联脚本，拿回真正渲染出来的 innerHTML
function render() {
  const dataSrc = HTML.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
  const memesSrc = HTML.match(/<script id="meme-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
  const mainSrc = HTML.match(/<script>\n([\s\S]*?)<\/script>/)[1];
  const nodes = {};
  const document = {
    getElementById(id) { return nodes[id] || (nodes[id] = { textContent: '', innerHTML: '' }); }
  };
  nodes['report-data'] = { textContent: dataSrc, innerHTML: '' };
  nodes['meme-data'] = { textContent: memesSrc, innerHTML: '' };
  new Function('document', mainSrc)(document);
  return nodes;
}

const NODES = render();
const APP = NODES['app'].innerHTML;
const SUB = NODES['sub'].textContent;

test('模板留有 report.json 与表情包两个注入口', () => {
  assert.ok(TPL.includes('__REPORT_JSON__'), '缺 __REPORT_JSON__');
  assert.ok(TPL.includes('__MEMES_JSON__'), '缺 __MEMES_JSON__');
});

test('产物内联 9 张表情图，且没有外链', () => {
  const n = (HTML.match(/data:image\/jpeg;base64,/g) || []).length;
  assert.strictEqual(n, 9, '内联表情图应为 9 张（a~e/none/overall + 2 张贴纸），实际 ' + n);
  assert.ok(!/https?:\/\//.test(HTML), '产物含外链');
});

test('每个出现过的等级都渲染出对应表情图', () => {
  const memes = JSON.parse(HTML.match(/<script id="meme-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  const grades = [REPORT.overall.grade];
  Object.keys(REPORT.dims).forEach(id => grades.push(REPORT.dims[id].grade));
  for (const g of grades) {
    const k = GRADE_KEY(g);
    assert.ok(memes[k], '等级 ' + g + '（键 ' + k + '）没图');
    assert.ok(APP.includes(memes[k]), '等级 ' + g + ' 的表情没渲染进页面');
  }
});

test('八维每行渲染：名称、分数、大等级', () => {
  Object.keys(REPORT.dims).forEach(id => {
    const d = REPORT.dims[id];
    assert.ok(APP.includes('>' + d.label + '<'), '缺维度名 ' + d.label);
    if (typeof d.score === 'number') {
      assert.ok(APP.includes(d.score.toFixed(1) + '/4'), d.label + ' 缺分数');
      assert.ok(APP.includes('>' + d.grade + '<'), d.label + ' 缺大等级 ' + d.grade);
      assert.ok(APP.includes('class="bar-grade tint-' + GRADE_KEY(d.grade)), d.label + ' 等级没上色');
    }
  });
  // 大等级是主视觉：八维里 8 行、每行一个 bar-grade
  assert.strictEqual((APP.match(/class="bar-grade/g) || []).length, 8, '八维应有 8 个大等级');
});

test('未覆盖维度仍走斜纹 + 未覆盖文案，不显示 0 分', () => {
  // 哪个维度未覆盖由当轮数据决定（2026-11-19 起一致性已出数，只剩记忆）
  const uncovered = Object.keys(REPORT.dims).filter(id => typeof REPORT.dims[id].score !== 'number');
  if (uncovered.length) {
    assert.ok(APP.includes('class="bar-none"'), '缺未覆盖斜纹');
    assert.ok(APP.includes('>未覆盖<'), '缺未覆盖文案');
    uncovered.forEach(id => assert.notStrictEqual(REPORT.dims[id].score, 0, id + ' 未覆盖却算成 0 分'));
  }
  assert.ok(!APP.includes('0.0/4'), '不该出现 0.0/4（未覆盖不是零分）');
});

test('小结卡的数字与数据一致（不是写死的）', () => {
  const covered = Object.keys(REPORT.dims).filter(id => typeof REPORT.dims[id].score === 'number');
  const pass = covered.filter(id => REPORT.dims[id].grade === 'A' || REPORT.dims[id].grade === 'B');
  assert.ok(APP.includes(pass.length + ' / ' + covered.length + ' 维到 B'),
    '小结合格数应为 ' + pass.length + '/' + covered.length);
  assert.ok(APP.includes(String(REPORT.overall.pass_rate) + '%'), '小结缺合格率');
  const low = REPORT.overall.lowest[0];
  assert.ok(APP.includes(REPORT.dims[low.dim].label + ' ' + low.grade), '小结缺最拖后腿维度');
  const uncovered = Object.keys(REPORT.dims).filter(id => typeof REPORT.dims[id].score !== 'number');
  uncovered.forEach(id => assert.ok(APP.includes('还没测') && APP.includes(REPORT.dims[id].label), '小结缺未测项 ' + id));
});

test('副标题保留生成时间/样本时点/覆盖数', () => {
  assert.ok(SUB.includes('已覆盖 ' + REPORT.overall.covered + '/' + REPORT.overall.total));
  assert.ok(SUB.includes('样本时点'));
});

test('表情瓦片白底相框 + 宽屏两栏 + 打印隐藏小结卡', () => {
  assert.ok(/\.meme \{[^}]*background: #fff/.test(TPL), '表情瓦片应固定白底');
  assert.ok(TPL.includes('@media (min-width: 1080px)'), '缺宽屏两栏断点');
  assert.ok(TPL.includes('.note { display: none !important'), '打印应隐藏小结卡');
});

test('综合四格都配了等级表情：已覆盖/合格率折成 4 分制、最低维度取自身等级', () => {
  const memes = JSON.parse(HTML.match(/<script id="meme-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.strictEqual((APP.match(/class="meme meme-cell"/g) || []).length, 3, '三个小格应各有一张表情');
  assert.strictEqual((APP.match(/class="meme meme-hero"/g) || []).length, 1, '大格应有一张表情');

  // 与模板 gradeFromScore 同一套切点；全页里每张图出现几次 = 八维行数 + 综合卡格数
  const fromScore = s => {
    if (typeof s !== 'number' || !isFinite(s)) return 'none';
    if (s >= 3.5) return 'a';
    if (s >= 2.5) return 'b';
    if (s >= 1.5) return 'c';
    if (s >= 0.5) return 'd';
    return 'e';
  };
  const o = REPORT.overall;
  const want = { overall: 1, 'sticker-sleep': 1, 'sticker-meal': 1 };
  const bump = k => { want[k] = (want[k] || 0) + 1; };
  Object.keys(REPORT.dims).forEach(id => bump(GRADE_KEY(REPORT.dims[id].grade)));
  bump(o.total ? fromScore(o.covered / o.total * 4) : 'none');          // 已覆盖
  bump(o.pass_rate === null || o.pass_rate === undefined ? 'none' : fromScore(o.pass_rate / 100 * 4)); // 合格率
  bump(o.lowest && o.lowest.length ? GRADE_KEY(o.lowest[0].grade) : 'none'); // 最低维度格
  bump(o.lowest && o.lowest.length ? GRADE_KEY(o.lowest[0].grade) : 'none'); // 小结卡那张同等级表情

  for (const [k, n] of Object.entries(want)) {
    const hits = APP.split(memes[k]).length - 1;
    assert.strictEqual(hits, n, '表情 ' + k + ' 应出现 ' + n + ' 次，实际 ' + hits);
  }
});

test('report.html 体积仍在 1MB 以内', () => {
  assert.ok(HTML.length <= 1024 * 1024, '体积 ' + HTML.length);
});
