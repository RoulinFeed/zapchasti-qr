import { MOVE_TYPES, CONDITIONS } from '../../shared/state.js';
import { fmtQty, kindName, locLabel } from './ui.jsx';
import { Thumb } from './photo.jsx';

const DAY = 24 * 60 * 60 * 1000;

function dayKey(iso) {
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dayTitle(key) {
  const today = dayKey(new Date().toISOString());
  if (key === today) return 'Сегодня';
  if (key === today - DAY) return 'Вчера';
  const d = new Date(key);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) });
}

function time(iso) {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function Place({ state, code }) {
  if (!code) return <span className="place muted">—</span>;
  const l = state.locations[code];
  return (
    <span className="place">
      {l && <span className="place-kind">{kindName(l.kind)}</span>}
      <span className="place-name">{locLabel(state, code)}</span>
    </span>
  );
}

// Одна запись журнала: что за операция, какая деталь, откуда и куда, сколько, кто и когда.
export function MoveCard({ state, m, children }) {
  const unit = state.units[m.unit];
  const item = unit && state.items[unit.itemId];
  const details = [
    m.hours ? `моточасы ${m.hours}` : null,
    m.condition ? CONDITIONS[m.condition] : null,
    m.corrects ? 'исправленная запись' : null,
    m.seq == null ? 'не отправлено' : null,
  ].filter(Boolean);
  return (
    <li className={`move ${m.voided ? 'voided' : ''}`}>
      <div className="move-head">
        <span className={`tag tag-${m.type}`}>{MOVE_TYPES[m.type] || m.type}</span>
        <span className="muted small">
          {time(m.createdAt)} · {m.userName || '—'}
        </span>
      </div>
      <div className="move-body">
        <Thumb id={item?.photo} />
        <div className="grow">
          <a className="move-item" href={`#/scan?code=${m.unit}`}>
            {item?.name || m.unit}
          </a>
          <span className="muted small"> {m.unit}</span>
          <div className="move-route">
            <Place state={state} code={m.from} />
            <span className="arrow">→</span>
            <Place state={state} code={m.to} />
          </div>
        </div>
        <b className="move-qty">{fmtQty(m.qty, item)}</b>
      </div>
      {(details.length > 0 || m.comment) && (
        <div className="move-foot small">
          {details.length > 0 && <span className="muted">{details.join(' · ')}</span>}
          {m.comment && <span className="comment">«{m.comment}»</span>}
        </div>
      )}
      {m.voided && (
        <div className="voided-note small">
          Отменено: {m.voided.reason} · {m.voided.userName}
        </div>
      )}
      {children}
    </li>
  );
}

// Журнал, разбитый по дням, новые записи сверху.
export function MoveList({ state, moves, empty = 'Движений нет.', renderExtra }) {
  if (!moves.length) return <p className="muted">{empty}</p>;
  const groups = [];
  for (const m of [...moves].reverse()) {
    const key = dayKey(m.createdAt);
    if (!groups.length || groups.at(-1).key !== key) groups.push({ key, moves: [] });
    groups.at(-1).moves.push(m);
  }
  return groups.map((g) => (
    <div key={g.key} className="day">
      <div className="day-title">{dayTitle(g.key)}</div>
      <ul className="list moves">
        {g.moves.map((m) => (
          <MoveCard key={m.id} state={state} m={m}>
            {renderExtra?.(m)}
          </MoveCard>
        ))}
      </ul>
    </div>
  ));
}
