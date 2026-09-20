// scrypt 密码哈希：格式 scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>
import crypto from 'node:crypto';
import { config } from '../config.js';

export function hashPassword(password) {
  const { N, r, p, keylen } = config.password.scrypt;
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, keylen, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, N, r, p, saltHex, hashHex] = parts;
    const hash = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'),
      hashHex.length / 2, { N: +N, r: +r, p: +p });
    return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
  } catch {
    return false;
  }
}

export function isWeakPassword(password) {
  return typeof password !== 'string' || password.length < config.password.minLength;
}
