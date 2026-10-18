import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { buildApp, ensureAdmin, migrate } from '../src/app.js';
import { buildState, locationContents, itemTotals } from '../../shared/state.js';

const pool = new pg.Pool({
  connectionString: process.env.TEST_DATABASE_URL || 'postgres://app:app@localhost:5432/zapchasti_test',
});
let app;

before(async () => {
  await pool.query('drop table if exists sessions, ops, label_counters, users cascade');
  await migrate(pool);
  await ensureAdmin(pool, { login: 'ruslan', name: 'Руслан', pin: '1234' });
  app = buildApp({ pool });
});

after(async () => {
  await app.close();
  await pool.end();
});

async function login(l, pin) {
  const res = await app.inject({ method: 'POST', url: '/api/login', payload: { login: l, pin } });
  return res.json();
}

function call(token, method, url, payload) {
  return app.inject({ method, url, payload, headers: { authorization: `Bearer ${token}` } });
}

const op = (kind, payload, extra = {}) => ({
  id: crypto.randomUUID(),
  kind,
  payload,
  createdAt: new Date().toISOString(),
  ...extra,
});

test('вход: неверный PIN отклоняется, верный даёт токен', async () => {
  assert.equal((await app.inject({ method: 'POST', url: '/api/login', payload: { login: 'ruslan', pin: '0000' } })).statusCode, 401);
  const r = await login('Ruslan', '1234');
  assert.ok(r.token);
  assert.equal(r.user.role, 'admin');
  assert.equal((await call('bad', 'GET', '/api/me')).statusCode, 401);
});

test('полный сценарий: приход, Газель, установка на комбайн, снятие', async () => {
  const { token } = await login('ruslan', '1234');

  const codes = (await call(token, 'POST', '/api/labels', { prefix: 'P', count: 2 })).json().codes;
  assert.deepEqual(codes, ['P-000001', 'P-000002']);
  const more = (await call(token, 'POST', '/api/labels', { prefix: 'P', count: 1 })).json().codes;
  assert.deepEqual(more, ['P-000003']);

  const ops = [
    op('item.upsert', { id: 'i1', name: 'Подшипник 6205', tracking: 'piece', minQty: 3 }),
    op('item.upsert', { id: 'i2', name: 'Болт М10', tracking: 'batch' }),
    op('location.upsert', { code: 'W-001', kind: 'warehouse', name: 'Основной склад' }),
    op('location.upsert', { code: 'V-001', kind: 'van', name: 'Газель 1' }),
    op('location.upsert', { code: 'M-001', kind: 'machine', name: 'Акрос 595 №7' }),
    op('unit.bind', { code: 'P-000001', itemId: 'i1' }),
    op('unit.bind', { code: 'B-000001', itemId: 'i2' }),
    op('move', { type: 'receipt', unit: 'P-000001', qty: 1, to: 'W-001' }),
    op('move', { type: 'receipt', unit: 'B-000001', qty: 100, to: 'W-001' }),
    op('move', { type: 'transfer', unit: 'P-000001', qty: 1, from: 'W-001', to: 'V-001' }),
    op('move', { type: 'transfer', unit: 'B-000001', qty: 30, from: 'W-001', to: 'V-001' }),
    op('move', { type: 'install', unit: 'P-000001', qty: 1, from: 'V-001', to: 'M-001', hours: 1520 }),
  ];
  const res = (await call(token, 'POST', '/api/sync', { ops, since: 0 })).json();
  assert.ok(res.results.every((r) => r.status === 'ok'), JSON.stringify(res.results));
  assert.equal(res.ops.length, ops.length);

  // повторная отправка тех же операций ничего не дублирует
  const again = (await call(token, 'POST', '/api/sync', { ops, since: res.cursor })).json();
  assert.equal(again.ops.length, 0);

  const state = buildState(res.ops);
  assert.deepEqual(
    locationContents(state, 'W-001').map((r) => [r.unit, r.qty]),
    [['B-000001', 70]],
  );
  assert.deepEqual(
    locationContents(state, 'V-001').map((r) => [r.unit, r.qty]),
    [['B-000001', 30]],
  );
  assert.equal(locationContents(state, 'M-001')[0].item.name, 'Подшипник 6205');
  // установленный подшипник не считается запасом
  assert.equal(itemTotals(state).i1.total, 0);
  assert.equal(state.moves.at(-1).userName, 'Руслан');
});

test('механик: может ставить детали, но не может делать приход и править каталог', async () => {
  const { token } = await login('ruslan', '1234');
  const created = await call(token, 'POST', '/api/users', { login: 'ivan', name: 'Иван', role: 'mechanic', pin: '5555' });
  assert.equal(created.statusCode, 200);
  const dup = await call(token, 'POST', '/api/users', { login: 'ivan', name: 'Иван 2', role: 'mechanic', pin: '5555' });
  assert.equal(dup.statusCode, 409);

  const mech = await login('ivan', '5555');
  const ops = [
    op('move', { type: 'remove', unit: 'P-000001', qty: 1, from: 'M-001', to: 'V-001', condition: 'defect' }),
    op('move', { type: 'receipt', unit: 'P-000002', qty: 1, to: 'V-001' }),
    op('item.upsert', { id: 'i3', name: 'Ремень' }),
  ];
  const res = (await call(mech.token, 'POST', '/api/sync', { ops, since: 0 })).json();
  assert.deepEqual(res.results.map((r) => r.status), ['ok', 'rejected', 'rejected']);
  assert.equal((await call(mech.token, 'POST', '/api/labels', { prefix: 'P' })).statusCode, 403);
  assert.equal((await call(mech.token, 'POST', '/api/users', { login: 'x', name: 'x', role: 'admin', pin: '1111' })).statusCode, 403);

  const state = buildState(res.ops);
  assert.equal(state.units['P-000001'].condition, 'defect');

  // отключённый сотрудник теряет доступ сразу
  await call(token, 'POST', '/api/users', { id: created.json().user.id, login: 'ivan', name: 'Иван', role: 'mechanic', active: false });
  assert.equal((await call(mech.token, 'GET', '/api/me')).statusCode, 401);
});

test('неверные операции отклоняются с понятной ошибкой', async () => {
  const { token } = await login('ruslan', '1234');
  const res = (
    await call(token, 'POST', '/api/sync', {
      ops: [op('move', { type: 'transfer', unit: 'P-000001', qty: 0, from: 'W-001', to: 'V-001' }), { id: 'x' }],
    })
  ).json();
  assert.deepEqual(res.results.map((r) => r.status), ['rejected', 'rejected']);
  assert.match(res.results[0].error, /количество/);
});
