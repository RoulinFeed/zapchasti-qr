import { useMemo, useState } from 'react';
import { LOCATION_KINDS, CONDITIONS, MOVE_TYPES } from '../../shared/state.js';
import { useStore } from './store.js';
import { Thumb } from './photo.jsx';

export function navigate(path) {
  window.location.hash = path;
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtQty(q, item) {
  const n = Number.isInteger(q) ? q : Math.round(q * 1000) / 1000;
  return `${n} ${item?.unitName || 'шт'}`;
}

export function locLabel(state, code) {
  if (!code) return '—';
  const l = state.locations[code];
  return l ? `${l.name}` : code;
}

export function unitLabel(state, code) {
  const u = state.units[code];
  const it = u && state.items[u.itemId];
  return it ? it.name : code;
}

export function kindName(kind) {
  return LOCATION_KINDS[kind] || kind;
}

export function moveText(state, m) {
  const t = MOVE_TYPES[m.type] || m.type;
  return `${t}: ${locLabel(state, m.from)} → ${locLabel(state, m.to)}`;
}

export { CONDITIONS };

export function Section({ title, children, actions }) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Message({ kind = 'info', children }) {
  return <div className={`msg msg-${kind}`}>{children}</div>;
}

// Поиск позиции каталога по названию, артикулу или модели.
export function ItemPicker({ onPick, placeholder = 'Найти позицию: название или артикул' }) {
  const items = useStore((s) => s.state.items);
  const [q, setQ] = useState('');
  const found = useMemo(() => searchItems(items, q).slice(0, 30), [items, q]);
  return (
    <div className="picker">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      {q && (
        <ul className="list">
          {found.map((it) => (
            <li key={it.id}>
              <button className="list-btn row-btn" onClick={() => (onPick(it), setQ(''))}>
                <Thumb id={it.photo} />
                <span className="grow">
                  <b>{it.name}</b>
                  <span className="muted block">
                    {[it.sku, it.manufacturer, it.tracking === 'batch' ? 'партией' : 'поштучно']
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {!found.length && <li className="muted pad">Ничего не найдено</li>}
        </ul>
      )}
    </div>
  );
}

export function searchItems(items, q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return Object.values(items)
    .filter((it) => !it.archived)
    .filter((it) => {
      const hay = [it.name, it.sku, it.manufacturer, it.models].join(' ').toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export function LocationSelect({ value, onChange, kinds, placeholder = 'Выберите место' }) {
  const locations = useStore((s) => s.state.locations);
  const list = Object.values(locations)
    .filter((l) => !l.archived && (!kinds || kinds.includes(l.kind)))
    .sort((a, b) => (a.kind + a.name).localeCompare(b.kind + b.name, 'ru'));
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{placeholder}</option>
      {list.map((l) => (
        <option key={l.code} value={l.code}>
          {kindName(l.kind)}: {l.name}
        </option>
      ))}
    </select>
  );
}
