// 数据源层：core 只从这里拿「标准事件」，不再自己找文件、解压、认 DSH 记录类型。
// 换数据源 = 在 adapters/ 里加一个适配器 + config.json 里改 dataSource。
'use strict';
const { P } = require('./config.js');
const ADAPTERS = {
  dsh: require('./adapters/dsh.js'),
  generic: require('./adapters/generic.js'),   // 通用 JSONL：字段名在 config.generic 里配
};

function sourceName() {
  return P.dataSource || 'dsh';
}

function adapter() {
  const name = sourceName();
  const a = ADAPTERS[name];
  if (!a) throw new Error('未知数据源 "' + name + '"：目前支持 ' + Object.keys(ADAPTERS).join(' / '));
  return a;
}

function sourceGlob() {
  const a = adapter();
  return a.sourceGlob ? a.sourceGlob() : '**/*';
}

function load(opts) {
  const a = adapter();
  const sessions = a.listSessions(P.sessionsDir, opts);
  const ok = sessions.filter(s => !s.err).length;
  return {
    source: sourceName(),
    dir: P.sessionsDir,
    sessions,
    sessions_ok: ok,
    sessions_failed: sessions.length - ok,
  };
}

const cache = new Map();
// 同一个进程里只读一次盘（脚本都是单进程跑；run-all 是分开的子进程）
function loadCached(opts) {
  const withRecords = !!(opts && opts.withRecords);
  const key = sourceName() + '|' + P.sessionsDir + '|' + (withRecords ? 'recs' : 'events');
  if (!cache.has(key)) cache.set(key, load({ withRecords }));
  return cache.get(key);
}

module.exports = { load, loadCached, ADAPTERS, sourceName, sourceGlob };
