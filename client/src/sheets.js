// Чтение прайсов (Excel, CSV, PDF) и запись заказов в Excel.
// Библиотеки подгружаются только когда нужны, чтобы не утяжелять приложение на телефоне.
import { parseTable } from '../../shared/purchase.js';

// Возвращает листы: [{ sheet, data: [[ячейка, ...], ...] }]
export async function readPriceFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
    const { default: readExcelFile } = await import('read-excel-file/browser');
    const sheets = await readExcelFile(file);
    return sheets.map((s) => ({ sheet: s.sheet, data: s.data.map((r) => r.map(cellValue)) }));
  }
  if (name.endsWith('.xls')) {
    throw new Error(
      'Это старый формат Excel (.xls). Откройте файл в Excel и сохраните как .xlsx, ' +
        'или выделите таблицу (Ctrl+A, Ctrl+C) и вставьте её в поле ниже.',
    );
  }
  if (name.endsWith('.pdf')) return [{ sheet: 'PDF', data: await readPdf(file) }];
  // CSV и текст: русский Excel сохраняет CSV в Windows-1251, пробуем обе кодировки.
  const buf = await file.arrayBuffer();
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�')) text = new TextDecoder('windows-1251').decode(buf);
  return [{ sheet: file.name, data: parseTable(text.replace(/^﻿/, '')) }];
}

function cellValue(v) {
  if (v instanceof Date) return v.toLocaleDateString('ru-RU');
  return v;
}

// PDF: собираем текст в строки по высоте на странице, а строки делим на колонки по большим промежуткам.
// Работает для прайсов, выгруженных из программ. Скан или фото так не прочитать: там нет текста.
async function readPdf(file) {
  const pdfjs = await import('pdfjs-dist');
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const rows = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const { items } = await page.getTextContent();
    const lines = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4];
      const y = it.transform[5];
      const h = Math.abs(it.transform[3]) || 10;
      let line = lines.find((l) => Math.abs(l.y - y) < h * 0.5);
      if (!line) lines.push((line = { y, h, parts: [] }));
      line.parts.push({ x, end: x + (it.width || it.str.length * h * 0.5), str: it.str });
    }
    lines.sort((a, b) => b.y - a.y);
    for (const l of lines) {
      l.parts.sort((a, b) => a.x - b.x);
      const cells = [];
      let prevEnd = -Infinity;
      for (const part of l.parts) {
        if (part.x - prevEnd > l.h * 0.5 || !cells.length) cells.push(part.str.trim());
        else cells[cells.length - 1] = `${cells[cells.length - 1]}${part.x - prevEnd > l.h * 0.15 ? ' ' : ''}${part.str.trim()}`;
        prevEnd = Math.max(prevEnd, part.end);
      }
      rows.push(cells);
    }
  }
  if (!rows.length) throw new Error('В PDF нет текста: похоже, это скан или фото. Цены придётся внести вручную.');
  return rows;
}

// Скачать .xlsx. sheets: [{ sheet: 'Имя листа', data: [[...]], columns: [{ width }] }]
export async function downloadXlsx(fileName, sheets) {
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  const clean = sheets.map((s) => ({
    ...s,
    // В Excel имя листа: до 31 символа и без []:*?/\
    sheet: s.sheet.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Лист',
  }));
  const name = fileName.replace(/[\\/:*?"<>|]/g, ' ');
  if (clean.length === 1) {
    const { data, columns } = clean[0];
    await writeExcelFile(data, { columns, sheet: clean[0].sheet }).toFile(name);
  } else {
    await writeExcelFile(clean).toFile(name);
  }
}
