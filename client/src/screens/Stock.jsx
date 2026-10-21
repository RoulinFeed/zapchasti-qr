import { useMemo, useState } from 'react';
import { useStore } from '../store.js';
import { itemTotals, locationContents, lowStock, LOCATION_KINDS } from '../../../shared/state.js';
import { Section, fmtQty, searchItems, kindName, navigate } from '../ui.jsx';
import { Grid } from '../Grid.jsx';
import { useView, ViewSwitch } from '../views.jsx';

function ByPlace({ state, view }) {
  if (view === 'table') {
    const rows = Object.values(state.locations)
      .filter((l) => !l.archived)
      .map((l) => {
        const contents = locationContents(state, l.code);
        return {
          ...l,
          id: l.code,
          kindName: kindName(l.kind),
          count: contents.length,
          qty: contents.reduce((s, c) => s + c.qty, 0),
        };
      })
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, 'ru'));
    return (
      <Section title={`Места (${rows.length})`}>
        <Grid
          newRow={false}
          rows={rows}
          onEdit={() => {}}
          onOpen={(r) => navigate(`/scan?code=${r.code}`)}
          columns={[
            { key: 'kindName', title: 'Вид', width: 110 },
            { key: 'name', title: 'Место', width: 240 },
            { key: 'code', title: 'Код', width: 90 },
            { key: 'model', title: 'Модель', width: 140 },
            { key: 'count', title: 'Позиций', width: 90, align: 'right' },
            { key: 'qty', title: 'Штук всего', width: 100, align: 'right' },
          ]}
        />
        <p className="muted small">Двойной щелчок или Enter открывает место со всем содержимым.</p>
      </Section>
    );
  }
  const groups = Object.keys(LOCATION_KINDS).map((kind) => ({
    kind,
    list: Object.values(state.locations)
      .filter((l) => l.kind === kind && !l.archived)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
  }));
  return groups
    .filter((g) => g.list.length)
    .map((g) => (
      <Section key={g.kind} title={LOCATION_KINDS[g.kind]}>
        <ul className="list">
          {g.list.map((l) => {
            const n = locationContents(state, l.code).length;
            return (
              <li key={l.code}>
                <a className="list-btn" href={`#/scan?code=${l.code}`}>
                  <b>{l.name}</b>
                  <span className="muted">{n ? `${n} позиций` : 'пусто'}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </Section>
    ));
}

function ByItem({ state, view }) {
  const [q, setQ] = useState('');
  const totals = useMemo(() => itemTotals(state), [state]);
  const list = searchItems(state.items, q);
  const t = (r) => totals[r.id];
  return (
    <Section title={`Позиции (${list.length})`}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: название, артикул, модель" />
      {view === 'table' ? (
        <Grid
          newRow={false}
          rows={list}
          onEdit={() => {}}
          onOpen={(r) => navigate(`/catalog?id=${r.id}`)}
          rowClass={(r) => (Number(r.minQty) > 0 && t(r).total < Number(r.minQty) ? 'low' : '')}
          columns={[
            { key: 'name', title: 'Позиция', width: 260 },
            { key: 'sku', title: 'Артикул', width: 130 },
            { key: 'wh', title: 'Склады', width: 90, align: 'right', value: (r) => t(r).byKind.warehouse || 0 },
            {
              key: 'van',
              title: 'Газели и люди',
              width: 120,
              align: 'right',
              value: (r) => (t(r).byKind.van || 0) + (t(r).byKind.person || 0),
            },
            {
              key: 'total',
              title: 'Всего',
              width: 100,
              align: 'right',
              value: (r) => t(r).total,
              render: (r) => <b>{fmtQty(t(r).total, r)}</b>,
            },
            { key: 'minQty', title: 'Мин.', width: 70, align: 'right', value: (r) => Number(r.minQty) || '' },
          ]}
        />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Позиция</th>
              <th>Склад</th>
              <th>Газели</th>
              <th>Всего</th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, 300).map((it) => {
              const t = totals[it.id];
              const low = Number(it.minQty) > 0 && t.total < Number(it.minQty);
              return (
                <tr key={it.id} className={low ? 'low' : ''}>
                  <td>
                    <a href={`#/catalog?id=${it.id}`}>{it.name}</a>
                    {it.sku && <div className="muted small">{it.sku}</div>}
                  </td>
                  <td>{t.byKind.warehouse || 0}</td>
                  <td>{(t.byKind.van || 0) + (t.byKind.person || 0)}</td>
                  <td>
                    <b>{fmtQty(t.total, it)}</b>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {view !== 'table' && list.length > 300 && <p className="muted small">Показаны первые 300, уточните поиск.</p>}
    </Section>
  );
}

function Low({ state, view }) {
  const list = lowStock(state);
  return (
    <Section title={`Заканчивается (${list.length})`}>
      {list.length === 0 && <p className="muted">Всё в норме. Минимальный остаток задаётся в каталоге.</p>}
      {view === 'table' && list.length > 0 ? (
        <Grid
          newRow={false}
          rows={list.map((x) => ({ ...x, id: x.item.id }))}
          onEdit={() => {}}
          onOpen={(r) => navigate(`/catalog?id=${r.id}`)}
          columns={[
            { key: 'name', title: 'Позиция', width: 260, value: (r) => r.item.name },
            { key: 'sku', title: 'Артикул', width: 130, value: (r) => r.item.sku },
            { key: 'total', title: 'Есть', width: 80, align: 'right' },
            { key: 'min', title: 'Минимум', width: 90, align: 'right', value: (r) => Number(r.item.minQty) },
            {
              key: 'buy',
              title: 'Докупить',
              width: 90,
              align: 'right',
              value: (r) => Number(r.item.minQty) - r.total,
            },
            { key: 'unit', title: 'Ед.', width: 60, value: (r) => r.item.unitName },
          ]}
        />
      ) : (
        <ul className="list">
          {list.map(({ item, total }) => (
            <li key={item.id} className="pad">
              <a href={`#/catalog?id=${item.id}`}>{item.name}</a>
              <div className="muted small">
                есть {fmtQty(total, item)}, минимум {item.minQty}, докупить {Number(item.minQty) - total}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export default function Stock({ params }) {
  const { state } = useStore();
  const [tab, setTab] = useState(params.tab || 'places');
  const [view, setView] = useView('stock');
  const tabs = { places: 'По местам', items: 'По позициям', low: 'Заканчивается' };
  return (
    <>
      <div className="seg tabs">
        {Object.entries(tabs).map(([k, v]) => (
          <button key={k} className={`btn ${tab === k ? 'primary' : ''}`} onClick={() => setTab(k)}>
            {v}
          </button>
        ))}
        <span className="grow" />
        <ViewSwitch view={view} setView={setView} />
      </div>
      {tab === 'places' && <ByPlace state={state} view={view} />}
      {tab === 'items' && <ByItem state={state} view={view} />}
      {tab === 'low' && <Low state={state} view={view} />}
    </>
  );
}
