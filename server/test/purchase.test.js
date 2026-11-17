import test from 'node:test';
import assert from 'node:assert/strict';
import { buildState, validateOp } from '../../shared/state.js';
import {
  autoAllocate,
  guessColumns,
  lineStatus,
  matchOfferRow,
  parseMessage,
  parseNumber,
  parseStock,
  parseTable,
  priceTrend,
  purchaseCheck,
  purchaseOrders,
} from '../../shared/purchase.js';

let n = 0;
const op = (kind, payload) => ({ id: `op-${String(++n).padStart(6, '0')}`, kind, payload, createdAt: `2026-11-16T10:00:${String(n % 60).padStart(2, '0')}Z`, seq: n });

function base() {
  return [
    op('item.upsert', { id: 'it-bear', name: 'Подшипник 6205 2RS', sku: '0002157030' }),
    op('supplier.upsert', { id: 's-a', name: 'Агро А' }),
    op('supplier.upsert', { id: 's-b', name: 'Запчасть Б' }),
    op('purchase.upsert', { id: 'pu', title: 'К сезону' }),
    op('purchase.line', { purchaseId: 'pu', id: 'l1', itemId: 'it-bear', name: 'Подшипник 6205 2RS', qty: 10 }),
    op('purchase.line', { purchaseId: 'pu', id: 'l2', name: 'Ремень вариатора', sku: '644 455.0', qty: 2 }),
  ];
}

test('новый прайс поставщика заменяет прежний и хранит историю цен', () => {
  const ops = [
    ...base(),
    op('offer.list', { purchaseId: 'pu', supplierId: 's-a', full: true, source: 'excel', rows: [
      { lineId: 'l1', price: 1200, qty: 5 },
      { lineId: 'l2', price: 9000, qty: null },
    ] }),
    op('offer.list', { purchaseId: 'pu', supplierId: 's-a', full: true, source: 'excel', rows: [{ lineId: 'l1', price: 1100, qty: 5 }] }),
  ];
  const s = buildState(ops);
  const pu = s.purchases.pu;
  assert.equal(pu.offers.l1['s-a'].price, 1100);
  assert.deepEqual(priceTrend(pu.offers.l1['s-a']), { was: 1200, now: 1100, delta: -100 });
  // Ремня во втором прайсе нет: прежняя цена больше не действует, но видна в истории.
  assert.equal(pu.offers.l2['s-a'].withdrawn, true);
  assert.equal(pu.offers.l2['s-a'].history[0].price, 9000);
  assert.equal(pu.lists.length, 2);
});

test('сообщение по одной позиции не трогает остальные цены поставщика', () => {
  const ops = [
    ...base(),
    op('offer.list', { purchaseId: 'pu', supplierId: 's-a', full: true, rows: [
      { lineId: 'l1', price: 1200, qty: 5 },
      { lineId: 'l2', price: 9000 },
    ] }),
    op('offer.list', { purchaseId: 'pu', supplierId: 's-a', source: 'message', rows: [{ lineId: 'l1', price: 1150, qty: 5 }] }),
  ];
  const pu = buildState(ops).purchases.pu;
  assert.equal(pu.offers.l1['s-a'].price, 1150);
  assert.equal(pu.offers.l2['s-a'].withdrawn, false);
});

test('10 подшипников: 5 у одного, 5 у другого; закрыть можно только когда всё распределено', () => {
  const ops = [
    ...base(),
    op('offer.list', { purchaseId: 'pu', supplierId: 's-a', full: true, rows: [{ lineId: 'l1', price: 1000, qty: 5 }, { lineId: 'l2', price: 9500 }] }),
    op('offer.list', { purchaseId: 'pu', supplierId: 's-b', full: true, rows: [{ lineId: 'l1', price: 1300, qty: 20 }, { lineId: 'l2', price: 9000, qty: 1 }] }),
  ];
  let s = buildState(ops);
  let pu = s.purchases.pu;
  assert.equal(purchaseCheck(pu).ok, false);
  const plan = autoAllocate(pu);
  const allocOps = plan.map((c) => op('alloc.set', { purchaseId: 'pu', ...c }));
  s = buildState([...ops, ...allocOps]);
  pu = s.purchases.pu;
  const l1 = lineStatus(pu, pu.lines.l1);
  assert.equal(pu.alloc.l1['s-a'].qty, 5);
  assert.equal(pu.alloc.l1['s-b'].qty, 5);
  assert.equal(l1.remaining, 0);
  assert.equal(l1.sum, 5 * 1000 + 5 * 1300);
  // Ремень: дешевле у Б, но там только 1, второй берём у А.
  assert.equal(pu.alloc.l2['s-b'].qty, 1);
  assert.equal(pu.alloc.l2['s-a'].qty, 1);
  assert.equal(purchaseCheck(pu).ok, true);

  const orders = purchaseOrders(s, pu);
  assert.deepEqual(orders.map((o) => [o.supplier.name, o.rows.length, o.total]), [
    ['Агро А', 2, 5000 + 9500],
    ['Запчасть Б', 2, 6500 + 9000],
  ]);
});

test('перебор над наличием и снятая цена не дают оформить заказ', () => {
  const ops = [
    ...base(),
    op('purchase.line', { purchaseId: 'pu', id: 'l2', qty: 0 }),
    op('offer.list', { purchaseId: 'pu', supplierId: 's-a', full: true, rows: [{ lineId: 'l1', price: 1000, qty: 5 }] }),
    op('alloc.set', { purchaseId: 'pu', lineId: 'l1', supplierId: 's-a', qty: 10, price: 1000 }),
  ];
  let pu = buildState(ops).purchases.pu;
  assert.deepEqual(purchaseCheck(pu).problems.map((p) => p.kind), ['overstock']);
  ops.push(op('offer.list', { purchaseId: 'pu', supplierId: 's-a', full: true, rows: [] }));
  pu = buildState(ops).purchases.pu;
  assert.deepEqual(purchaseCheck(pu).problems.map((p) => p.kind), ['nooffer']);
});

test('изменение цены после распределения видно как предупреждение', () => {
  const ops = [
    ...base(),
    op('purchase.line', { purchaseId: 'pu', id: 'l2', deleted: true }),
    op('offer.list', { purchaseId: 'pu', supplierId: 's-a', rows: [{ lineId: 'l1', price: 1000 }] }),
    op('alloc.set', { purchaseId: 'pu', lineId: 'l1', supplierId: 's-a', qty: 10, price: 1000 }),
    op('offer.list', { purchaseId: 'pu', supplierId: 's-a', rows: [{ lineId: 'l1', price: 900 }] }),
  ];
  const c = purchaseCheck(buildState(ops).purchases.pu);
  assert.equal(c.ok, true);
  assert.deepEqual(c.warnings.map((w) => [w.kind, w.was, w.now]), [['price', 1000, 900]]);
  assert.equal(c.total, 9000);
});

test('сопоставление: запомненное, по артикулу, по похожему названию', () => {
  const ops = [...base(), op('map.set', { supplierId: 's-a', key: 'name:подш 6205 закр', itemId: 'it-bear' })];
  const s = buildState(ops);
  const pu = s.purchases.pu;
  assert.deepEqual(matchOfferRow(s, pu, 's-a', { name: 'Подш. 6205 закр.' }), { lineId: 'l1', how: 'map' });
  assert.deepEqual(matchOfferRow(s, pu, 's-b', { name: 'что-то', code: '2157030' }), { lineId: 'l1', how: 'code' });
  assert.deepEqual(matchOfferRow(s, pu, 's-b', { name: 'x', code: '644-455.0' }), { lineId: 'l2', how: 'code' });
  assert.equal(matchOfferRow(s, pu, 's-b', { name: 'Ремень вариатора Lexion' }).lineId, 'l2');
  assert.equal(matchOfferRow(s, pu, 's-b', { name: 'Фильтр масляный' }).lineId, null);
  // Строка не из каталога: запоминается по названию строки.
  const s2 = buildState([...ops, op('map.set', { supplierId: 's-b', key: 'code:ZX1', lineName: 'Ремень вариатора' })]);
  assert.deepEqual(matchOfferRow(s2, s2.purchases.pu, 's-b', { name: 'Belt', code: 'zx-1' }), { lineId: 'l2', how: 'map' });
});

test('числа из прайсов и сообщений', () => {
  assert.equal(parseNumber('1 200,50 руб.'), 1200.5);
  assert.equal(parseNumber('1.200,50'), 1200.5);
  assert.equal(parseNumber('1,200.50'), 1200.5);
  assert.equal(parseNumber(950), 950);
  assert.equal(parseNumber('договорная'), null);
  assert.equal(parseStock('нет'), 0);
  assert.equal(parseStock('>10'), 10);
  assert.equal(parseStock('5 шт'), 5);
  assert.equal(parseStock(''), null);
  assert.deepEqual(parseMessage('Подшипник 6205 есть 5 шт по 1 150 р, отгрузка завтра'), { price: 1150, qty: 5 });
  assert.deepEqual(parseMessage('6205 — 1150₽'), { price: 1150, qty: null });
});

test('таблица прайса: строка заголовков и колонки угадываются', () => {
  const rows = [
    ['ООО «Агро А»', null, null, null],
    ['Прайс от 15.11.2026', null, null, null],
    ['№', 'Код', 'Наименование', 'Кол-во', 'Цена, руб'],
    [1, '0002157030', 'Подшипник 6205', 5, 1200],
  ];
  assert.deepEqual(guessColumns(rows), { headerRow: 2, map: { name: '2', code: '1', price: '4', qty: '3' } });
  const pasted = parseTable('Подшипник 6205    5 шт    1 200,00\nРемень 644455    2    9 000,00');
  assert.deepEqual(pasted[0], ['Подшипник 6205', '5 шт', '1 200,00']);
  assert.equal(guessColumns(pasted).map.price, '2');
  assert.equal(guessColumns(pasted).map.name, '0');
});

test('проверка формы операций закупки', () => {
  assert.equal(validateOp(op('offer.list', { purchaseId: 'pu', supplierId: 's', rows: [{ lineId: 'l', price: -1 }] })), 'цена должна быть числом не меньше нуля');
  assert.equal(validateOp(op('offer.list', { purchaseId: 'pu', supplierId: 's', rows: [{ price: 1 }] })), 'строка прайса не сопоставлена с заявкой');
  assert.equal(validateOp(op('alloc.set', { purchaseId: 'pu', lineId: 'l', supplierId: 's', qty: 3 })), null);
  assert.equal(validateOp(op('purchase.upsert', { id: 'pu', status: 'xxx' })), 'неизвестное состояние заявки: xxx');
});

test('закупку ведут кладовщик и руководители, механик не может', async () => {
  const { canWrite } = await import('../src/auth.js');
  for (const kind of ['purchase.upsert', 'offer.list', 'alloc.set']) {
    assert.equal(canWrite('owner', kind), true);
    assert.equal(canWrite('storekeeper', kind), true);
    assert.equal(canWrite('mechanic', kind), false);
  }
});
