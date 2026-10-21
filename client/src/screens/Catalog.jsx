import { useMemo, useState } from 'react';
import { useStore, record, recordMany, uid, isOwner } from '../store.js';
import { itemTotals } from '../../../shared/state.js';
import { Section, Message, fmtDate, fmtQty, searchItems } from '../ui.jsx';
import { PhotoInput, Thumb } from '../photo.jsx';
import { Grid } from '../Grid.jsx';
import { useView, ViewSwitch } from '../views.jsx';
import { fmtMoney } from './Costs.jsx';

// Каталог таблицей: правка прямо в ячейках, как в Excel.
function CatalogGrid({ items, totals, navigate }) {
  const [err, setErr] = useState(null);
  const num = (r, k) => Number(r[k]) || 0;
  const columns = [
    { key: 'photo', title: '', width: 44, render: (r) => <Thumb id={r.photo} size={28} />, value: () => '' },
    { key: 'name', title: 'Название', width: 260, editable: true },
    { key: 'sku', title: 'Артикул', width: 130, editable: true },
    { key: 'manufacturer', title: 'Производитель', width: 130, editable: true },
    { key: 'models', title: 'Модели техники', width: 160, editable: true },
    { key: 'tracking', title: 'Учёт', width: 90, value: (r) => (r.tracking === 'batch' ? 'партией' : 'поштучно') },
    { key: 'unitName', title: 'Ед.', width: 60, editable: true },
    { key: 'minQty', title: 'Мин.', width: 70, align: 'right', editable: true, value: (r) => num(r, 'minQty') || '' },
    {
      key: 'price',
      title: 'Цена, ₽',
      width: 100,
      align: 'right',
      editable: true,
      value: (r) => num(r, 'price') || '',
      render: (r) => (num(r, 'price') ? num(r, 'price').toLocaleString('ru-RU') : ''),
    },
    { key: 'stock', title: 'Запас', width: 80, align: 'right', value: (r) => totals[r.id]?.total || 0 },
    {
      key: 'value',
      title: 'Сумма',
      width: 110,
      align: 'right',
      value: (r) => (totals[r.id]?.total || 0) * num(r, 'price'),
      render: (r) => {
        const v = (totals[r.id]?.total || 0) * num(r, 'price');
        return v ? fmtMoney(v) : '';
      },
    },
    { key: 'note', title: 'Заметка', width: 180, editable: true },
  ];

  async function onEdit(row, changes) {
    setErr(null);
    const fixed = { ...changes };
    for (const k of NUMERIC) if (k in fixed) fixed[k] = toNum(fixed[k]);
    if ('name' in fixed) fixed.name = String(fixed.name).trim();
    const payload = row ? { ...row, ...fixed } : { id: uid(), tracking: 'piece', unitName: 'шт', minQty: 0, ...fixed };
    if (!payload.name)
      return setErr(row ? 'Название не может быть пустым.' : 'Для новой позиции сначала впишите название.');
    try {
      await record('item.upsert', payload);
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <>
      {err && <Message kind="error">{err}</Message>}
      <Grid
        columns={columns}
        rows={items}
        onEdit={onEdit}
        onOpen={(r) => navigate(`/catalog?id=${r.id}`)}
        rowClass={(r) => (Number(r.minQty) > 0 && (totals[r.id]?.total || 0) < Number(r.minQty) ? 'low' : '')}
      />
      <p className="muted small">
        Стрелки и Tab — переход, Enter или просто начните печатать — правка, Esc — отмена. Можно копировать и вставлять
        блоки из Excel (Ctrl+C, Ctrl+V). Двойной щелчок по фото или запасу открывает карточку позиции.
      </p>
    </>
  );
}

const FIELDS = [
  ['name', 'Название*'],
  ['sku', 'Артикул'],
  ['manufacturer', 'Производитель'],
  ['models', 'Модели техники'],
  ['unitName', 'Ед. изм.'],
  ['minQty', 'Мин. остаток'],
  ['price', 'Цена закупки, ₽'],
  ['note', 'Заметка'],
];

const NUMERIC = ['minQty', 'price'];
const toNum = (v) =>
  Number(
    String(v ?? '')
      .replace(/\s/g, '')
      .replace(',', '.'),
  ) || 0;

function ItemForm({ item, onDone }) {
  const { state, user } = useStore();
  const [f, setF] = useState({ tracking: 'piece', unitName: 'шт', minQty: 0, ...item });
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save() {
    try {
      const payload = {
        ...f,
        id: f.id || uid(),
        name: String(f.name || '').trim(),
        minQty: toNum(f.minQty),
        price: toNum(f.price),
      };
      await record('item.upsert', payload);
      onDone();
    } catch (e) {
      setErr(e.message);
    }
  }
  async function remove() {
    const left = itemTotals(state)[item.id]?.total || 0;
    if (left > 0)
      return setErr(
        `Удалить нельзя: по учёту ещё ${fmtQty(left, item)} на складах и в Газелях. Сначала спишите остаток.`,
      );
    if (!confirm(`Удалить «${item.name}» из архива насовсем? В старых записях журнала название останется.`)) return;
    try {
      await record('item.delete', { id: item.id });
      onDone();
    } catch (e) {
      setErr(e.message);
    }
  }
  return (
    <Section title={item?.id ? 'Позиция' : 'Новая позиция'}>
      <div className="grid2">
        {FIELDS.map(([k, label]) => (
          <label key={k} className="field">
            {label}
            <input value={f[k] ?? ''} onChange={set(k)} inputMode={NUMERIC.includes(k) ? 'decimal' : undefined} />
          </label>
        ))}
        <label className="field">
          Учёт
          <select value={f.tracking} onChange={set('tracking')} disabled={!!item?.id}>
            <option value="piece">Поштучно (QR на каждую)</option>
            <option value="batch">Партией (QR на коробку)</option>
          </select>
        </label>
      </div>
      <PhotoInput value={f.photo || null} onChange={(photo) => setF({ ...f, photo })} />
      {item?.id && (
        <label className="check">
          <input type="checkbox" checked={!!f.archived} onChange={(e) => setF({ ...f, archived: e.target.checked })} />{' '}
          В архиве (не показывать в поиске)
        </label>
      )}
      {err && <Message kind="error">{err}</Message>}
      <div className="row">
        <button className="btn primary" disabled={!String(f.name || '').trim()} onClick={save}>
          Сохранить
        </button>
        <button className="btn" onClick={onDone}>
          Отмена
        </button>
        {item?.archived && isOwner(user) && (
          <button className="btn danger" onClick={remove}>
            Удалить из архива
          </button>
        )}
      </div>
    </Section>
  );
}

// --- пробная загрузка из Excel ---

function parseTable(text) {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => l.trim());
  if (!lines.length) return [];
  const first = lines[0];
  const sep = first.includes('\t') ? '\t' : first.split(';').length >= first.split(',').length ? ';' : ',';
  return lines.map((l) => splitLine(l, sep));
}

function splitLine(line, sep) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"' && cur === '') quoted = true;
    else if (c === sep) out.push(cur.trim()), (cur = '');
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function guessColumn(headers, field) {
  const words = {
    name: ['наимен', 'назван', 'name'],
    sku: ['артик', 'код', 'каталож', 'sku'],
    manufacturer: ['произв', 'бренд', 'марка'],
    models: ['модел', 'техник', 'примен'],
    unitName: ['ед', 'изм'],
    minQty: ['мин'],
    price: ['цен', 'стоим'],
    note: ['прим', 'коммент'],
  }[field];
  const i = headers.findIndex((h) => words.some((w) => h.toLowerCase().includes(w)));
  return i >= 0 ? String(i) : '';
}

function Import({ onDone }) {
  const { state } = useStore();
  const [text, setText] = useState('');
  const [hasHeader, setHasHeader] = useState(true);
  const [map, setMap] = useState(null);
  const [tracking, setTracking] = useState('piece');
  const [msg, setMsg] = useState(null);
  const rows = useMemo(() => parseTable(text), [text]);
  const headers = rows[0] || [];
  const data = hasHeader ? rows.slice(1) : rows;
  const cols = headers.map((h, i) => (hasHeader ? h || `Столбец ${i + 1}` : `Столбец ${i + 1}`));
  const mapping = map || Object.fromEntries(FIELDS.map(([k]) => [k, hasHeader ? guessColumn(headers, k) : '']));

  const toItems = () =>
    data
      .map((r) => {
        const it = {};
        for (const [k] of FIELDS) if (mapping[k] !== '') it[k] = r[Number(mapping[k])] ?? '';
        for (const k of NUMERIC) if (k in it) it[k] = toNum(it[k]);
        return it;
      })
      .filter((it) => it.name);

  async function run() {
    const batch = uid();
    const bySku = Object.fromEntries(
      Object.values(state.items)
        .filter((i) => i.sku)
        .map((i) => [i.sku.toLowerCase(), i]),
    );
    const items = toItems();
    const ops = items.map((it) => {
      const existing = it.sku && bySku[String(it.sku).toLowerCase()];
      return {
        kind: 'item.upsert',
        payload: existing
          ? // У уже существующей позиции обновляем только заполненные поля.
            { ...Object.fromEntries(Object.entries(it).filter(([, v]) => v !== '' && v !== 0)), id: existing.id }
          : {
              tracking,
              ...it,
              unitName: it.unitName || 'шт',
              id: uid(),
              importBatch: batch,
              importedAt: new Date().toISOString(),
            },
      };
    });
    await recordMany(ops);
    setMsg({ kind: 'ok', text: `Загружено позиций: ${ops.length}` });
    setText('');
  }

  const readFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result));
    reader.readAsText(file, 'utf-8');
  };

  const preview = data.length ? toItems().slice(0, 5) : [];

  return (
    <Section
      title="Пробная загрузка каталога"
      actions={
        <button className="btn ghost small" onClick={onDone}>
          Закрыть
        </button>
      }
    >
      <p className="muted small">
        Скопируйте строки в Excel (вместе с заголовками) и вставьте сюда, или выберите файл CSV. Остатки не загружаются,
        только названия и артикулы. Загрузку можно потом удалить целиком.
      </p>
      <textarea
        rows={6}
        value={text}
        onChange={(e) => (setText(e.target.value), setMap(null))}
        placeholder="Вставьте сюда из Excel"
      />
      <input type="file" accept=".csv,.txt,.tsv" onChange={readFile} />
      {rows.length > 0 && (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={hasHeader}
              onChange={(e) => (setHasHeader(e.target.checked), setMap(null))}
            />{' '}
            Первая строка — заголовки
          </label>
          <div className="grid2">
            {FIELDS.map(([k, label]) => (
              <label key={k} className="field">
                {label}
                <select value={mapping[k]} onChange={(e) => setMap({ ...mapping, [k]: e.target.value })}>
                  <option value="">— не загружать —</option>
                  {cols.map((c, i) => (
                    <option key={i} value={String(i)}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label className="field">
              Учёт для новых позиций
              <select value={tracking} onChange={(e) => setTracking(e.target.value)}>
                <option value="piece">Поштучно</option>
                <option value="batch">Партией</option>
              </select>
            </label>
          </div>
          <h3>Как это будет выглядеть (первые строки)</h3>
          <ul className="list">
            {preview.map((it, i) => (
              <li key={i} className="pad">
                <b>{it.name}</b>{' '}
                <span className="muted small">{[it.sku, it.manufacturer, it.models].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
          {mapping.name === '' && <Message kind="warn">Укажите столбец с названием</Message>}
          <button className="btn primary" disabled={mapping.name === '' || !preview.length} onClick={run}>
            Загрузить {toItems().length} позиций
          </button>
        </>
      )}
      {msg && <Message kind={msg.kind}>{msg.text}</Message>}
    </Section>
  );
}

function ImportBatches() {
  const { state } = useStore();
  const batches = {};
  for (const it of Object.values(state.items)) {
    if (!it.importBatch || it.archived) continue;
    (batches[it.importBatch] ||= { at: it.importedAt, items: [] }).items.push(it);
  }
  const list = Object.entries(batches);
  if (!list.length) return null;

  async function remove(items) {
    const used = new Set(Object.values(state.units).map((u) => u.itemId));
    const free = items.filter((it) => !used.has(it.id));
    if (
      !confirm(
        `Убрать в архив ${free.length} позиций этой загрузки? Позиции, на которые уже есть этикетки (${items.length - free.length}), останутся.`,
      )
    )
      return;
    await recordMany(free.map((it) => ({ kind: 'item.upsert', payload: { ...it, archived: true } })));
  }

  return (
    <Section title="Загрузки из Excel">
      <ul className="list">
        {list.map(([id, b]) => (
          <li key={id} className="line">
            <span className="grow">
              {fmtDate(b.at)} — {b.items.length} позиций
            </span>
            <button className="btn small" onClick={() => remove(b.items)}>
              Удалить загрузку
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export default function Catalog({ params, navigate }) {
  const { state } = useStore();
  const [q, setQ] = useState('');
  const [importing, setImporting] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [view, setView] = useView('catalog');

  const totals = useMemo(() => itemTotals(state), [state]);

  if (params.id !== undefined) {
    return <ItemForm item={params.id ? state.items[params.id] : null} onDone={() => navigate('/catalog')} />;
  }
  if (importing) return <Import onDone={() => setImporting(false)} />;

  const list = showArchived
    ? Object.values(state.items).filter((i) => i.archived && !i.deleted)
    : searchItems(state.items, q);

  return (
    <>
      <Section
        title={`Каталог (${Object.values(state.items).filter((i) => !i.archived).length})`}
        actions={
          <div className="row">
            <a className="btn primary small" href="#/catalog?id=">
              + Позиция
            </a>
            <button className="btn small" onClick={() => setImporting(true)}>
              Загрузить из Excel
            </button>
            <ViewSwitch view={view} setView={setView} />
          </div>
        }
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: название, артикул, модель" />
        <label className="check">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Показать
          архив
        </label>
        {view === 'table' ? (
          <CatalogGrid items={list} totals={totals} navigate={navigate} />
        ) : (
          <ul className="list">
            {list.slice(0, 300).map((it) => (
              <li key={it.id}>
                <a className="list-btn row-btn" href={`#/catalog?id=${it.id}`}>
                  <Thumb id={it.photo} />
                  <span className="grow">
                    <b>{it.name}</b>
                    <span className="muted block">
                      {[
                        it.sku,
                        it.tracking === 'batch' ? 'партией' : 'поштучно',
                        `запас ${fmtQty(totals[it.id]?.total || 0, it)}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <ImportBatches />
    </>
  );
}
