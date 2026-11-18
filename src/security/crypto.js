// 内部资料加密原语：scrypt 派生 + AES-256-GCM。
// 设计约束：
//   1. 密码只从调用方传入，本模块不读任何文件/环境变量，不缓存密码。
//   2. 加密结果自带随机 salt / iv；同一明文每次密文不同。
//   3. 解密失败（密码错/被篡改）直接抛错，不做任何“回退到明文”的兜底。
'use strict';
const crypto = require('crypto');

const CIPHER = 'aes-256-gcm';
const KEY_LEN = 32;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
// N=32768, r=8, p=1：约 33MB 内存，普通机器 0.1s 级；32 位随机密码下离线爆破不可行。
const KDF = { algo: 'scrypt', N: 32768, r: 8, p: 1 };

function derive(password, salt) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('[crypto] 密码不能为空');
  }
  return crypto.scryptSync(Buffer.from(password, 'utf8'), salt, KEY_LEN, {
    N: KDF.N,
    r: KDF.r,
    p: KDF.p,
    maxmem: 64 * 1024 * 1024,
  });
}

function encrypt(password, plaintext) {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = derive(password, salt);
  const cipher = crypto.createCipheriv(CIPHER, key, iv, { authTagLength: TAG_LEN });
  const body = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(String(plaintext), 'utf8');
  const data = Buffer.concat([cipher.update(body), cipher.final()]);
  return {
    format: 'fish-vault/v1',
    kdf: Object.assign({}, KDF, { salt: salt.toString('base64') }),
    cipher: CIPHER,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

function decrypt(password, payload) {
  if (!payload || payload.format !== 'fish-vault/v1') {
    throw new Error('[crypto] 不是 fish-vault/v1 密文');
  }
  if (!payload.kdf || typeof payload.kdf.salt !== 'string') {
    throw new Error('[crypto] 密文缺少 KDF salt');
  }
  const salt = Buffer.from(payload.kdf.salt, 'base64');
  const iv = Buffer.from(payload.iv || '', 'base64');
  const tag = Buffer.from(payload.tag || '', 'base64');
  if (salt.length !== SALT_LEN || iv.length !== IV_LEN || tag.length !== TAG_LEN) {
    throw new Error('[crypto] 密文头长度不对，文件可能损坏');
  }
  const key = derive(password, salt);
  const decipher = crypto.createDecipheriv(CIPHER, key, iv, { authTagLength: TAG_LEN });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(payload.data || '', 'base64')), decipher.final()]);
}

module.exports = { encrypt, decrypt, KDF, CIPHER, SALT_LEN, IV_LEN, TAG_LEN };
