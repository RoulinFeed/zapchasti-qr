// Сквозная проверка закупки в браузере: node e2e/purchase.mjs http://localhost:3100
// Нужен запущенный сервер с администратором ruslan / 1234 и собранный client (там же библиотека для Excel).
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import writeExcelFile from '../client/node_modules/write-excel-file/node/index.js';
import readExcelFile from '../client/node_modules/read-excel-file/node/index.js';

const BASE = process.argv[2] || 'http://localhost:3100';
const shots = process.env.SHOTS_DIR;
const dir = mkdtempSync(path.join(tmpdir(), 'purchase-'));

// Прайс «Агро А»: шапка с названием фирмы, потом таблица. Позиции названы по-своему.
const priceA = path.join(dir, 'Прайс Агро А.xlsx');
await writeExcelFile([
  ['ООО «Агро А»'],
  ['Прайс-лист от 15.11.2026'],
  [],
  ['№', 'Код', 'Наименование', 'Кол-во', 'Цена, руб'],
  [1, '0002157030', 'Подшипник 6205 закрытый', 5, 1200],
  [2, '644-455.0', 'Ремень вариатора Lexion', 3, 9500],
  [3, '0007700990', 'Фильтр масляный', 10, 650],
]).toFile(priceA);

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU', deviceScaleFactor: 2, acceptDownloads: true });
const page = await context.newPage();
page.on('dialog', (d) => d.accept());
page.on('console', (m) => m.type() === 'error' && console.log('console:', m.text()));
page.on('pageerror', (e) => {
  throw e;
});
// Файл передаём содержимым: путь с русскими буквами Playwright в этом окружении не передаёт.
async function pickFile(file, name) {
  await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: readFileSync(file) });
}
const shot = (name) => shots && page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });

// PDF-прайс третьего поставщика: печатаем HTML-таблицу в PDF тем же браузером.
const pdfPath = path.join(dir, 'Прайс Техсервис.pdf');
{
  const p = await context.newPage();
  await p.setContent(`<h3>ООО Техсервис, цены на 16.11.2026</h3><table border="1" cellpadding="6" style="border-collapse:collapse;font:14px Arial">
    <tr><th>Артикул</th><th>Наименование</th><th>Наличие</th><th>Цена</th></tr>
    <tr><td>215703.0</td><td>Подшипник шариковый 6205</td><td>2</td><td>990,00</td></tr>
    <tr><td>644455.0</td><td>Ремень</td><td>нет</td><td>8 700,00</td></tr></table>`);
  await p.pdf({ path: pdfPath });
  await p.close();
}

await page.goto(BASE);
await page.getByLabel('Логин').fill('ruslan');
await page.getByLabel('PIN-код').fill('1234');
await page.getByRole('button', { name: 'Войти' }).click();
await page.getByText('Что отсканировать?').waitFor();

// Новая заявка, две строки вводим прямо в таблицу, как в Excel.
await page.goto(`${BASE}/#/purchase`);
await page.getByRole('button', { name: 'Новая заявка' }).click();
await page.getByText('Что нужно купить').waitFor();
async function typeRow(cells) {
  await page.locator('tr.grid-new td').first().click();
  for (const [i, text] of cells.entries()) {
    // Enter открывает ячейку на правку, дальше печатаем.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+A');
    await page.keyboard.type(text);
    await page.keyboard.press(i < cells.length - 1 ? 'Tab' : 'Enter');
    await page.waitForTimeout(200);
  }
}
await typeRow(['Подшипник 6205 2RS', '0002157030', '10']);
await typeRow(['Ремень вариатора', '644455.0', '2']);
await shot('p1-lines');
await page.getByText('Что нужно купить (2)').waitFor();

// Прайс в Excel.
await page.getByRole('button', { name: 'Цены и распределение' }).click();
await page.getByRole('button', { name: 'Загрузить прайс' }).click();
await page.getByLabel('Поставщик*').selectOption('new');
await page.getByLabel('Название нового поставщика').fill('Агро А');
await pickFile(priceA, 'agro-a.xlsx');
await shot('p2-import');
await page.getByText('Сопоставление с заявкой: 2 из 2 позиций').waitFor();
await page.getByRole('button', { name: 'Загрузить 2 цен' }).click();
await page.getByText('Загружено цен: 2.').waitFor();

// Цена из сообщения в Telegram от второго поставщика.
await page.getByRole('button', { name: 'Цена из сообщения' }).click();
await page.getByLabel('Поставщик*').selectOption('new');
await page.getByLabel('Название нового поставщика').fill('Запчасть Б');
await page.getByLabel(/Текст сообщения/).fill('Подшипник 6205 есть 20 шт по 1 300 р, отгрузим завтра');
assert.equal(await page.getByLabel('Цена за единицу, ₽*').inputValue(), '1300');
assert.equal(await page.getByLabel(/Сколько есть/).inputValue(), '20');
assert.match(await page.getByLabel('Позиция заявки*').locator('option:checked').innerText(), /Подшипник 6205 2RS/);
await page.getByRole('button', { name: 'Сохранить цену' }).click();
await page.getByText('Цена сохранена.').waitFor();

// PDF третьего поставщика.
await page.getByRole('button', { name: 'Загрузить прайс' }).click();
await page.getByLabel('Поставщик*').selectOption('new');
await page.getByLabel('Название нового поставщика').fill('Техсервис');
await pickFile(pdfPath, 'tehservis.pdf');
await page.getByText('Сопоставление с заявкой: 2 из 2 позиций').waitFor();
await page.getByRole('button', { name: 'Загрузить 2 цен' }).click();
await page.getByText('Загружено цен: 2.').waitFor();

// «Агро А» прислал прайс повторно, подешевле: вставляем текстом. Он заменяет прежний, ремня в нём больше нет.
await page.getByRole('button', { name: 'Загрузить прайс' }).click();
await page.getByLabel('Поставщик*').selectOption({ label: 'Агро А' });
await page.getByText('…или вставить таблицу текстом').click();
await page.getByPlaceholder('Вставьте сюда строки прайса').fill('Код\tНаименование\tКол-во\tЦена\n0002157030\tПодшипник 6205 закрытый\t5\t1 100,00');
await page.getByRole('button', { name: 'Разобрать' }).click();
// Название их позиции программа запомнила с прошлого прайса.
await page.getByText('подтверждено раньше').waitFor();
await page.getByRole('button', { name: 'Загрузить 1 цен' }).click();

// Распределение: подшипников 10 — 2 у Техсервиса (990), 5 у Агро А (1100), 3 у Запчасть Б (1300).
// Ремень: у Агро А цена снята новым прайсом, у Техсервиса нет в наличии — распределить нельзя.
await page.getByRole('button', { name: 'Распределить по лучшей цене' }).click();
await page.getByText(/Распределено по лучшей цене/).waitFor();
await page.getByText('Распределено 1 из 2 позиций').waitFor();
await page.getByText(/Ремень вариатора: не распределено 2/).waitFor();
assert.equal(await page.getByRole('button', { name: 'Оформить заказы' }).isDisabled(), true);

// Ремень: Агро А по телефону подтвердил старую цену — вписываем её прямо в ячейку, затем «беру 2».
const row = page.locator('.grid tbody tr', { hasText: 'Ремень вариатора' });
const headers = await page.locator('.grid thead th').allInnerTexts();
const col = (title) => headers.findIndex((h) => h.trim().startsWith(title));
await row.locator('td').nth(col('Агро А') - 1).dblclick();
await page.keyboard.press('Control+A');
await page.keyboard.type('9400');
await page.keyboard.press('Tab');
await page.waitForTimeout(300);
await page.keyboard.press('Enter');
await page.keyboard.type('2');
await page.keyboard.press('Enter');
await page.getByText(/Всё распределено/).waitFor();
await shot('p3-compare');

const bearing = page.locator('.grid tbody tr', { hasText: 'Подшипник 6205 2RS' });
const t = await bearing.innerText();
assert.match(t, /990/);
assert.match(t, /↓\s*1\s?100/);

await page.getByRole('button', { name: 'Оформить заказы' }).click();
await page.getByText('Заказы (3)').waitFor();
await shot('p4-orders');

// Выгрузка всех заказов: три листа, у каждого поставщика свои строки.
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Все заказы в Excel' }).click()]);
const file = path.join(dir, dl.suggestedFilename());
await dl.saveAs(file);
const sheets = await readExcelFile(readFileSync(file));
assert.deepEqual(sheets.map((s) => s.sheet), ['Агро А', 'Запчасть Б', 'Техсервис']);
const agro = sheets[0].data;
const total = agro.at(-1).at(-1);
assert.equal(total, 5 * 1100 + 2 * 9400);
console.log('OK: закупка от заявки до заказов в Excel', sheets.map((s) => `${s.sheet}: ${s.data.at(-1).at(-1)} ₽`).join(', '));

await browser.close();
