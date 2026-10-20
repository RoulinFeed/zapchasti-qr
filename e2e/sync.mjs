// Проверка синхронизации между двумя устройствами: node e2e/sync.mjs http://localhost:3100
// Запускать после smoke.mjs на той же базе: нужны склад W-001, Газель V-001, комбайн M-001 и болты B-000001.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE = process.argv[2] || 'http://localhost:3100';
const browser = await chromium.launch();

async function api(path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function device(login, pin) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU' });
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => {
    throw e;
  });
  await page.goto(BASE);
  await page.getByLabel('Логин').fill(login);
  await page.getByLabel('PIN-код').fill(pin);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.getByText('Что отсканировать?').waitFor();
  const offline = async (off) => {
    await context.setOffline(off);
    await page.evaluate((o) => window.dispatchEvent(new Event(o ? 'offline' : 'online')), off);
  };
  return { context, page, offline };
}

async function scan(page, code) {
  const field = page.locator('.scanfield input').first();
  await field.fill(code);
  await field.press('Enter');
}

// Остаток болтов по местам, как его видит устройство
async function bolts(page) {
  await page.goto(`${BASE}/#/scan?code=B-000001`);
  await page.getByText('Болт М10х40').first().waitFor();
  return page.locator('.main').innerText();
}

async function waitSynced(page) {
  await page.locator('.sync').getByText('На связи').waitFor({ timeout: 15000 });
  await page.getByText(/не отправлено/).waitFor({ state: 'detached', timeout: 15000 });
}

const { token } = await api('/api/login', { login: 'ruslan', pin: '1234' });
await api('/api/users', { login: 'ivan', name: 'Иван', role: 'mechanic', pin: '5555' }, token);

const A = await device('ruslan', '1234');
const B = await device('ivan', '5555');

// 1. Оба без связи. Руслан выдаёт 10 болтов со склада в Газель, Иван ставит 5 болтов из Газели на комбайн.
await A.offline(true);
await B.offline(true);

await A.page.goto(`${BASE}/#/move/transfer`);
await A.page.locator('.main select').first().selectOption({ label: 'Газель: Газель 1' });
await scan(A.page, 'B-000001');
await A.page.locator('.main select').filter({ has: A.page.locator('option[value="W-001"]') }).last().selectOption('W-001');
await A.page.locator('input.qty').fill('10');
await A.page.getByRole('button', { name: 'Провести' }).click();
await A.page.getByText('Проведено: 1').waitFor();

await B.page.goto(`${BASE}/#/move/install?to=M-001`);
await scan(B.page, 'B-000001');
await B.page.locator('.main select').filter({ has: B.page.locator('option[value="V-001"]') }).last().selectOption('V-001');
await B.page.locator('input.qty').fill('5');
await B.page.getByRole('button', { name: 'Провести' }).click();
await B.page.getByText('Проведено: 1').waitFor();
await B.page.getByText('не отправлено: 1').waitFor();

// 2. Связь появилась у обоих: операции уходят, каждое устройство получает чужую.
await B.offline(false);
await waitSynced(B.page);
await A.offline(false);
await waitSynced(A.page);
// Ивану чужая операция приходит при следующей синхронизации (по кнопке или раз в 30 секунд)
await B.page.locator('.sync').click();
await B.page.waitForTimeout(1500);

const ops = (await api('/api/sync', { since: 0, ops: [] }, token)).ops;
const fromA = ops.filter((o) => o.kind === 'move' && o.payload.qty === 10 && o.payload.type === 'transfer');
const fromB = ops.filter((o) => o.kind === 'move' && o.payload.qty === 5 && o.payload.type === 'install');
assert.equal(fromA.length, 1, 'перемещение Руслана на сервере ровно один раз');
assert.equal(fromB.length, 1, 'установка Ивана на сервере ровно один раз');
assert.equal(fromB[0].userName, 'Иван');

const a = await bolts(A.page);
const b = await bolts(B.page);
for (const text of [a, b]) {
  assert.match(text, /Основной склад[\s\S]*?55 шт/, 'на складе 65 − 10 = 55');
  assert.match(text, /Газель 1[\s\S]*?35 шт/, 'в Газели 30 + 10 − 5 = 35');
  assert.match(text, /Акрос 595 №7[\s\S]*?5 шт/, 'на комбайне 5');
}

// 3. Повторная отправка не задваивает: перезагрузка и ещё одна синхронизация.
await A.page.reload();
await A.page.locator('.sync').click();
await A.page.waitForTimeout(1000);
const again = (await api('/api/sync', { since: 0, ops: [] }, token)).ops;
assert.equal(again.length, ops.length, 'повторная синхронизация ничего не добавила');

// 4. Администратор меняет роль Ивана, пока тот в системе: после синхронизации у Ивана новая роль.
const ivan = (await api('/api/users', undefined, token)).users.find((u) => u.login === 'ivan');
await api('/api/users', { ...ivan, role: 'storekeeper' }, token);
await B.page.locator('.sync').click();
await B.page.goto(`${BASE}/#/`);
await B.page.getByText('Приход на склад').waitFor({ timeout: 10000 });

// 5. Удаление из архива доходит до другого устройства.
const item = again.find((o) => o.kind === 'item.upsert' && o.payload.name === 'Фильтр масляный');
await A.page.goto(`${BASE}/#/catalog?id=${item.payload.id}`);
await A.page.getByRole('button', { name: 'Удалить из архива' }).click();
await waitSynced(A.page);
await B.page.locator('.sync').click();
await B.page.waitForTimeout(1500);
await B.page.goto(`${BASE}/#/catalog`);
await B.page.getByLabel('Показать архив').check();
assert.equal(await B.page.getByText('Фильтр масляный').count(), 0, 'удалённая позиция пропала и у второго устройства');

await browser.close();
console.log('OK: синхронизация двух устройств работает');
