import Dexie from 'dexie';

// Локальная база в телефоне/браузере: журнал операций и настройки.
export const db = new Dexie('zapchasti');
db.version(1).stores({
  ops: 'id, seq, pending', // pending: 1 — ещё не отправлена на сервер
  meta: 'key',
  rejected: 'id',
});

export async function getMeta(key, fallback = null) {
  const row = await db.meta.get(key);
  return row ? row.value : fallback;
}

export function setMeta(key, value) {
  return db.meta.put({ key, value });
}
