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
  assert.equal(r.user.role, 'owner');
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

test('нестыковки и затраты считаются из журнала', async () => {
  const { buildState: build, openIssues, installCosts, stockValue } = await import('../../shared/state.js');
  let seq = 0;
  const o = (kind, payload, userName = 'Иван') => ({ ...op(kind, payload), seq: ++seq, userName });
  const ops = [
    o('item.upsert', { id: 'a', name: 'Ремень', tracking: 'piece', price: 12000 }),
    o('item.upsert', { id: 'b', name: 'Болт', tracking: 'batch', price: 10 }),
    o('location.upsert', { code: 'W-1', kind: 'warehouse', name: 'Склад' }),
    o('location.upsert', { code: 'V-1', kind: 'van', name: 'Газель 1' }),
    o('location.upsert', { code: 'V-2', kind: 'van', name: 'Газель 2' }),
    o('location.upsert', { code: 'M-1', kind: 'machine', name: 'Лексион 7' }),
    o('unit.bind', { code: 'P-1', itemId: 'a' }),
    o('unit.bind', { code: 'B-1', itemId: 'b' }),
    o('move', { type: 'receipt', unit: 'P-1', qty: 1, to: 'W-1' }),
    o('move', { type: 'receipt', unit: 'B-1', qty: 100, to: 'W-1' }),
    o('move', { type: 'transfer', unit: 'P-1', qty: 1, from: 'W-1', to: 'V-1' }),
    // без связи: оба механика «берут» один ремень, и болтов берут больше, чем есть
    o('move', { type: 'install', unit: 'P-1', qty: 1, from: 'V-1', to: 'M-1', price: 11500 }),
    o('move', { type: 'transfer', unit: 'P-1', qty: 1, from: 'V-1', to: 'V-2' }, 'Пётр'),
    o('move', { type: 'transfer', unit: 'B-1', qty: 150, from: 'W-1', to: 'V-2' }, 'Пётр'),
    o('move', { type: 'install', unit: 'B-1', qty: 8, from: 'V-2', to: 'M-1' }, 'Пётр'),
  ];
  const state = build(ops);
  const kinds = openIssues(state).map((i) => `${i.unit}:${i.kind}`);
  assert.deepEqual(kinds, ['P-1:short', 'P-1:twice', 'B-1:short']);

  const costs = installCosts(state);
  // ремень по зафиксированной цене 11500, болты по каталогу 8 × 10
  assert.equal(costs.total, 11580);
  assert.equal(costs.byMachine[0].count, 2);
  assert.deepEqual(costs.byPerson.map((p) => [p.name, p.sum]), [['Иван', 11500], ['Пётр', 80]]);
  // запас: в Газели 2 ремень (числится по ошибке) и 142 болта
  assert.equal(stockValue(state).byKind.van, 12000 + 142 * 10);

  const resolved = build([...ops, o('issue.resolve', { moveId: openIssues(state)[0].moveId, note: 'ремень на комбайне' })]);
  // разбор относится ко всей операции, поэтому уходят оба замечания по ремню
  assert.deepEqual(openIssues(resolved).map((i) => i.unit), ['B-1']);
});

test('главный: исправляет и отменяет операции, остальные не могут', async () => {
  const { token } = await login('ruslan', '1234');
  await call(token, 'POST', '/api/users', { login: 'boss2', name: 'Зам', role: 'admin', pin: '7777' });
  const admin = await login('boss2', '7777');

  // руководитель не может назначить главного и изменить главного
  assert.equal((await call(admin.token, 'POST', '/api/users', { login: 'x1', name: 'x', role: 'owner', pin: '1111' })).statusCode, 403);
  const me = (await call(token, 'GET', '/api/me')).json().user;
  assert.equal((await call(admin.token, 'POST', '/api/users', { id: me.id, login: 'ruslan', name: 'Р', role: 'admin' })).statusCode, 403);
  // главный не может разжаловать сам себя
  assert.equal((await call(token, 'POST', '/api/users', { id: me.id, login: 'ruslan', name: 'Р', role: 'admin' })).statusCode, 400);

  const wrong = op('move', { type: 'transfer', unit: 'P-000001', qty: 1, from: 'V-001', to: 'W-001' });
  await call(token, 'POST', '/api/sync', { ops: [wrong] });
  const voidOp = op('move.void', { moveId: wrong.id, reason: 'ошиблись складом' });
  const byAdmin = (await call(admin.token, 'POST', '/api/sync', { ops: [voidOp] })).json();
  assert.equal(byAdmin.results[0].status, 'rejected');
  const noReason = (await call(token, 'POST', '/api/sync', { ops: [op('move.void', { moveId: wrong.id })] })).json();
  assert.equal(noReason.results[0].status, 'rejected');

  const before = buildState((await call(token, 'POST', '/api/sync', { since: 0 })).json().ops);
  const res = (await call(token, 'POST', '/api/sync', { ops: [voidOp], since: 0 })).json();
  assert.equal(res.results[0].status, 'ok');
  const after = buildState(res.ops);
  // отменённое перемещение больше не влияет на остатки, но видно в истории
  assert.ok(before.stock['P-000001']['W-001'] > 0);
  assert.equal(after.stock['P-000001']['W-001'] ?? 0, 0);
  const m = after.moves.find((x) => x.id === wrong.id);
  assert.equal(m.voided.reason, 'ошиблись складом');
});

test('первый руководитель старой базы становится главным', async () => {
  await pool.query("update users set role = 'admin' where role = 'owner'");
  await migrate(pool);
  const { rows } = await pool.query("select login from users where role = 'owner'");
  assert.deepEqual(rows.map((r) => r.login), ['ruslan']);
});
