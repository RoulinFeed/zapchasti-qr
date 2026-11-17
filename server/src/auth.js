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
// Удалять в закупке могут только администратор и руководитель.
const PURCHASE_ADMIN = ['purchase.delete', 'offer.void', 'supplier.delete'];
const PURCHASE = ['supplier.upsert', 'purchase.upsert', 'purchase.line', 'offer.list', 'alloc.set', 'map.set'];

const ALLOWED = {
  owner: [
    'item.upsert',
    'location.upsert',
    'unit.bind',
    'move',
    'issue.resolve',
    'move.void',
    'item.delete',
    'location.delete',
    ...PURCHASE,
    ...PURCHASE_ADMIN,
  ],
  admin: ['item.upsert', 'location.upsert', 'unit.bind', 'move', 'issue.resolve', ...PURCHASE, ...PURCHASE_ADMIN],
  storekeeper: ['item.upsert', 'location.upsert', 'unit.bind', 'move', 'issue.resolve', ...PURCHASE],
  mechanic: ['move'],
};

export const ROLES = ['owner', 'admin', 'storekeeper', 'mechanic'];

export function isAdmin(role) {
  return role === 'owner' || role === 'admin';
}

export function canWrite(role, kind) {
  return (ALLOWED[role] || []).includes(kind);
}
