// 多帧 zstd 读取器：session.v4.jsonl.zstd 是「每追加一次写一帧」的可续写文件，
// Node 的 zstdDecompressSync 只解第一帧，所以必须按魔数切帧逐帧解。
const fs = require('fs'), z = require('zlib');
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function frameOffsets(buf) {
  const offs = [];
  let i = 0;
  while (true) {
    const j = buf.indexOf(MAGIC, i);
    if (j < 0) break;
    offs.push(j);
    i = j + 4;
  }
  return offs;
}

function decompressAll(buf) {
  const offs = frameOffsets(buf);
  if (!offs.length) throw new Error('no zstd frame');
  if (offs[0] !== 0) offs.unshift(0);
  const parts = [];
  let cur = offs[0];
  for (let k = 1; k <= offs.length; k++) {
    const end = k < offs.length ? offs[k] : buf.length;
    try {
      parts.push(z.zstdDecompressSync(buf.slice(cur, end)));
      cur = end;
    } catch (e) {
      // 魔数撞在载荷里：把这段并进下一帧一起再试
      if (k === offs.length) throw e;
    }
  }
  return Buffer.concat(parts);
}

function loadSessions(base) {
  const out = [];
  for (const d of fs.readdirSync(base)) {
    const sd = base + '/' + d;
    let st; try { st = fs.statSync(sd); } catch (e) { continue; }
    if (!st.isDirectory()) continue;
    for (const s of fs.readdirSync(sd)) {
      const f = sd + '/' + s + '/session.v4.jsonl.zstd';
      if (!fs.existsSync(f)) continue;
      let raw;
      try { raw = decompressAll(fs.readFileSync(f)).toString('utf8'); }
      catch (e) { out.push({ f, err: e.message }); continue; }
      out.push({ f, raw });
    }
  }
  return out;
}

module.exports = { decompressAll, loadSessions, frameOffsets };
