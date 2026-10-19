// Сквозная проверка в браузере: node e2e/smoke.mjs http://localhost:3100
// Нужен запущенный сервер с пустой базой и администратором ruslan / 1234, и установленный playwright.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE = process.argv[2] || 'http://localhost:3100';
const shots = process.env.SHOTS_DIR;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU' });
const page = await context.newPage();
page.on('dialog', (d) => d.accept());
page.on('pageerror', (e) => {
  throw e;
});
const shot = (name) => shots && page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
const go = (hash) => page.goto(`${BASE}/#/${hash}`);

async function scan(code) {
  const field = page.locator('.scanfield input').first();
  await field.fill(code);
  await field.press('Enter');
}

await page.goto(BASE);
await page.getByLabel('Логин').fill('ruslan');
await page.getByLabel('PIN-код').fill('1234');
await page.getByRole('button', { name: 'Войти' }).click();
await page.getByText('Что отсканировать?').waitFor();
await shot('01-home');

// Места: склад, Газель, комбайн
for (const [kind, name] of [
  ['warehouse', 'Основной склад'],
  ['van', 'Газель 1'],
  ['machine', 'Акрос 595 №7'],
]) {
  await go('locations?code=');
  await page.locator('.main select').first().selectOption(kind);
  await page.getByLabel('Название*').fill(name);
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await page.getByText(name).first().waitFor();
}
await shot('02-locations');

// Приход поштучной детали без этикетки: сервер выдаёт 2 кода
await go('receive');
await page.locator('.main select').first().selectOption({ label: 'Склад: Основной склад' });
await page.getByRole('button', { name: 'Нет этикетки — выдать новые коды' }).click();
await page.getByRole('button', { name: '+ Новая позиция' }).click();
await page.getByLabel('Название*').fill('Подшипник 6205');
await page.getByLabel('Артикул').fill('6205-2RS');
await page.getByRole('button', { name: 'Создать' }).click();
await page.getByLabel(/Количество/).fill('2');
await page.getByRole('button', { name: 'Оприходовать' }).click();
await page.getByText(/Оприходовано: Подшипник 6205/).waitFor();
await shot('03-receive');

// Цена закупки в каталоге
await go('catalog');
await page.getByText('Подшипник 6205').click();
await page.getByLabel('Цена закупки, ₽').fill('1 250,50');
await page.getByRole('button', { name: 'Сохранить' }).click();
await page.getByText(/запас 2 шт/).waitFor();

// Приход партии болтов по готовой этикетке B-000001 (печатали впрок)
await go('labels');
await page.locator('.main select').filter({ hasText: 'Поштучный' }).selectOption('B');
await page.evaluate(() => (window.print = () => {}));
await page.getByLabel('Сколько штук').fill('1');
await page.getByRole('button', { name: 'Выдать коды и напечатать' }).click();
await page.getByText(/Выданы коды B-000001/).waitFor();

await go('receive');
await scan('B-000001');
await page.getByRole('button', { name: '+ Новая позиция' }).click();
await page.getByLabel('Название*').fill('Болт М10х40');
await page.locator('.main select').filter({ hasText: 'Поштучно (QR' }).selectOption('batch');
await page.getByRole('button', { name: 'Создать' }).click();
await page.getByLabel(/Количество/).fill('100');
await page.getByRole('button', { name: 'Оприходовать' }).click();
await page.getByText(/Оприходовано: Болт М10х40, 100 шт/).waitFor();

// Комплектация Газели: подшипник P-000001 и 30 болтов
await go('move/transfer');
await page.locator('.main select').first().selectOption({ label: 'Газель: Газель 1' });
await scan('P-000001');
await scan('B-000001');
await page.locator('input.qty').fill('30');
await shot('04-transfer');
await page.getByRole('button', { name: 'Провести' }).click();
await page.getByText('Проведено: 2').waitFor();

// В поле без связи: ставим подшипник на комбайн
await context.setOffline(true);
await page.evaluate(() => window.dispatchEvent(new Event('offline')));
await go('move/install?to=M-001');
await page.locator('.sync').getByText('Без связи').waitFor();
await scan('P-000001');
await page.getByLabel(/Моточасы/).fill('1520');
await page.getByRole('button', { name: 'Провести' }).click();
await page.getByText('Проведено: 1').waitFor();
await page.getByText('не отправлено: 1').waitFor();
await shot('05-offline-install');

// Перезагрузка без связи: данные на месте
await page.reload().catch(() => {});
await go('scan?code=M-001');
await page.getByText('Установлено (1)').waitFor();

// Связь вернулась: операция уходит на сервер
await context.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.getByText('не отправлено: 1').waitFor({ state: 'detached', timeout: 10000 });
await shot('06-machine-passport');

// Остатки
await go('stock?tab=items');
const row = page.locator('tr', { hasText: 'Болт М10х40' });
assert.match(await row.innerText(), /70\s+30\s+100 шт/);
await shot('07-stock');

// Инвентаризация склада: нашли только 65 болтов из 70
await go('inventory?loc=W-001');
await scan('B-000001');
await page.locator('input.qty').fill('65');
await scan('P-000002');
await page.getByText('Расхождения (1)').waitFor();
await page.getByRole('button', { name: 'Исправить учёт' }).click();
await page.getByText(/Учёт исправлен/).waitFor();

// Пробная загрузка каталога из Excel (вставка из буфера)
await go('catalog');
await page.getByRole('button', { name: 'Загрузить из Excel' }).click();
await page.locator('textarea').fill('Наименование\tАртикул\tПроизводитель\nРемень вариатора\t1234567\tClaas\nФильтр масляный\tW 962\tMann');
await page.getByRole('button', { name: 'Загрузить 2 позиций' }).click();
await page.getByText('Загружено позиций: 2').waitFor();
await page.getByRole('button', { name: 'Закрыть' }).click();
await page.getByText('Ремень вариатора').waitFor();
await page.getByRole('button', { name: 'Удалить загрузку' }).click();
await page.getByText('Ремень вариатора').waitFor({ state: 'detached' });

// Затраты: подшипник поставлен по цене 1250,50
await go('costs');
await page.locator('.big-number').first().getByText(/1\s251 ₽/).waitFor();
await page.getByText('Акрос 595 №7').click();
await page.getByText(/1 × 1\s251 ₽/).waitFor();
await shot('08-costs');

// Нестыковка: подшипник стоит на комбайне, а его ещё и «перемещают» в Газель
await go('move/transfer?unit=P-000001&to=V-001');
await page.getByText(/По учёту деталь сейчас: Акрос 595/).waitFor();
await page.getByRole('button', { name: 'Провести' }).click();
await page.getByText('Проведено: 1').waitFor();
await go('');
await page.getByText('Есть нестыковки в учёте: 1').waitFor();
await go('issues');
await page.getByText('Поштучная деталь числится в двух местах').waitFor();
await page.getByText(/числится сразу: (Газель 1, Акрос 595 №7|Акрос 595 №7, Газель 1)/).waitFor();
await shot('09-issues');
await page.getByRole('button', { name: 'Разобрались' }).click();
await page.getByPlaceholder('Что выяснили (необязательно)').fill('ошибся при выдаче');
await page.getByRole('button', { name: 'Готово' }).click();
await page.getByText('Нестыковок нет.').waitFor();

// Тёмная тема
await page.setViewportSize({ width: 1100, height: 800 });
await page.locator('.side select').selectOption('dark');
assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
await go('');
await shot('10-dark');
await page.setViewportSize({ width: 390, height: 844 });

// Сервер видит всё
const token = await page.evaluate(
  () =>
    new Promise((res) => {
      const r = indexedDB.open('zapchasti');
      r.onsuccess = () => {
        const g = r.result.transaction('meta').objectStore('meta').get('token');
        g.onsuccess = () => res(g.result.value);
      };
    }),
);
const sync = await (
  await fetch(`${BASE}/api/sync`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ since: 0, ops: [] }),
  })
).json();
const install = sync.ops.find((o) => o.kind === 'move' && o.payload.type === 'install');
assert.equal(install.payload.hours, 1520);

await browser.close();
console.log(`OK: все сценарии прошли, операций на сервере: ${sync.ops.length}`);
