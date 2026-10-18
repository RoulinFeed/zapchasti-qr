import { useState } from 'react';
import { useStore, recordMany } from '../store.js';
import { unitLocations, normalizeCode } from '../../../shared/state.js';
import { ScanField } from '../Scanner.jsx';
import { Section, Message, LocationSelect, kindName, locLabel, CONDITIONS } from '../ui.jsx';

const CONFIG = {
  transfer: {
    title: 'Переместить / выдать',
    destTitle: 'Куда',
    destKinds: ['warehouse', 'van', 'person'],
    fromKinds: ['warehouse', 'van', 'person'],
  },
  install: {
    title: 'Поставить на технику',
    destTitle: 'На какую технику',
    destKinds: ['machine'],
    fromKinds: ['warehouse', 'van', 'person'],
  },
  remove: {
    title: 'Снять с техники',
    destTitle: 'Куда положить снятое',
    destKinds: ['van', 'warehouse', 'person'],
    fromKinds: ['machine'],
  },
  writeoff: {
    title: 'Списать',
    destKinds: null,
    fromKinds: ['warehouse', 'van', 'person'],
  },
};

export default function Move({ args, params }) {
  const type = CONFIG[args[0]] ? args[0] : 'transfer';
  const cfg = CONFIG[type];
  const { state } = useStore();
  const [dest, setDest] = useState(params.to ? normalizeCode(params.to) : null);
  const [lines, setLines] = useState(() => (params.unit ? initialLines(params.unit) : []));
  const [hours, setHours] = useState('');
  const [condition, setCondition] = useState('defect');
  const [comment, setComment] = useState('');
  const [notice, setNotice] = useState(null);
  const [done, setDone] = useState(null);

  function initialLines(raw) {
    const line = makeLine(normalizeCode(raw));
    return line.error ? [] : [line];
  }

  function makeLine(code) {
    const unit = state.units[code];
    if (!unit) return { error: `${code}: этикетка не привязана к запчасти` };
    const item = state.items[unit.itemId];
    const all = unitLocations(state, code);
    const allowed = all.filter((w) => cfg.fromKinds.includes(state.locations[w.loc]?.kind));
    const from = allowed[0] || null;
    let warning = null;
    if (!from) {
      warning =
        type === 'remove'
          ? 'По учёту эта деталь не стоит на технике. Будет записана как снятая без указания откуда.'
          : all.length
            ? `По учёту деталь сейчас: ${all.map((w) => locLabel(state, w.loc)).join(', ')}.`
            : 'По учёту деталь нигде не числится.';
    }
    return {
      unit: code,
      item,
      batch: item?.tracking === 'batch',
      options: allowed,
      from: from?.loc || null,
      qty: 1,
      warning,
    };
  }

  function onScan(code) {
    setDone(null);
    setNotice(null);
    // Отсканировали место: это пункт назначения.
    const loc = state.locations[code];
    if (loc) {
      if (cfg.destKinds?.includes(loc.kind)) setDest(code);
      else setNotice({ kind: 'warn', text: `${kindName(loc.kind)} «${loc.name}» не подходит для этой операции` });
      return;
    }
    const existing = lines.find((l) => l.unit === code);
    if (existing) {
      if (existing.batch) setLines(lines.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l)));
      else setNotice({ kind: 'info', text: `${existing.item?.name || code} уже в списке` });
      return;
    }
    const line = makeLine(code);
    if (line.error) setNotice({ kind: 'error', text: line.error });
    else setLines([...lines, line]);
  }

  const update = (i, patch) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const maxQty = (l) => l.options.find((o) => o.loc === l.from)?.qty;

  const problems = [];
  if (cfg.destKinds && !dest) problems.push(`Укажите: ${cfg.destTitle.toLowerCase()}`);
  if (!lines.length) problems.push('Отсканируйте запчасти');
  if (type === 'writeoff' && !comment.trim()) problems.push('Укажите причину списания');
  for (const l of lines) {
    if (type === 'writeoff' && !l.from) problems.push(`${l.item?.name}: по учёту нигде не числится, списывать нечего`);
    if (dest && l.from === dest) problems.push(`${l.item?.name}: уже находится там`);
    if (!(Number(l.qty) > 0)) problems.push(`${l.item?.name}: количество должно быть больше нуля`);
    const max = maxQty(l);
    if (max != null && Number(l.qty) > max) problems.push(`${l.item?.name}: там только ${max}`);
  }

  async function submit() {
    const moves = lines.map((l) => ({
      kind: 'move',
      payload: {
        type,
        unit: l.unit,
        qty: Number(l.qty),
        from: l.from,
        to: cfg.destKinds ? dest : null,
        ...(type === 'install' && hours ? { hours: Number(hours) } : {}),
        ...(type === 'remove' ? { condition } : {}),
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      },
    }));
    await recordMany(moves);
    setDone(`Проведено: ${moves.length}`);
    setLines([]);
    setComment('');
    setHours('');
  }

  return (
    <>
      <Section title={cfg.title}>
        {cfg.destKinds && (
          <div className="field">
            <div className="label">{cfg.destTitle}</div>
            <LocationSelect value={dest} onChange={setDest} kinds={cfg.destKinds} placeholder="Выберите или отсканируйте" />
          </div>
        )}
        {type === 'install' && (
          <label className="field">
            Моточасы техники (необязательно)
            <input value={hours} onChange={(e) => setHours(e.target.value)} inputMode="numeric" />
          </label>
        )}
        {type === 'remove' && (
          <div className="field">
            <div className="label">Состояние снятого</div>
            <div className="seg">
              {Object.entries(CONDITIONS).map(([k, v]) => (
                <button key={k} className={`btn ${condition === k ? 'primary' : ''}`} onClick={() => setCondition(k)}>
                  {v}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="field">
          <div className="label">Запчасти</div>
          <ScanField onScan={onScan} continuous hint="Сканируйте детали подряд" />
        </div>
        {notice && <Message kind={notice.kind}>{notice.text}</Message>}
        {done && <Message kind="ok">{done}</Message>}
      </Section>

      {lines.length > 0 && (
        <Section title={`Список (${lines.length})`}>
          <ul className="list">
            {lines.map((l, i) => (
              <li key={l.unit} className="line">
                <div className="grow">
                  <b>{l.item?.name}</b> <span className="muted small">{l.unit}</span>
                  {l.options.length > 1 ? (
                    <select value={l.from || ''} onChange={(e) => update(i, { from: e.target.value })}>
                      {l.options.map((o) => (
                        <option key={o.loc} value={o.loc}>
                          из: {locLabel(state, o.loc)} ({o.qty})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="muted small">из: {locLabel(state, l.from)}</div>
                  )}
                  {l.warning && <div className="warn-text small">{l.warning}</div>}
                </div>
                {l.batch && (
                  <input
                    className="qty"
                    value={l.qty}
                    onChange={(e) => update(i, { qty: e.target.value.replace(',', '.') })}
                    inputMode="decimal"
                  />
                )}
                <button className="btn ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Убрать">
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <label className="field">
            {type === 'writeoff' ? 'Причина списания' : 'Комментарий (необязательно)'}
            <input value={comment} onChange={(e) => setComment(e.target.value)} />
          </label>
          {problems.length > 0 && <Message kind="warn">{problems[0]}</Message>}
          <button className="btn primary big" disabled={problems.length > 0} onClick={submit}>
            Провести
          </button>
        </Section>
      )}
    </>
  );
}
