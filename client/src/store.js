import { useSyncExternalStore } from 'react';
import { db, getMeta, setMeta } from './db.js';
import { api, ApiError, setToken } from './api.js';
import { applyOp, buildState, validateOp } from '../../shared/state.js';

const SYNC_EVERY_MS = 30_000;

let snapshot = {
  ready: false,
  user: null,
  state: buildState([]),
  pending: 0,
  rejected: [],
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  syncing: false,
  lastSync: null,
  syncError: null,
  users: [],
};
const listeners = new Set();

function set(patch) {
  snapshot = { ...snapshot, ...patch };
  for (const l of listeners) l();
}

export function useStore(selector = (s) => s) {
  return selector(
    useSyncExternalStore(
      (l) => (listeners.add(l), () => listeners.delete(l)),
      () => snapshot,
    ),
  );
}

export function getStore() {
  return snapshot;
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function rebuild() {
  const ops = await db.ops.toArray();
  const pending = ops.filter((o) => o.pending === 1).length;
  set({ state: buildState(ops), pending, rejected: await db.rejected.toArray() });
}

export async function init() {
  const [token, user, lastSync, users] = await Promise.all([
    getMeta('token'),
    getMeta('user'),
    getMeta('lastSync'),
    getMeta('users', []),
  ]);
  setToken(token);
  await rebuild();
  set({ ready: true, user: token ? user : null, lastSync, users });
  // Просим браузер не удалять локальную базу при нехватке места.
  navigator.storage?.persist?.().catch(() => {});
  window.addEventListener('online', () => {
    set({ online: true });
    sync();
  });
  window.addEventListener('offline', () => set({ online: false }));
  setInterval(() => snapshot.user && sync(), SYNC_EVERY_MS);
  if (token) sync();
}

export async function login(loginName, pin) {
  const res = await api('/api/login', { login: loginName, pin });
  setToken(res.token);
  await setMeta('token', res.token);
  await setMeta('user', res.user);
  set({ user: res.user });
  await sync();
}

export async function logout() {
  if (snapshot.pending > 0) throw new Error('Есть неотправленные операции. Дождитесь связи и синхронизации.');
  try {
    await api('/api/logout', {});
  } catch {
    /* не важно */
  }
  setToken(null);
  await setMeta('token', null);
  await setMeta('user', null);
  set({ user: null });
}

// Записать операцию: сразу в локальную базу, на сервер уйдёт при синхронизации.
export async function record(kind, payload) {
  return recordMany([{ kind, payload }]);
}

export async function recordMany(list) {
  const now = new Date().toISOString();
  const ops = list.map(({ kind, payload }) => ({
    id: uid(),
    kind,
    payload,
    createdAt: now,
    userId: snapshot.user?.id,
    userName: snapshot.user?.name,
    pending: 1,
  }));
  for (const op of ops) {
    const err = validateOp(op);
    if (err) throw new Error(err);
  }
  await db.ops.bulkPut(ops);
  // Отмена меняет прошлое, поэтому состояние пересобираем целиком.
  if (ops.some((o) => o.kind === 'move.void')) {
    await rebuild();
    sync();
    return ops;
  }
  // Быстро применяем к текущему состоянию, без полной пересборки.
  const state = snapshot.state;
  for (const op of ops) applyOp(state, op);
  set({ state: { ...state }, pending: snapshot.pending + ops.length });
  sync();
  return ops;
}

let syncPromise = null;
export function sync() {
  if (!snapshot.user) return Promise.resolve();
  if (syncPromise) return syncPromise;
  syncPromise = doSync().finally(() => {
    syncPromise = null;
  });
  return syncPromise;
}

async function doSync() {
  set({ syncing: true });
  try {
    let hasMore = true;
    while (hasMore) {
      const pendingOps = await db.ops.where('pending').equals(1).toArray();
      const since = await getMeta('cursor', 0);
      const res = await api('/api/sync', {
        since,
        ops: pendingOps.map(({ id, kind, payload, createdAt }) => ({ id, kind, payload, createdAt })),
      });
      await db.transaction('rw', db.ops, db.meta, db.rejected, async () => {
        const rejected = res.results.filter((r) => r.status === 'rejected');
        for (const r of rejected) {
          const op = pendingOps.find((o) => o.id === r.id);
          await db.ops.delete(r.id);
          if (op) await db.rejected.put({ ...op, error: r.error });
        }
        if (res.ops.length) await db.ops.bulkPut(res.ops.map((o) => ({ ...o, pending: 0 })));
        await setMeta('cursor', res.cursor);
      });
      hasMore = res.hasMore;
    }
    const now = new Date().toISOString();
    await setMeta('lastSync', now);
    try {
      // Роль могли поменять, пока человек был в системе: берём её с сервера, а не с момента входа.
      const { user } = await api('/api/me');
      await setMeta('user', user);
      set({ user });
      const { users } = await api('/api/users');
      await setMeta('users', users);
      set({ users });
    } catch {
      /* список сотрудников не критичен */
    }
    await rebuild();
    set({ lastSync: now, syncError: null, online: true });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      setToken(null);
      await setMeta('token', null);
      set({ user: null, syncError: e.message });
    } else {
      set({ syncError: e.message, online: e instanceof ApiError && e.status === 0 ? false : snapshot.online });
    }
  } finally {
    set({ syncing: false });
  }
}

export async function dismissRejected(id) {
  await db.rejected.delete(id);
  set({ rejected: await db.rejected.toArray() });
}

// Удобные функции, которыми пользуются экраны
export function canManage(user) {
  return user && ['owner', 'admin', 'storekeeper'].includes(user.role);
}

export function isAdmin(user) {
  return user && (user.role === 'owner' || user.role === 'admin');
}

export function isOwner(user) {
  return user?.role === 'owner';
}

export async function allocateCodes(prefix, count = 1) {
  const { codes } = await api('/api/labels', { prefix, count });
  return codes;
}
