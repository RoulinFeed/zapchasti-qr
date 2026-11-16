import { useMemo, useState } from 'react';
import { useStore, record, recordMany, uid } from '../store.js';
import { lowStock, itemTotals } from '../../../shared/state.js';
import {
  PURCHASE_STATUS,
  OFFER_SOURCES,
  PROBLEM_TEXT,
  autoAllocate,
  lineAlloc,
  lineOffers,
  lineStatus,
  normCode,
  normName,
  parseNumber,
  priceTrend,
  purchaseCheck,
  purchaseLines,
  purchaseOrders,
  purchaseSuppliers,
} from '../../../shared/purchase.js';
import { Section, Message, ItemPicker, fmtDate, navigate } from '../ui.jsx';
import { Grid } from '../Grid.jsx';
import { useView, ViewSwitch } from '../views.jsx';
import { fmtMoney } from './Costs.jsx';
import { PriceImport, QuickOffer } from './PriceImport.jsx';
import { downloadXlsx } from '../sheets.js';

const fmtN = (n) => (n == null ? '' : (Math.round(n * 100) / 100).toLocaleString('ru-RU'));
const dateOnly = (iso) => (iso ? new Date(iso).toLocaleDateString('ru-RU') : '');

function lineName(state, l) {
  return (l.itemId && state.items[l.itemId]?.name) || l.name || '';
}
function lineSku(state, l) {
  return (l.itemId && state.items[l.itemId]?.sku) || l.sku || '';
}

export default function Purchase({ args, params }) {
  const id = args[0];
  const { state } = useStore();
  if (id) {
    const pu = state.purchases[id];
    if (!pu) return <Message kind="warn">Заявка не найдена. Возможно, она ещё не пришла с сервера.</Message>;
    return <PurchaseView pu={pu} tab={params.tab || 'compare'} />;
  }
  return <PurchaseList />;
}

// --- список заявок и поставщиков ---

function PurchaseList() {
  const { state } = useStore();
  const [view, setView] = useView('purchases');
  const rows = useMemo(
    () =>
      Object.values(state.purchases)
        .filter((p) => !p.deleted)
        .map((p) => {
          const c = purchaseCheck(p);
          return {
            ...p,
            statusName: PURCHASE_STATUS[p.status] || p.status,
            lineCount: c.count,
            supplierCount: purchaseSuppliers(state, p).length,
            progress: c.count ? `${c.done} из ${c.count}` : '—',
            total: c.total,
          };
        })
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    [state],
  );

  async function create() {
    const id = uid();
    await record('purchase.upsert', {
      id,
      title: `Заявка от ${new Date().toLocaleDateString('ru-RU')}`,
      status: 'collect',
    });
    navigate(`/purchase/${id}?tab=lines`);
  }

  return (
    <>
      <Section
        title="Закупка"
        actions={
          <div className="row">
            <ViewSwitch view={view} setView={setView} />
            <button className="btn primary" onClick={create}>
              Новая заявка
            </button>
          </div>
        }
      >
        <p className="muted small">
          Заявка: что нужно купить и сколько. В неё загружаются прайсы поставщиков, программа сводит цены в одну таблицу,
          помогает распределить количество между поставщиками и собирает заказы.
        </p>
        {!rows.length && <p className="muted">Заявок пока нет.</p>}
        {rows.length > 0 &&
          (view === 'table' ? (
            <Grid
              newRow={false}
              rows={rows}
              onEdit={() => {}}
              onOpen={(r) => navigate(`/purchase/${r.id}`)}
              columns={[
                { key: 'title', title: 'Заявка', width: 260 },
                { key: 'createdAt', title: 'Создана', width: 110, value: (r) => dateOnly(r.createdAt) },
                { key: 'statusName', title: 'Состояние', width: 110 },
                { key: 'lineCount', title: 'Позиций', width: 90, align: 'right' },
                { key: 'supplierCount', title: 'Поставщиков', width: 110, align: 'right' },
                { key: 'progress', title: 'Распределено', width: 120, align: 'right' },
                { key: 'total', title: 'Сумма', width: 120, align: 'right', render: (r) => (r.total ? fmtMoney(r.total) : '') },
              ]}
            />
          ) : (
            <ul className="list">
              {rows.map((r) => (
                <li key={r.id}>
                  <a className="list-btn" href={`#/purchase/${r.id}`}>
                    <span className="grow">
                      <b>{r.title}</b>
                      <span className="muted block small">
                        {dateOnly(r.createdAt)} · {r.statusName} · позиций {r.lineCount} · поставщиков {r.supplierCount}
                      </span>
                    </span>
                    {r.total > 0 && <b>{fmtMoney(r.total)}</b>}
                  </a>
                </li>
              ))}
            </ul>
          ))}
      </Section>
      <Suppliers />
    </>
  );
}

function Suppliers() {
  const { state } = useStore();
  const [err, setErr] = useState(null);
  const rows = Object.values(state.suppliers)
    .filter((s) => !s.archived)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  async function onEdit(row, changes) {
    setErr(null);
    const payload = row ? { ...row, ...changes } : { id: uid(), ...changes };
    if (!String(payload.name || '').trim()) return setErr('Сначала впишите название поставщика.');
    try {
      await record('supplier.upsert', payload);
    } catch (e) {
      setErr(e.message);
    }
  }
  return (
    <Section title={`Поставщики (${rows.length})`}>
      {err && <Message kind="error">{err}</Message>}
      <Grid
        rows={rows}
        onEdit={onEdit}
        columns={[
          { key: 'name', title: 'Название', width: 240, editable: true },
          { key: 'contact', title: 'Контакт: телефон, Telegram', width: 240, editable: true },
          { key: 'note', title: 'Заметка', width: 280, editable: true },
        ]}
      />
      <p className="muted small">Поставщика можно добавить и прямо при загрузке прайса.</p>
    </Section>
  );
}

// --- одна заявка ---

const TABS = [
  ['lines', 'Заявка'],
  ['compare', 'Цены и распределение'],
  ['orders', 'Заказы'],
  ['lists', 'Прайсы'],
];

function PurchaseView({ pu, tab }) {
  const { state } = useStore();
  const check = purchaseCheck(pu);
  const [title, setTitle] = useState(pu.title);
  const go = (t) => navigate(`/purchase/${pu.id}?tab=${t}`);

  return (
    <>
      <Section
        title={
          <span>
            <a href="#/purchase" className="muted">
              Закупка
            </a>{' '}
            / {pu.title || 'Заявка'}
          </span>
        }
        actions={<span className="tag">{PURCHASE_STATUS[pu.status]}</span>}
      >
        <div className="grid2">
          <label className="field">
            Название заявки
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title.trim() && title !== pu.title && record('purchase.upsert', { id: pu.id, title: title.trim() })}
            />
          </label>
          <div className="pu-stats">
            <span>
              Позиций <b>{check.count}</b>
            </span>
            <span>
              Распределено <b>{check.done}</b> из {check.count}
            </span>
            <span>
              Сумма <b>{fmtMoney(check.total)}</b>
            </span>
          </div>
        </div>
        <div className="seg">
          {TABS.map(([k, label]) => (
            <button key={k} className={`btn small ${tab === k ? 'primary' : ''}`} onClick={() => go(k)}>
              {label}
            </button>
          ))}
        </div>
      </Section>
      {tab === 'lines' && <LinesTab pu={pu} />}
      {tab === 'compare' && <CompareTab pu={pu} check={check} />}
      {tab === 'orders' && <OrdersTab pu={pu} check={check} />}
      {tab === 'lists' && <ListsTab pu={pu} state={state} />}
    </>
  );
}

// Заявка: что и сколько нужно.
function LinesTab({ pu }) {
  const { state } = useStore();
  const [view, setView] = useView('purchase-lines');
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(null);
  const locked = pu.status !== 'collect';
  const lines = purchaseLines(pu);

  // Новая строка сама привязывается к каталогу, если артикул или название совпали точно.
  function findItem(name, sku) {
    const items = Object.values(state.items).filter((i) => !i.archived);
    const code = normCode(sku);
    return (
      (code && items.find((i) => normCode(i.sku) === code)) ||
      (name && items.find((i) => normName(i.name) === normName(name))) ||
      null
    );
  }

  async function onEdit(row, changes) {
    setErr(null);
    if (locked) return setErr('Заказы уже оформлены. Чтобы менять заявку, верните её к сбору цен.');
    const fixed = { ...changes };
    if ('qty' in fixed) fixed.qty = parseNumber(fixed.qty) ?? 0;
    if ('name' in fixed) fixed.name = String(fixed.name).trim();
    if (row) {
      // Название и артикул привязанной позиции меняются в каталоге, здесь только количество и заметка.
      if (row.itemId && ('name' in fixed || 'sku' in fixed))
        return setErr('Позиция привязана к каталогу: название и артикул меняются в каталоге.');
      return record('purchase.line', { purchaseId: pu.id, id: row.id, ...fixed });
    }
    if (!fixed.name && !fixed.sku) return setErr('Для новой строки впишите название или артикул.');
    const item = findItem(fixed.name, fixed.sku);
    await record('purchase.line', {
      purchaseId: pu.id,
      id: uid(),
      qty: 1,
      unitName: item?.unitName || 'шт',
      ...fixed,
      ...(item ? { itemId: item.id, name: item.name, sku: item.sku || '' } : {}),
    });
  }

  async function addItem(it) {
    if (lines.some((l) => l.itemId === it.id)) return setErr(`«${it.name}» уже есть в заявке.`);
    await record('purchase.line', {
      purchaseId: pu.id,
      id: uid(),
      itemId: it.id,
      name: it.name,
      sku: it.sku || '',
      unitName: it.unitName || 'шт',
      qty: 1,
    });
  }

  async function addLow() {
    const have = new Set(lines.map((l) => l.itemId).filter(Boolean));
    const low = lowStock(state).filter((l) => !have.has(l.item.id));
    if (!low.length) return setErr('Всё, что ниже минимального остатка, уже в заявке (или такого нет).');
    await recordMany(
      low.map(({ item, total }) => ({
        kind: 'purchase.line',
        payload: {
          purchaseId: pu.id,
          id: uid(),
          itemId: item.id,
          name: item.name,
          sku: item.sku || '',
          unitName: item.unitName || 'шт',
          qty: Math.max(1, Number(item.minQty) - total),
        },
      })),
    );
  }

  const totals = useMemo(() => itemTotals(state), [state]);
  const rows = lines.map((l) => ({
    ...l,
    name: lineName(state, l),
    sku: lineSku(state, l),
    stock: l.itemId ? totals[l.itemId]?.total ?? 0 : null,
  }));

  return (
    <Section title={`Что нужно купить (${lines.length})`} actions={<ViewSwitch view={view} setView={setView} />}>
      {locked && <Message kind="warn">Заказы оформлены, заявка закрыта для правки.</Message>}
      {err && <Message kind="error">{err}</Message>}
      {!locked && (
        <div className="grid2">
          <ItemPicker onPick={addItem} placeholder="Добавить из каталога: название или артикул" />
          <div className="row">
            <button className="btn" onClick={addLow}>
              Добавить всё, что ниже минимума
            </button>
          </div>
        </div>
      )}
      {view === 'table' ? (
        <>
          <Grid
            rows={rows}
            newRow={!locked}
            onEdit={onEdit}
            onOpen={(r) => setOpen(r.id)}
            columns={[
              { key: 'name', title: 'Наименование', width: 300, editable: !locked },
              { key: 'sku', title: 'Артикул', width: 140, editable: !locked },
              { key: 'qty', title: 'Нужно', width: 80, align: 'right', editable: !locked },
              { key: 'unitName', title: 'Ед.', width: 60, editable: !locked },
              { key: 'stock', title: 'Сейчас есть', width: 100, align: 'right', value: (r) => (r.stock == null ? '' : r.stock) },
              { key: 'catalog', title: 'Каталог', width: 90, value: (r) => (r.itemId ? 'есть' : 'нет') },
              { key: 'note', title: 'Заметка', width: 220, editable: !locked },
            ]}
          />
          <p className="muted small">
            Можно вставить список из Excel (Ctrl+V): наименование, артикул, количество. Двойной щелчок по колонке «Каталог»
            открывает строку: привязать к каталогу или удалить.
          </p>
        </>
      ) : (
        <ul className="list">
          {rows.map((r) => (
            <li key={r.id} className="line">
              <button className="list-btn grow" onClick={() => setOpen(r.id)}>
                <span className="grow">
                  <b>{r.name}</b>
                  <span className="muted block small">
                    {[r.sku, r.stock != null && `сейчас есть ${r.stock}`].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
              <input
                className="qty"
                inputMode="decimal"
                disabled={locked}
                defaultValue={r.qty}
                onBlur={(e) => Number(e.target.value) !== r.qty && onEdit(r, { qty: e.target.value })}
              />
              <span className="muted">{r.unitName}</span>
            </li>
          ))}
        </ul>
      )}
      {open && pu.lines[open] && <LinePanel pu={pu} line={pu.lines[open]} onClose={() => setOpen(null)} />}
    </Section>
  );
}

// Строка заявки: привязка к каталогу, история цен, удаление.
function LinePanel({ pu, line, onClose }) {
  const { state } = useStore();
  const locked = pu.status !== 'collect';
  const item = line.itemId && state.items[line.itemId];
  const offers = Object.entries(pu.offers[line.id] || {});
  return (
    <div className="subcard">
      <div className="card-head">
        <h3>{lineName(state, line)}</h3>
        <button className="btn ghost small" onClick={onClose}>
          Закрыть
        </button>
      </div>
      <p className="muted small">
        {item ? `В каталоге: ${item.name}${item.sku ? ` · ${item.sku}` : ''}` : 'Не привязана к каталогу.'} Привязка нужна,
        чтобы программа запомнила названия этой позиции у поставщиков.
      </p>
      {!locked && (
        <ItemPicker
          placeholder={item ? 'Привязать к другой позиции каталога' : 'Привязать к позиции каталога'}
          onPick={(it) =>
            record('purchase.line', {
              purchaseId: pu.id,
              id: line.id,
              itemId: it.id,
              name: it.name,
              sku: it.sku || '',
              unitName: it.unitName || line.unitName,
            })
          }
        />
      )}
      <h3>История цен</h3>
      {!offers.length && <p className="muted">Цен по этой позиции ещё нет.</p>}
      {offers.map(([sid, o]) => (
        <div key={sid}>
          <b>{state.suppliers[sid]?.name || '?'}</b>
          <ul className="list small">
            {[...(o.history || []), o].reverse().map((h, i) => (
              <li key={i} className={i === 0 ? '' : 'muted'}>
                {dateOnly(h.at)} · {h.withdrawn ? 'нет в новом прайсе' : `${fmtMoney(h.price)}${h.qty != null ? `, есть ${fmtN(h.qty)}` : ''}`} ·{' '}
                {OFFER_SOURCES[h.source] || h.source}
                {h.fileName ? ` (${h.fileName})` : ''}
                {i === 0 && ' · действует'}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {!locked && (
        <div className="row">
          <button
            className="btn danger small"
            onClick={() =>
              confirm(`Удалить «${lineName(state, line)}» из заявки?`) &&
              record('purchase.line', { purchaseId: pu.id, id: line.id, deleted: true }).then(onClose)
            }
          >
            Удалить строку
          </button>
        </div>
      )}
    </div>
  );
}

// Сравнение цен и распределение количества.
function CompareTab({ pu, check }) {
  const { state } = useStore();
  const [view, setView] = useView('purchase-compare');
  const [panel, setPanel] = useState(null); // 'import' | { quick: { lineId, supplierId } }
  const [msg, setMsg] = useState(null);
  const [open, setOpen] = useState(null);
  const locked = pu.status !== 'collect';
  const suppliers = purchaseSuppliers(state, pu);
  const lines = purchaseLines(pu);
  const supName = (id) => state.suppliers[id]?.name || '?';

  const done = (text) => {
    setPanel(null);
    if (text) setMsg({ kind: 'ok', text });
  };

  async function auto(all) {
    if (all && !confirm('Распределить всё заново по лучшей цене? Ручное распределение будет заменено.')) return;
    const changes = autoAllocate(pu, { all });
    if (!changes.length) return setMsg({ kind: 'info', text: 'Нечего распределять: нет новых цен или всё уже распределено.' });
    await recordMany(changes.map((c) => ({ kind: 'alloc.set', payload: { purchaseId: pu.id, ...c } })));
    setMsg({ kind: 'ok', text: `Распределено по лучшей цене. Проверьте строки, отмеченные красным.` });
  }

  async function setAlloc(line, supplierId, text) {
    const qty = parseNumber(text) ?? 0;
    const o = pu.offers[line.id]?.[supplierId];
    if (qty > 0 && (!o || o.withdrawn)) return setMsg({ kind: 'error', text: `У «${supName(supplierId)}» нет цены на эту позицию.` });
    await record('alloc.set', { purchaseId: pu.id, lineId: line.id, supplierId, qty, price: o?.price ?? null });
  }

  async function setPrice(line, supplierId, text) {
    const price = parseNumber(text);
    const rows =
      price == null ? [{ lineId: line.id, remove: true }] : [{ lineId: line.id, price, qty: pu.offers[line.id]?.[supplierId]?.qty ?? null }];
    await record('offer.list', { purchaseId: pu.id, supplierId, source: 'manual', rows });
  }

  async function onEdit(row, changes) {
    setMsg(null);
    if (!row) return;
    if (locked) return setMsg({ kind: 'warn', text: 'Заказы уже оформлены. Чтобы менять, верните заявку к сбору цен.' });
    for (const [k, v] of Object.entries(changes)) {
      const [kind, sid] = k.split(':');
      if (kind === 'a') await setAlloc(row.line, sid, v);
      if (kind === 'p') await setPrice(row.line, sid, v);
      if (k === 'need') await record('purchase.line', { purchaseId: pu.id, id: row.id, qty: parseNumber(v) ?? 0 });
    }
  }

  async function order() {
    await record('purchase.upsert', { id: pu.id, status: 'ordered' });
    navigate(`/purchase/${pu.id}?tab=orders`);
  }

  async function exportCompare() {
    const head = ['Наименование', 'Артикул', 'Нужно', ...suppliers.flatMap((s) => [`${s.name}: цена`, `${s.name}: есть`, `${s.name}: берём`]), 'Сумма'];
    const data = [head.map((value) => ({ value, fontWeight: 'bold' }))];
    for (const l of lines) {
      const st = lineStatus(pu, l);
      const cells = [lineName(state, l), lineSku(state, l), l.qty];
      for (const s of suppliers) {
        const o = pu.offers[l.id]?.[s.id];
        const live = o && !o.withdrawn;
        const best = st.best && st.best.supplierId === s.id;
        cells.push(live ? { value: o.price, backgroundColor: best ? '#C6EFCE' : undefined } : null, live ? o.qty : null, pu.alloc[l.id]?.[s.id]?.qty || null);
      }
      cells.push(st.sum || null);
      data.push(cells);
    }
    await downloadXlsx(`Сравнение цен ${pu.title}.xlsx`, [
      { sheet: 'Сравнение', data, columns: [{ width: 40 }, { width: 16 }, { width: 8 }, ...suppliers.flatMap(() => [{ width: 12 }, { width: 8 }, { width: 8 }]), { width: 12 }] },
    ]);
  }

  const rows = lines.map((l) => {
    const st = lineStatus(pu, l);
    return { id: l.id, line: l, st, name: lineName(state, l), sku: lineSku(state, l) };
  });

  const columns = [
    { key: 'name', title: 'Наименование', width: 260 },
    { key: 'need', title: 'Нужно', width: 70, align: 'right', editable: !locked, value: (r) => r.line.qty },
    ...suppliers.flatMap((s) => [
      {
        key: `p:${s.id}`,
        title: `${s.name}, ₽`,
        width: 130,
        align: 'right',
        editable: !locked,
        value: (r) => {
          const o = pu.offers[r.id]?.[s.id];
          return o && !o.withdrawn ? o.price : '';
        },
        render: (r) => <PriceCell o={pu.offers[r.id]?.[s.id]} best={r.st.best?.supplierId === s.id} />,
      },
      {
        key: `a:${s.id}`,
        title: 'беру',
        width: 64,
        align: 'right',
        editable: !locked,
        value: (r) => pu.alloc[r.id]?.[s.id]?.qty || '',
        render: (r) => {
          const a = pu.alloc[r.id]?.[s.id];
          if (!a) return '';
          const bad = r.st.problems.some((p) => p.supplierId === s.id);
          return <b className={bad ? 'warn-text' : ''}>{fmtN(a.qty)}</b>;
        },
      },
    ]),
    {
      key: 'left',
      title: 'Осталось',
      width: 90,
      align: 'right',
      value: (r) => r.st.remaining,
      render: (r) =>
        Math.abs(r.st.remaining) < 1e-9 ? (
          <span className="ok-text">✓</span>
        ) : (
          <b className="warn-text">{r.st.remaining > 0 ? fmtN(r.st.remaining) : `лишние ${fmtN(-r.st.remaining)}`}</b>
        ),
    },
    { key: 'sum', title: 'Сумма', width: 110, align: 'right', value: (r) => r.st.sum, render: (r) => (r.st.sum ? fmtMoney(r.st.sum) : '') },
  ];

  return (
    <>
      {panel === 'import' && <PriceImport pu={pu} onDone={done} />}
      {panel?.quick && <QuickOffer pu={pu} {...panel.quick} onDone={done} />}
      <Section
        title="Цены и распределение"
        actions={
          <div className="row">
            <ViewSwitch view={view} setView={setView} />
          </div>
        }
      >
        {!locked && (
          <div className="seg">
            <button className="btn primary small" onClick={() => setPanel('import')}>
              Загрузить прайс
            </button>
            <button className="btn small" onClick={() => setPanel({ quick: {} })}>
              Цена из сообщения
            </button>
            <button className="btn small" onClick={() => auto(false)}>
              Распределить по лучшей цене
            </button>
            <button className="btn small" onClick={() => auto(true)}>
              Распределить всё заново
            </button>
            <button className="btn ghost small" onClick={exportCompare}>
              Сравнение в Excel
            </button>
          </div>
        )}
        {msg && <Message kind={msg.kind}>{msg.text}</Message>}
        {!lines.length && (
          <Message kind="warn">
            В заявке пока нет позиций. <a href={`#/purchase/${pu.id}?tab=lines`}>Добавьте их</a>, потом загружайте прайсы.
          </Message>
        )}
        {lines.length > 0 && !suppliers.length && (
          <p className="muted">Цен пока нет. Загрузите прайс или внесите цену из сообщения.</p>
        )}
        {lines.length > 0 &&
          suppliers.length > 0 &&
          (view === 'table' ? (
            <>
              <Grid rows={rows} newRow={false} columns={columns} onEdit={onEdit} onOpen={(r) => setOpen(r.id)} />
              <p className="muted small">
                Зелёным отмечена лучшая цена среди тех, у кого товар есть. В колонку «беру» впишите, сколько штук брать у
                этого поставщика. Цену можно вписать прямо в ячейку, если её сообщили по телефону. Двойной щелчок по
                названию показывает историю цен.
              </p>
            </>
          ) : (
            <ul className="list">
              {rows.map((r) => (
                <CompareCard key={r.id} pu={pu} row={r} locked={locked} supName={supName} setAlloc={setAlloc} onOpen={() => setOpen(r.id)} />
              ))}
            </ul>
          ))}
        {open && pu.lines[open] && <LinePanel pu={pu} line={pu.lines[open]} onClose={() => setOpen(null)} />}
      </Section>
      <CheckBlock pu={pu} check={check} supName={supName} lines={lines} onOrder={order} />
    </>
  );
}

function PriceCell({ o, best }) {
  if (!o) return '';
  if (o.withdrawn) return <span className="muted small">нет в прайсе</span>;
  const t = priceTrend(o);
  const none = o.qty != null && o.qty <= 0;
  return (
    <span className={`price-cell ${best ? 'best' : ''} ${none ? 'none' : ''}`} title={t ? `было ${fmtN(t.was)}, стало ${fmtN(t.now)}` : ''}>
      {t && <span className={t.delta < 0 ? 'ok-text' : 'warn-text'}>{t.delta < 0 ? '↓' : '↑'}</span>}
      {fmtN(o.price)}
      <span className="muted small"> {o.qty == null ? '' : none ? 'нет' : `есть ${fmtN(o.qty)}`}</span>
    </span>
  );
}

function CompareCard({ pu, row, locked, supName, setAlloc, onOpen }) {
  const offers = lineOffers(pu, row.id);
  const allocs = lineAlloc(pu, row.id);
  const ids = [...new Set([...offers.map((o) => o.supplierId), ...allocs.map((a) => a.supplierId)])];
  return (
    <li className="subcard">
      <button className="list-btn" onClick={onOpen}>
        <span className="grow">
          <b>{row.name}</b>
          <span className="muted block small">
            нужно {fmtN(row.line.qty)} · {Math.abs(row.st.remaining) < 1e-9 ? 'распределено' : row.st.remaining > 0 ? `осталось ${fmtN(row.st.remaining)}` : `лишние ${fmtN(-row.st.remaining)}`}
            {row.st.sum ? ` · ${fmtMoney(row.st.sum)}` : ''}
          </span>
        </span>
      </button>
      {!ids.length && <p className="muted small">Цен нет.</p>}
      {ids.map((sid) => {
        const o = pu.offers[row.id]?.[sid];
        return (
          <div key={sid} className="line">
            <span className="grow">
              {supName(sid)}: <PriceCell o={o} best={row.st.best?.supplierId === sid} />
            </span>
            <input
              className="qty"
              inputMode="decimal"
              placeholder="беру"
              disabled={locked}
              defaultValue={pu.alloc[row.id]?.[sid]?.qty || ''}
              onBlur={(e) => String(pu.alloc[row.id]?.[sid]?.qty || '') !== e.target.value && setAlloc(row.line, sid, e.target.value)}
            />
          </div>
        );
      })}
    </li>
  );
}

// Проверка перед оформлением: что не распределено, где перебор, кто поменял цену.
function CheckBlock({ pu, check, supName, lines, onOrder }) {
  const { state } = useStore();
  const name = (id) => lineName(state, pu.lines[id] || {});
  if (!lines.length) return null;
  return (
    <Section title="Проверка">
      {check.ok ? (
        <Message kind="ok">
          Всё распределено. Итого {fmtMoney(check.total)} у {purchaseOrders(state, pu).length} поставщиков.
        </Message>
      ) : (
        <Message kind="warn">
          Распределено {check.done} из {check.count} позиций. Заказы можно оформить, когда всё сойдётся.
        </Message>
      )}
      {check.problems.length > 0 && (
        <ul className="list small">
          {check.problems.slice(0, 50).map((p, i) => (
            <li key={i} className="warn-text">
              {name(p.lineId)}: {PROBLEM_TEXT[p.kind](p, supName(p.supplierId))}
            </li>
          ))}
        </ul>
      )}
      {check.warnings.length > 0 && (
        <ul className="list small">
          {check.warnings.map((w, i) => (
            <li key={i}>
              {name(w.lineId)}: {PROBLEM_TEXT[w.kind](w, supName(w.supplierId))}
            </li>
          ))}
        </ul>
      )}
      {pu.status === 'collect' ? (
        <button className="btn primary" disabled={!check.ok} onClick={onOrder}>
          Оформить заказы
        </button>
      ) : (
        <p className="muted small">Заказы оформлены {fmtDate(pu.statusAt)}.</p>
      )}
    </Section>
  );
}

// Заказы по поставщикам.
function OrdersTab({ pu, check }) {
  const { state } = useStore();
  const orders = purchaseOrders(state, pu);
  const [copied, setCopied] = useState(null);

  function sheetFor(o) {
    const head = ['№', 'Наименование', 'Артикул', 'У поставщика', 'Кол-во', 'Ед.', 'Цена, ₽', 'Сумма, ₽'];
    const data = [
      [{ value: `Заказ: ${o.supplier.name}`, fontWeight: 'bold' }],
      [`${pu.title}, ${new Date().toLocaleDateString('ru-RU')}`],
      [],
      head.map((value) => ({ value, fontWeight: 'bold' })),
      ...o.rows.map((r, i) => [i + 1, r.name, r.sku, [r.supName, r.supCode].filter(Boolean).join(' · '), r.qty, r.unitName, r.price, r.sum]),
      [null, { value: 'Итого', fontWeight: 'bold' }, null, null, null, null, null, { value: o.total, fontWeight: 'bold' }],
    ];
    return { sheet: o.supplier.name, data, columns: [{ width: 5 }, { width: 40 }, { width: 16 }, { width: 30 }, { width: 8 }, { width: 6 }, { width: 12 }, { width: 14 }] };
  }

  function copyText(o) {
    const text = [
      `Заказ: ${pu.title}`,
      ...o.rows.map((r, i) => `${i + 1}. ${r.name}${r.sku ? ` (${r.sku})` : ''} — ${fmtN(r.qty)} ${r.unitName} × ${fmtN(r.price)} ₽`),
      `Итого: ${fmtN(o.total)} ₽`,
    ].join('\n');
    navigator.clipboard?.writeText(text).then(() => setCopied(o.supplierId), () => alert(text));
  }

  async function setStatus(status) {
    await record('purchase.upsert', { id: pu.id, status });
  }

  return (
    <>
      <Section title={`Заказы (${orders.length})`}>
        {pu.status === 'collect' && (
          <Message kind={check.ok ? 'info' : 'warn'}>
            {check.ok
              ? 'Всё распределено. Оформите заказы на вкладке «Цены и распределение», чтобы зафиксировать их.'
              : `Это предварительные заказы: распределено ${check.done} из ${check.count} позиций.`}
          </Message>
        )}
        {!orders.length && <p className="muted">Пока ничего не распределено.</p>}
        {orders.length > 0 && (
          <div className="row">
            <b className="grow">Итого: {fmtMoney(orders.reduce((s, o) => s + o.total, 0))}</b>
            <button className="btn" onClick={() => downloadXlsx(`Заказы ${pu.title}.xlsx`, orders.map(sheetFor))}>
              Все заказы в Excel
            </button>
          </div>
        )}
        <div className="row">
          {pu.status === 'ordered' && (
            <>
              <button className="btn small" onClick={() => setStatus('collect')}>
                Вернуть к сбору цен
              </button>
              <button className="btn small" onClick={() => setStatus('closed')}>
                Закрыть заявку
              </button>
            </>
          )}
          {pu.status === 'closed' && (
            <button className="btn small" onClick={() => setStatus('ordered')}>
              Открыть заявку снова
            </button>
          )}
        </div>
      </Section>
      {orders.map((o) => (
        <Section
          key={o.supplierId}
          title={`${o.supplier.name} · ${fmtMoney(o.total)}`}
          actions={
            <div className="row">
              <button className="btn small" onClick={() => copyText(o)}>
                {copied === o.supplierId ? 'Скопировано' : 'Копировать текстом'}
              </button>
              <button className="btn small" onClick={() => downloadXlsx(`Заказ ${o.supplier.name} ${dateOnly(new Date().toISOString())}.xlsx`, [sheetFor(o)])}>
                Excel
              </button>
            </div>
          }
        >
          {o.supplier.contact && <p className="muted small">{o.supplier.contact}</p>}
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Наименование</th>
                  <th>У поставщика</th>
                  <th className="num">Кол-во</th>
                  <th className="num">Цена</th>
                  <th className="num">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {o.rows.map((r) => (
                  <tr key={r.lineId}>
                    <td>
                      {r.name}
                      {r.sku && <div className="muted small">{r.sku}</div>}
                    </td>
                    <td className="muted small">{[r.supName, r.supCode].filter(Boolean).join(' · ')}</td>
                    <td className="num">
                      {fmtN(r.qty)} {r.unitName}
                    </td>
                    <td className="num">{fmtMoney(r.price)}</td>
                    <td className="num">{fmtMoney(r.sum)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ))}
    </>
  );
}

// Все загруженные прайсы и сообщения по порядку.
function ListsTab({ pu, state }) {
  const lists = [...pu.lists].reverse();
  return (
    <Section title={`Загруженные прайсы и цены (${lists.length})`}>
      {!lists.length && <p className="muted">Пока ничего не загружено.</p>}
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Дата прайса</th>
              <th>Поставщик</th>
              <th>Откуда</th>
              <th className="num">Цен</th>
              <th>Кто загрузил</th>
            </tr>
          </thead>
          <tbody>
            {lists.map((l) => (
              <tr key={l.id}>
                <td>{dateOnly(l.at)}</td>
                <td>{state.suppliers[l.supplierId]?.name || '?'}</td>
                <td>
                  {OFFER_SOURCES[l.source] || l.source}
                  {l.fileName && <div className="muted small">{l.fileName}</div>}
                  {l.full && <div className="muted small">заменил прежний прайс</div>}
                  {l.note && <div className="muted small">«{l.note.slice(0, 120)}»</div>}
                </td>
                <td className="num">{l.count}</td>
                <td className="muted small">
                  {l.userName}, {fmtDate(l.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
