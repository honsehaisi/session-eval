// src/zframes.js 口径自测：多帧 zstd 必须逐帧解（2026-11-12 踩过「只解第一帧」的大坑）
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const { frameOffsets, decompressAll } = require('../src/zframes.js');

const z = (s) => zlib.zstdCompressSync(Buffer.from(s, 'utf8'));

test('两帧拼接：按魔数切成 2 段', () => {
  const a = z('hello ');
  const b = z('world');
  const buf = Buffer.concat([a, b]);
  const offs = frameOffsets(buf);
  assert.equal(offs.length, 2);
  assert.equal(offs[0], 0);
  assert.equal(offs[1], a.length);
});

test('两帧拼接：解压还原全文（不是只解第一帧）', () => {
  const a = z('hello ');
  const b = z('world');
  const buf = Buffer.concat([a, b]);
  assert.equal(decompressAll(buf).toString('utf8'), 'hello world');
});

test('三帧拼接：顺序不乱', () => {
  const buf = Buffer.concat([z('a'), z('b'), z('c')]);
  assert.equal(decompressAll(buf).toString('utf8'), 'abc');
});

test('单帧照常能解', () => {
  assert.equal(decompressAll(z('single')).toString('utf8'), 'single');
});

test('没有魔数直接抛错，不返回空', () => {
  assert.throws(() => decompressAll(Buffer.from('not a zstd frame')), /no zstd frame/);
});
