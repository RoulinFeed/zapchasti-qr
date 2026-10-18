import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPin(pin) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(pin), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function checkPin(pin, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = scryptSync(String(pin), salt, 32);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function newToken() {
  return randomBytes(32).toString('hex');
}

// Кто какие операции может записывать
const ALLOWED = {
  admin: ['item.upsert', 'location.upsert', 'unit.bind', 'move'],
  storekeeper: ['item.upsert', 'location.upsert', 'unit.bind', 'move'],
  mechanic: ['move'],
};

export function canWrite(role, kind) {
  return (ALLOWED[role] || []).includes(kind);
}
