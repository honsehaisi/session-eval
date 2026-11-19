// 记忆题库：生成与自检
// 用法：
//   node src/memory/gen.js --validate          校验 questions.json（答案逐字可查 / hash / 防泄漏）
//   node src/memory/gen.js --merge _work/a.json _work/b.json   合并草稿并排序落 questions.json
// 口径：docs/计划书.md §7.2.2（schema）、§7.2.3（六条过滤）、§7.2.9（hash 失效）、§7.2.11（验收）

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '../../');
const MEM = require('../config.js').P.memoryDir;
const QFILE = path.join(HERE, 'questions.json');

function readPage(rel) {
  const p = path.join(MEM, rel);
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, 'utf8');
  const body = raw.replace(/^---[\s\S]*?---\n?/, '');
  const normBody = body.replace(/\r\n/g, '\n');
  return { raw, body, normBody, hash: crypto.createHash('sha256').update(normBody).digest('hex').slice(0, 16) };
}

const norm = (s) => s.replace(/\s+/g, ' ').trim();

function loadInjectables() {
  const files = ['index.md', 'SOUL.md', 'MEMORY.md'].map((f) => path.join(MEM, f));
  return files.filter((f) => fs.existsSync(f)).map((f) => ({ f: path.basename(f), text: norm(fs.readFileSync(f, 'utf8')) }));
}

function validate(qs) {
  const injectables = loadInjectables();
  const problems = [];
  const stats = { total: qs.length, byType: {}, stale: 0 };

  for (const q of qs) {
    for (const t of ['id', 'type', 'prompt', 'key_facts', 'source']) {
      if (!q[t]) problems.push(`${q.id || '<无id>'}: 缺字段 ${t}`);
    }
    stats.byType[q.type] = (stats.byType[q.type] || 0) + 1;
    if (q.stale) stats.stale++;

    // 1) key_facts 必须能在源页正文逐字找到（log 题看 log.md）
    const pages = (q.source && q.source.pages) || [];
    let srcText = '';
    for (const p of pages) {
      if (p === 'log.md') {
        srcText += '\n' + norm(fs.readFileSync(path.join(MEM, 'log.md'), 'utf8'));
      } else {
        const pg = readPage(p);
        if (!pg) { problems.push(`${q.id}: 源页不存在 ${p}`); continue; }
        srcText += '\n' + norm(pg.body);
        if (q.source.hash && q.type !== 'H' && q.type !== 'F' && pg.hash !== q.source.hash) {
          problems.push(`${q.id}: hash 不符（题库 ${q.source.hash}，现 ${pg.hash}）→ 应标 stale`);
        }
      }
    }
    // H 题的 key_facts 是「应否认的假事实」，不要求出现；F 题要求「已作废」语义，也不强制逐字
    if (!['H', 'F'].includes(q.type)) {
      for (const kf of q.key_facts) {
        if (!srcText.includes(norm(kf))) problems.push(`${q.id}: key_fact 在源页找不到「${kf}」`);
      }
    }

    // 2) 防泄漏：答案不许出现在开机注入的三份文件里
    for (const { f, text } of injectables) {
      for (const kf of q.key_facts) {
        if (kf.length >= 4 && text.includes(norm(kf))) problems.push(`${q.id}: key_fact 泄漏在 ${f}：「${kf}」`);
      }
    }

    // 3) 泄漏：题面里直接出现答案（key_fact 长度 >4 且被题面包含）
    for (const kf of q.key_facts) {
      if (kf.length >= 6 && q.prompt.includes(kf)) problems.push(`${q.id}: 题面含答案「${kf}」`);
    }

    // 4) H/F 必须有 forbidden
    if (['H', 'F'].includes(q.type) && (!q.forbidden || !q.forbidden.length)) {
      problems.push(`${q.id}: ${q.type} 题缺 forbidden`);
    }
  }

  // 5) 配额（§7.2.4）
  const quota = { R1: 12, R2: 10, R3: 5, R4: 3, H: 30, F: 30 };
  const quotaProblems = Object.entries(quota)
    .filter(([t, n]) => (stats.byType[t] || 0) !== n)
    .map(([t, n]) => `配额 ${t}: 应 ${n}，实际 ${stats.byType[t] || 0}`);

  return { problems, quotaProblems, stats };
}

/* ---------- 2026-11-17：造题草稿（--auto） ----------
   目的：记忆题库必须来自「被考者自己的记忆库」，不能发我的 55 题。
   本函数只产草稿（_work/candidates.json），不落 questions.json：
   R 题从分类页正文抽原子事实；H 题由真实事实派生假事实；F 题从 log/decisions 抽旧值。
   每题都要人工/AI 抽检，题面草稿必须重写。 */
const AUTO_DIRS = ['identity', 'user', 'skills', 'decisions', 'projects', 'rules', 'concepts'];
const FACT_BLACKLIST = new Set(['true', 'false', 'node', 'http', 'https', 'json', 'null', 'undefined', 'readme', 'github.com']);
const FACT_RES = [
  { re: /`([^`\n]{3,40})`/g, kind: 'code' },
  { re: /(\d+(?:\.\d+)?\s?(?:MB|GB|KB|ms|秒|分钟|小时|天|%|字\/秒|LUFS))/g, kind: 'num' },
  { re: /(\d{4}-\d{2}-\d{2})/g, kind: 'date' },
];

function isSecretPage(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    return !!(m && /^secret:\s*true\s*$/m.test(m[1]));
  } catch (e) { return false; }
}

function walkPages(dir, out) {
  out = out || [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkPages(p, out);
    else if (ent.name.endsWith('.md') && !isSecretPage(p)) out.push(p);
  }
  return out;
}

function readFm(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const body = m ? raw.slice(m[0].length) : raw;
  const get = (k) => {
    const x = m && m[1].match(new RegExp('^' + k + ':\\s*(.+)$', 'm'));
    return x ? x[1].trim() : '';
  };
  return { title: get('title'), salience: Number(get('salience') || 0), summary: get('summary'), body };
}

function autoGenerate() {
  const dirs = AUTO_DIRS.map((d) => path.join(MEM, d));
  const pages = dirs.flatMap((d) => walkPages(d));
  const injectables = loadInjectables().map((x) => x.text).join('\n');
  const warnings = [];
  const R = [];

  for (const file of pages) {
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { continue; }
    const meta = readFm(raw);
    if (meta.salience && meta.salience < 2) continue; // 六条过滤①：只从 salience ≥ 2 的分类页出
    const rel = path.relative(MEM, file).replace(/\\/g, '/');
    const lines = meta.body.split(/\r?\n/);
    let perPage = 0;
    for (let i = 0; i < lines.length && perPage < 3; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#')) continue;
      for (const { re, kind } of FACT_RES) {
        re.lastIndex = 0;
        const m = re.exec(line);
        if (!m) continue;
        const fact = m[1].trim();
        if (fact.length < 3 || FACT_BLACKLIST.has(fact.toLowerCase())) continue;
        if (meta.title.includes(fact) || meta.summary.includes(fact)) continue; // 过滤②：不在标题/summary
        if (injectables.includes(fact) && fact.length >= 4) continue;          // 过滤③：不在开机注入的三份文件
        const ctx = line.replace(fact, ' ').replace(/[|`*#>\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
        R.push({
          page: rel,
          line: i + 1,
          kind,
          key_facts: [fact],
          context: ctx.slice(0, 60),
          prompt_draft: ctx ? '《' + (meta.title || rel) + '》里，' + ctx.slice(0, 40) + ' 是什么？' : '',
          needs_review: true,
        });
        perPage++;
        if (perPage >= 3) break;
      }
    }
  }

  // H 题：拿真实事实派生假事实（数字 +1 / 字母换一个），校验假事实全库不出现
  const allText = pages.map((p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } }).join('\n') + injectables;
  const H = [];
  for (const c of R) {
    if (H.length >= 15) break;
    const f = c.key_facts[0];
    const fake = f.replace(/\d/, (d) => String((Number(d) + 1) % 10));
    if (fake === f) continue;
    if (allText.includes(fake)) continue; // 假事实必须真的不存在
    H.push({
      type: 'H',
      page: c.page,
      key_facts: ['不存在这条：' + fake],
      forbidden: [fake],
      prompt_draft: '《' + (c.context || c.page) + '》里出现过「' + fake + '」这个说法吗？',
      needs_review: true,
    });
  }

  // F 题：从 log.md / decisions 抽「已作废」的旧值
  const F = [];
  const logPath = path.join(MEM, 'log.md');
  const logLines = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').split(/\r?\n/) : [];
  for (const line of logLines) {
    if (F.length >= 10) break;
    if (!/(作废|废止|已废|不再用|废弃|改成|改为)/.test(line)) continue;
    const m = line.match(/`([^`\n]{2,30})`|(\d+(?:\.\d+)?\s?(?:MB|GB|%|秒|天))/);
    if (!m) continue;
    const old = (m[1] || m[2] || '').trim();
    if (!old || old.length < 2) continue;
    if (!allText.includes(old)) continue;
    F.push({
      type: 'F',
      key_facts: ['该旧口径已作废，不应复述「' + old + '」'],
      forbidden: [old],
      prompt_draft: '现在还在按「' + old + '」这条口径算吗？',
      needs_review: true,
    });
  }

  const quota = { R1: 12, R2: 10, R3: 5, R4: 3, H: 30, F: 30 };
  const out = path.resolve(ROOT, '_work/candidates.json');
  const doc = {
    generatedAt: new Date().toISOString(),
    memoryDir: MEM,
    stats: { pages: pages.length, R: R.length, H: H.length, F: F.length },
    quota,
    warnings: [],
    candidates: [...R.map((x) => ({ type: 'R?', ...x })), ...H, ...F],
  };
  if (R.length < 30) doc.warnings.push('R 题只抽到 ' + R.length + ' 条（目标 30）：页面太少或 salience<2，别凑数，记忆维度应标「未覆盖」');
  if (F.length < 10) doc.warnings.push('F 题只抽到 ' + F.length + ' 条（目标 10）：log.md 里没有足够的「已作废」记录');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(doc, null, 2), 'utf8');
  console.log('pages=' + pages.length + ' R=' + R.length + ' H=' + H.length + ' F=' + F.length + ' → ' + out);
  for (const w of doc.warnings) console.log('! ' + w);
  console.log('下一步：人工/AI 抽检并重写 prompt_draft，再 gen.js --validate / --merge');
}

function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--auto') { autoGenerate(); return; }
  if (argv[0] === '--merge') {
    const all = argv.slice(1).flatMap((f) => JSON.parse(fs.readFileSync(path.resolve(ROOT, f), 'utf8')));
    const order = { R1: 0, R2: 1, R3: 2, R4: 3, H: 4, F: 5 };
    all.sort((a, b) => (order[a.type] - order[b.type]) || String(a.id).localeCompare(String(b.id)));
    fs.writeFileSync(QFILE, JSON.stringify(all, null, 2), 'utf8');
    console.log(`merged ${all.length} → ${QFILE}`);
    return;
  }
  const qs = JSON.parse(fs.readFileSync(QFILE, 'utf8'));
  const { problems, quotaProblems, stats } = validate(qs);
  console.log(JSON.stringify({ stats, quotaProblems, problemCount: problems.length, problems: problems.slice(0, 40) }, null, 2));
  process.exitCode = problems.length || quotaProblems.length ? 1 : 0;
}

main();
