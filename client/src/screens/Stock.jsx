import { useMemo, useState } from 'react';
import { useStore } from '../store.js';
import { itemTotals, locationContents, lowStock, LOCATION_KINDS } from '../../../shared/state.js';
import { Section, fmtQty, searchItems } from '../ui.jsx';

function ByPlace({ state }) {
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

function ByItem({ state }) {
  const [q, setQ] = useState('');
  const totals = useMemo(() => itemTotals(state), [state]);
  const list = searchItems(state.items, q);
  return (
    <Section title={`Позиции (${list.length})`}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: название, артикул, модель" />
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
      {list.length > 300 && <p className="muted small">Показаны первые 300, уточните поиск.</p>}
    </Section>
  );
}

function Low({ state }) {
  const list = lowStock(state);
  return (
    <Section title={`Заканчивается (${list.length})`}>
      {list.length === 0 && <p className="muted">Всё в норме. Минимальный остаток задаётся в каталоге.</p>}
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
    </Section>
  );
}

export default function Stock({ params }) {
  const { state } = useStore();
  const [tab, setTab] = useState(params.tab || 'places');
  const tabs = { places: 'По местам', items: 'По позициям', low: 'Заканчивается' };
  return (
    <>
      <div className="seg tabs">
        {Object.entries(tabs).map(([k, v]) => (
          <button key={k} className={`btn ${tab === k ? 'primary' : ''}`} onClick={() => setTab(k)}>
            {v}
          </button>
        ))}
      </div>
      {tab === 'places' && <ByPlace state={state} />}
      {tab === 'items' && <ByItem state={state} />}
      {tab === 'low' && <Low state={state} />}
    </>
  );
}
