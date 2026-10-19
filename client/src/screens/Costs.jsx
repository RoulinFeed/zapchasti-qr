import { useMemo, useState } from 'react';
import { useStore } from '../store.js';
import { installCosts, stockValue, LOCATION_KINDS } from '../../../shared/state.js';
import { Section, Message, fmtDate, locLabel, unitLabel } from '../ui.jsx';

export function fmtMoney(n) {
  return `${Math.round(n).toLocaleString('ru-RU')} ₽`;
}

function seasonStart() {
  return `${new Date().getFullYear()}-01-01`;
}

export default function Costs() {
  const { state } = useStore();
  const [from, setFrom] = useState(seasonStart);
  const [to, setTo] = useState('');
  const [open, setOpen] = useState(null);
  const costs = useMemo(
    () => installCosts(state, { from: from ? `${from}T00:00:00` : null, to: to ? `${to}T23:59:59.999Z` : null }),
    [state, from, to],
  );
  const value = useMemo(() => stockValue(state), [state]);
  const noPrice = Object.values(state.items).filter((i) => !i.archived && !(Number(i.price) > 0)).length;

  return (
    <>
      <Section title="Затраты на технику">
        <div className="grid2">
          <label className="field">
            С
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            По
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <div className="big-number">{fmtMoney(costs.total)}</div>
        <p className="muted small">Сумма запчастей, поставленных на технику за период, по цене на момент установки.</p>
        {costs.unpriced > 0 && (
          <Message kind="warn">
            У {costs.unpriced} установок нет цены, они посчитаны как 0. Цены задаются в каталоге.
          </Message>
        )}
      </Section>

      <Section title="По технике">
        {costs.byMachine.length === 0 && <p className="muted">За период ничего не ставили.</p>}
        <ul className="list">
          {costs.byMachine.map((m) => (
            <li key={m.code}>
              <button className="list-btn row-btn" onClick={() => setOpen(open === m.code ? null : m.code)}>
                <span className="grow">
                  <b>{locLabel(state, m.code)}</b>
                  <span className="muted small"> · {m.count} уст.</span>
                </span>
                <b>{fmtMoney(m.sum)}</b>
              </button>
              {open === m.code && (
                <ul className="list sub">
                  {m.moves.map((mv) => (
                    <li key={mv.id} className="line small">
                      <span className="grow">
                        {unitLabel(state, mv.unit)}{' '}
                        <span className="muted">
                          · {fmtDate(mv.createdAt)} · {mv.userName}
                        </span>
                      </span>
                      <span>
                        {mv.qty} × {fmtMoney(mv.price)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="По механикам">
        <ul className="list">
          {costs.byPerson.map((p) => (
            <li key={p.name} className="line">
              <span className="grow">
                {p.name} <span className="muted small">· {p.count} уст.</span>
              </span>
              <b>{fmtMoney(p.sum)}</b>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Стоимость запаса сейчас">
        <div className="big-number">{fmtMoney(value.total)}</div>
        <ul className="list">
          {Object.entries(value.byKind).map(([kind, sum]) => (
            <li key={kind} className="line">
              <span className="grow">{LOCATION_KINDS[kind] || kind}</span>
              <b>{fmtMoney(sum)}</b>
            </li>
          ))}
        </ul>
        {noPrice > 0 && <p className="muted small">Без цены в каталоге: {noPrice} позиций, они в сумму не вошли.</p>}
      </Section>
    </>
  );
}
