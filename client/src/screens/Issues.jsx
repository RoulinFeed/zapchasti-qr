import { useState } from 'react';
import { useStore, record, canManage } from '../store.js';
import { ISSUE_KINDS, MOVE_TYPES, openIssues } from '../../../shared/state.js';
import { Section, Message, fmtDate, locLabel, unitLabel } from '../ui.jsx';

// Где учёт сейчас не сходится: отрицательные остатки и поштучные детали в двух местах.
function currentProblems(state) {
  const res = [];
  for (const [unit, row] of Object.entries(state.stock)) {
    const tracking = state.items[state.units[unit]?.itemId]?.tracking;
    const places = Object.entries(row).filter(([, q]) => q > 1e-9);
    for (const [loc, qty] of Object.entries(row)) {
      if (qty < -1e-9) res.push({ unit, text: `минус ${Math.abs(qty)} на «${locLabel(state, loc)}»`, loc });
    }
    if (tracking === 'piece' && places.length > 1)
      res.push({ unit, text: `числится сразу: ${places.map(([l]) => locLabel(state, l)).join(', ')}` });
  }
  return res;
}

function IssueRow({ issue, state, manage }) {
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  return (
    <li className="pad">
      <a href={`#/scan?code=${issue.unit}`}>{unitLabel(state, issue.unit)}</a>{' '}
      <span className="muted small">{issue.unit}</span>
      <div className="warn-text small">{ISSUE_KINDS[issue.kind]}</div>
      <div className="muted small">
        {MOVE_TYPES[issue.type]}: {locLabel(state, issue.from)} → {locLabel(state, issue.to)}, {issue.qty} ·{' '}
        {issue.userName || ''} · {fmtDate(issue.createdAt)}
      </div>
      {manage &&
        (open ? (
          <div className="row">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Что выяснили (необязательно)" />
            <button className="btn primary small" onClick={() => record('issue.resolve', { moveId: issue.moveId, note: note.trim() })}>
              Готово
            </button>
          </div>
        ) : (
          <button className="btn ghost small" onClick={() => setOpen(true)}>
            Разобрались
          </button>
        ))}
    </li>
  );
}

export default function Issues() {
  const { state, user } = useStore();
  const manage = canManage(user);
  const issues = openIssues(state).slice().reverse();
  const problems = currentProblems(state);
  return (
    <>
      <Section title={`Сейчас не сходится (${problems.length})`}>
        {problems.length === 0 ? (
          <p className="muted">Остатки сходятся.</p>
        ) : (
          <>
            <ul className="list">
              {problems.map((p, i) => (
                <li key={i} className="pad">
                  <a href={`#/scan?code=${p.unit}`}>{unitLabel(state, p.unit)}</a>{' '}
                  <span className="muted small">{p.unit}</span>
                  <div className="warn-text small">{p.text}</div>
                </li>
              ))}
            </ul>
            <Message>
              Проще всего поправить через инвентаризацию: пересчитайте место, и учёт выровняется по факту.
            </Message>
          </>
        )}
      </Section>
      <Section title={`Нестыковки в операциях (${issues.length})`}>
        <p className="muted small">
          Так бывает, когда люди работают без связи и не видят действий друг друга. Выясните, где деталь на самом деле, поправьте
          учёт и отметьте, что разобрались.
        </p>
        {issues.length === 0 && <p className="muted">Нестыковок нет.</p>}
        <ul className="list">
          {issues.map((i) => (
            <IssueRow key={i.moveId + i.kind} issue={i} state={state} manage={manage} />
          ))}
        </ul>
      </Section>
    </>
  );
}
