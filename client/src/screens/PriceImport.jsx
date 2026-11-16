import { useMemo, useState } from 'react';
import { useStore, recordMany, uid } from '../store.js';
import {
  guessColumns,
  matchOfferRow,
  normName,
  offerKey,
  parseMessage,
  parseNumber,
  parseStock,
  parseTable,
  purchaseLines,
} from '../../../shared/purchase.js';
import { Section, Message } from '../ui.jsx';
import { readPriceFile } from '../sheets.js';
import { fmtMoney } from './Costs.jsx';

const today = () => new Date().toISOString().slice(0, 10);

// Выбор поставщика: из списка или новый по названию.
export function SupplierField({ value, onChange }) {
  const suppliers = useStore((s) => s.state.suppliers);
  const list = Object.values(suppliers)
    .filter((s) => !s.archived)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const isNew = value?.id === 'new';
  return (
    <div className="grid2">
      <label className="field">
        Поставщик*
        <select
          value={value?.id || ''}
          onChange={(e) => onChange(e.target.value === 'new' ? { id: 'new', name: '' } : suppliers[e.target.value] || null)}
        >
          <option value="">Выберите поставщика</option>
          {list.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          <option value="new">+ Новый поставщик…</option>
        </select>
      </label>
      {isNew && (
        <label className="field">
          Название нового поставщика
          <input autoFocus value={value.name} onChange={(e) => onChange({ id: 'new', name: e.target.value })} />
        </label>
      )}
    </div>
  );
}

// Если выбран новый поставщик, добавляем операцию его создания. Возвращает { id, ops }.
export function supplierOps(state, value) {
  if (!value) throw new Error('Выберите поставщика.');
  if (value.id !== 'new') return { id: value.id, ops: [] };
  const name = value.name.trim();
  if (!name) throw new Error('Впишите название поставщика.');
  const same = Object.values(state.suppliers).find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (same) return { id: same.id, ops: [] };
  const id = uid();
  return { id, ops: [{ kind: 'supplier.upsert', payload: { id, name } }] };
}

function lineTitle(state, l) {
  const it = l.itemId && state.items[l.itemId];
  const name = it?.name || l.name;
  const sku = it?.sku || l.sku;
  return sku ? `${name} · ${sku}` : name;
}

const HOW = {
  map: ['подтверждено раньше', 'ok-text'],
  code: ['по артикулу', 'ok-text'],
  name: ['похоже по названию, проверьте', 'warn-text'],
  hand: ['выбрано вручную', 'ok-text'],
};

const COLS = [
  ['name', 'Наименование у поставщика*'],
  ['code', 'Артикул / код'],
  ['price', 'Цена*'],
  ['qty', 'Наличие, кол-во'],
];

// Загрузка прайса: файл Excel/CSV/PDF или вставленный текст → колонки → сопоставление с заявкой.
export function PriceImport({ pu, onDone }) {
  const { state } = useStore();
  const [supplier, setSupplier] = useState(null);
  const [sheets, setSheets] = useState(null);
  const [sheetNo, setSheetNo] = useState(0);
  const [fileName, setFileName] = useState('');
  const [source, setSource] = useState('excel');
  const [text, setText] = useState('');
  const [map, setMap] = useState(null);
  const [headerRow, setHeaderRow] = useState(-1);
  const [picked, setPicked] = useState({}); // индекс строки → lineId ('' = не брать)
  const [full, setFull] = useState(true);
  const [date, setDate] = useState(today);
  const [showAll, setShowAll] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const rows = sheets?.[sheetNo]?.data || [];
  const lines = purchaseLines(pu);
  const supplierId = supplier && supplier.id !== 'new' ? supplier.id : null;

  function load(newSheets, name, src) {
    setSheets(newSheets);
    setSheetNo(0);
    setFileName(name);
    setSource(src);
    const g = guessColumns(newSheets[0]?.data || []);
    setMap(g.map);
    setHeaderRow(g.headerRow);
    setPicked({});
  }

  async function onFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setErr(null);
    setBusy(true);
    try {
      const s = await readPriceFile(file);
      load(s, file.name, file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'excel');
    } catch (ex) {
      setErr(ex.message || 'Не удалось прочитать файл');
    } finally {
      setBusy(false);
    }
  }

  function onPasteText() {
    const data = parseTable(text);
    if (!data.length) return setErr('Вставьте таблицу из Excel, PDF или письма.');
    setErr(null);
    load([{ sheet: 'Вставка', data }], '', 'text');
  }

  function chooseSheet(i) {
    setSheetNo(i);
    const g = guessColumns(sheets[i].data);
    setMap(g.map);
    setHeaderRow(g.headerRow);
    setPicked({});
  }

  // Строки прайса после разбора колонок, с найденной строкой заявки.
  const parsed = useMemo(() => {
    if (!map) return [];
    const col = (r, k) => (map[k] === '' ? null : r[Number(map[k])]);
    const res = [];
    rows.forEach((r, i) => {
      if (i <= headerRow) return;
      const name = String(col(r, 'name') ?? '').trim();
      const code = String(col(r, 'code') ?? '').trim();
      const price = parseNumber(col(r, 'price'));
      if (!name && !code) return;
      if (price == null || price <= 0) return;
      const qty = map.qty === '' ? null : parseStock(col(r, 'qty'));
      const auto = matchOfferRow(state, pu, supplierId || '', { name, code });
      const hand = picked[i];
      const lineId = hand !== undefined ? hand || null : auto.lineId;
      res.push({ i, name, code, price, qty, lineId, how: hand !== undefined ? (hand ? 'hand' : null) : auto.how });
    });
    return res;
  }, [rows, map, headerRow, picked, state, pu, supplierId]);

  const matched = parsed.filter((r) => r.lineId);
  const dupes = new Set(
    matched.filter((r, i) => matched.findIndex((x) => x.lineId === r.lineId) !== i).map((r) => r.lineId),
  );
  const missing = lines.filter((l) => Number(l.qty) > 0 && !matched.some((r) => r.lineId === l.id));
  const shown = showAll ? parsed : parsed.filter((r) => r.lineId || r.how);

  async function save() {
    setErr(null);
    try {
      if (!matched.length) throw new Error('Ни одна строка прайса не сопоставлена с заявкой.');
      const sup = supplierOps(state, supplier);
      // Если одна позиция встретилась дважды, берём самую низкую цену.
      const byLine = {};
      for (const r of matched) if (!byLine[r.lineId] || r.price < byLine[r.lineId].price) byLine[r.lineId] = r;
      const offerRows = Object.values(byLine).map((r) => ({
        lineId: r.lineId,
        price: r.price,
        qty: r.qty,
        supName: r.name,
        supCode: r.code,
      }));
      // Запоминаем, какая их позиция — наша, чтобы следующий прайс сопоставился сам.
      const known = state.supplierMap[sup.id] || {};
      const maps = [];
      for (const r of Object.values(byLine)) {
        const line = pu.lines[r.lineId];
        const key = offerKey(r);
        if (!line || !key) continue;
        const ref = line.itemId || (line.name ? `name:${normName(line.name)}` : null);
        if (ref && known[key] !== ref)
          maps.push({
            kind: 'map.set',
            payload: { supplierId: sup.id, key, ...(line.itemId ? { itemId: line.itemId } : { lineName: line.name }) },
          });
      }
      await recordMany([
        ...sup.ops,
        {
          kind: 'offer.list',
          payload: {
            purchaseId: pu.id,
            supplierId: sup.id,
            source,
            fileName,
            full,
            receivedAt: date ? new Date(`${date}T12:00:00`).toISOString() : undefined,
            rows: offerRows,
          },
        },
        ...maps,
      ]);
      onDone(`Загружено цен: ${offerRows.length}.${missing.length ? ` Без цены у этого поставщика: ${missing.length}.` : ''}`);
    } catch (e) {
      setErr(e.message);
    }
  }

  const width = Math.max(0, ...rows.slice(0, 50).map((r) => r.length));
  const colNames = Array.from({ length: width }, (_, i) => {
    const h = headerRow >= 0 ? rows[headerRow]?.[i] : null;
    const sample = rows.find((r, j) => j > headerRow && r[i] != null && String(r[i]).trim())?.[i];
    return `${String.fromCharCode(65 + (i % 26))}: ${String(h ?? sample ?? '').slice(0, 30)}`;
  });

  return (
    <Section
      title="Загрузка прайса"
      actions={
        <button className="btn ghost small" onClick={() => onDone(null)}>
          Закрыть
        </button>
      }
    >
      <SupplierField value={supplier} onChange={setSupplier} />
      <div className="grid2">
        <label className="field">
          Файл: Excel (.xlsx), CSV или PDF
          <input type="file" accept=".xlsx,.xlsm,.xls,.csv,.txt,.pdf" onChange={onFile} disabled={busy} />
        </label>
        <label className="field">
          Дата прайса
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <details className="subcard">
        <summary>…или вставить таблицу текстом (из Excel, PDF, письма)</summary>
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Вставьте сюда строки прайса" />
        <button className="btn small" onClick={onPasteText}>
          Разобрать
        </button>
      </details>
      {busy && <p className="muted">Читаю файл…</p>}
      {err && <Message kind="error">{err}</Message>}

      {sheets && (
        <>
          {sheets.length > 1 && (
            <div className="seg">
              {sheets.map((s, i) => (
                <button key={i} className={`btn small ${i === sheetNo ? 'primary' : ''}`} onClick={() => chooseSheet(i)}>
                  {s.sheet}
                </button>
              ))}
            </div>
          )}
          <p className="muted small">
            Строк в файле: {rows.length}. Проверьте, какие колонки что означают: программа угадала их по заголовкам.
          </p>
          <div className="grid2">
            {COLS.map(([k, label]) => (
              <label key={k} className="field">
                {label}
                <select value={map[k]} onChange={(e) => setMap({ ...map, [k]: e.target.value })}>
                  <option value="">— нет —</option>
                  {colNames.map((c, i) => (
                    <option key={i} value={String(i)}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label className="field">
              Строка заголовков
              <select value={headerRow} onChange={(e) => setHeaderRow(Number(e.target.value))}>
                <option value={-1}>Нет заголовков</option>
                {rows.slice(0, 20).map((r, i) => (
                  <option key={i} value={i}>
                    {i + 1}: {r.filter((c) => c != null && c !== '').join(' | ').slice(0, 60)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <h3>
            Сопоставление с заявкой: {matched.length} из {lines.length} позиций
          </h3>
          {!supplier && <Message kind="warn">Выберите поставщика: так программа вспомнит его названия позиций.</Message>}
          {dupes.size > 0 && (
            <Message kind="warn">
              Некоторые позиции заявки встречаются в прайсе несколько раз. Будет взята самая низкая цена; если это
              неверно, уберите лишние строки.
            </Message>
          )}
          <label className="check">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Показать все строки
            прайса ({parsed.length}), а не только найденные
          </label>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>У поставщика</th>
                  <th className="num">Цена</th>
                  <th className="num">Есть</th>
                  <th>Наша позиция</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.i} className={dupes.has(r.lineId) ? 'low' : ''}>
                    <td>
                      {r.name}
                      {r.code && <div className="muted small">{r.code}</div>}
                    </td>
                    <td className="num">{fmtMoney(r.price)}</td>
                    <td className="num">{r.qty == null ? '?' : r.qty}</td>
                    <td>
                      <select value={r.lineId || ''} onChange={(e) => setPicked({ ...picked, [r.i]: e.target.value })}>
                        <option value="">— не из заявки —</option>
                        {lines.map((l) => (
                          <option key={l.id} value={l.id}>
                            {lineTitle(state, l)}
                          </option>
                        ))}
                      </select>
                      {r.how && <div className={`small ${HOW[r.how][1]}`}>{HOW[r.how][0]}</div>}
                    </td>
                  </tr>
                ))}
                {!shown.length && (
                  <tr>
                    <td colSpan={4} className="muted">
                      Ничего не найдено. Проверьте колонки или включите «Показать все строки» и выберите позиции вручную.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {missing.length > 0 && (
            <p className="muted small">
              Нет в этом прайсе: {missing.map((l) => lineTitle(state, l)).join('; ')}
            </p>
          )}
          <label className="check">
            <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} /> Это полный прайс:
            заменить им все прежние цены этого поставщика в заявке (чего здесь нет, то он больше не предлагает)
          </label>
          <div className="row">
            <button className="btn primary" onClick={save} disabled={!matched.length || !supplier}>
              Загрузить {matched.length} цен
            </button>
          </div>
        </>
      )}
    </Section>
  );
}

// Быстрый ввод цены по одной позиции, например из сообщения в Telegram.
export function QuickOffer({ pu, lineId: initialLine, supplierId: initialSupplier, onDone }) {
  const { state } = useStore();
  const lines = purchaseLines(pu);
  const [supplier, setSupplier] = useState(initialSupplier ? state.suppliers[initialSupplier] : null);
  const [lineId, setLineId] = useState(initialLine || '');
  const [msg, setMsg] = useState('');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('');
  const [date, setDate] = useState(today);
  const [err, setErr] = useState(null);

  function onMessage(text) {
    setMsg(text);
    const m = parseMessage(text);
    if (m.price != null && !price) setPrice(String(m.price));
    if (m.qty != null && !qty) setQty(String(m.qty));
    // Позицию угадываем по тексту сообщения.
    if (!lineId && text.trim()) {
      const hit = matchOfferRow(state, pu, supplier?.id || '', { name: text, code: '' });
      if (hit.lineId) setLineId(hit.lineId);
    }
  }

  async function save() {
    setErr(null);
    try {
      const p = parseNumber(price);
      if (!lineId) throw new Error('Выберите позицию заявки.');
      if (p == null || p < 0) throw new Error('Впишите цену.');
      const sup = supplierOps(state, supplier);
      await recordMany([
        ...sup.ops,
        {
          kind: 'offer.list',
          payload: {
            purchaseId: pu.id,
            supplierId: sup.id,
            source: msg.trim() ? 'message' : 'manual',
            receivedAt: date ? new Date(`${date}T12:00:00`).toISOString() : undefined,
            note: msg.trim().slice(0, 500),
            rows: [{ lineId, price: p, qty: qty === '' ? null : parseStock(qty) }],
          },
        },
      ]);
      onDone('Цена сохранена.');
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <Section
      title="Цена из сообщения"
      actions={
        <button className="btn ghost small" onClick={() => onDone(null)}>
          Закрыть
        </button>
      }
    >
      <label className="field">
        Текст сообщения (необязательно): вставьте, и цена с количеством подставятся сами
        <textarea rows={3} value={msg} onChange={(e) => onMessage(e.target.value)} placeholder="Например: 6205 есть 5 шт по 1150 р" />
      </label>
      <SupplierField value={supplier} onChange={setSupplier} />
      <label className="field">
        Позиция заявки*
        <select value={lineId} onChange={(e) => setLineId(e.target.value)}>
          <option value="">Выберите позицию</option>
          {lines.map((l) => (
            <option key={l.id} value={l.id}>
              {lineTitle(state, l)} — нужно {l.qty}
            </option>
          ))}
        </select>
      </label>
      <div className="grid3">
        <label className="field">
          Цена за единицу, ₽*
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <label className="field">
          Сколько есть (пусто — неизвестно)
          <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label className="field">
          Дата
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      {err && <Message kind="error">{err}</Message>}
      <div className="row">
        <button className="btn primary" onClick={save}>
          Сохранить цену
        </button>
      </div>
    </Section>
  );
}
