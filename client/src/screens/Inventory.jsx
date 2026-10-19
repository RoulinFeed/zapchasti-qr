import { useState } from 'react';
import { useStore, recordMany } from '../store.js';
import { inventoryDiff, locationContents, normalizeCode, unitLocations } from '../../../shared/state.js';
import { ScanField } from '../Scanner.jsx';
import { Section, Message, LocationSelect, fmtQty, locLabel, unitLabel } from '../ui.jsx';

export default function Inventory({ params }) {
  const { state } = useStore();
  const [loc, setLoc] = useState(params.loc ? normalizeCode(params.loc) : null);
  const [found, setFound] = useState({}); // unit -> количество
  const [notice, setNotice] = useState(null);
  const [done, setDone] = useState(null);

  const expected = loc ? locationContents(state, loc) : [];
  const diff = loc ? inventoryDiff(state, loc, found) : [];

  function onScan(code) {
    setNotice(null);
    setDone(null);
    if (state.locations[code]) {
      if (state.locations[code].kind === 'machine') setNotice({ kind: 'warn', text: 'Технику не инвентаризируем' });
      else {
        setLoc(code);
        setFound({});
      }
      return;
    }
    const unit = state.units[code];
    if (!unit) {
      setNotice({ kind: 'warn', text: `${code}: этикетка не привязана. Оприходуйте её через «Приход».` });
      return;
    }
    const batch = state.items[unit.itemId]?.tracking === 'batch';
    if (batch) {
      // Для коробки предлагаем количество по учёту, его можно поправить в списке.
      const exp = expected.find((e) => e.unit === code)?.qty || 0;
      setFound({ ...found, [code]: found[code] ?? exp });
    } else {
      setFound({ ...found, [code]: 1 });
    }
  }

  async function apply() {
    const ops = [];
    for (const d of diff) {
      if (d.delta > 0) {
        // Нашли больше, чем по учёту. Поштучную деталь переносим оттуда, где она числилась.
        const elsewhere = unitLocations(state, d.unit).filter((w) => w.loc !== loc);
        const isPiece = state.items[state.units[d.unit]?.itemId]?.tracking !== 'batch';
        const from = isPiece && elsewhere.length === 1 ? elsewhere[0].loc : null;
        ops.push({
          kind: 'move',
          payload: { type: 'adjust', unit: d.unit, qty: d.delta, from, to: loc, comment: 'Инвентаризация: найдено' },
        });
      } else {
        ops.push({
          kind: 'move',
          payload: {
            type: 'adjust',
            unit: d.unit,
            qty: -d.delta,
            from: loc,
            to: null,
            comment: 'Инвентаризация: не найдено',
          },
        });
      }
    }
    await recordMany(ops);
    setDone(`Учёт исправлен: ${ops.length} строк`);
    setFound({});
  }

  const scannedCount = Object.keys(found).length;

  return (
    <>
      <Section title="Инвентаризация">
        <div className="field">
          <div className="label">Что пересчитываем</div>
          <LocationSelect
            value={loc}
            onChange={(v) => (setLoc(v), setFound({}))}
            kinds={['warehouse', 'van', 'person']}
            placeholder="Склад, Газель или сотрудник"
          />
        </div>
        {loc && (
          <>
            <ScanField onScan={onScan} continuous hint="Сканируйте всё, что лежит на месте" />
            <p className="muted small">
              По учёту здесь {expected.length} единиц, отсканировано {scannedCount}.
            </p>
          </>
        )}
        {notice && <Message kind={notice.kind}>{notice.text}</Message>}
        {done && <Message kind="ok">{done}</Message>}
      </Section>

      {loc && scannedCount > 0 && (
        <Section title="Отсканировано">
          <ul className="list">
            {Object.entries(found).map(([unit, qty]) => {
              const item = state.items[state.units[unit]?.itemId];
              return (
                <li key={unit} className="line">
                  <span className="grow">
                    {item?.name} <span className="muted small">{unit}</span>
                  </span>
                  {item?.tracking === 'batch' && (
                    <input
                      className="qty"
                      value={qty}
                      inputMode="decimal"
                      onChange={(e) => setFound({ ...found, [unit]: Number(e.target.value.replace(',', '.')) || 0 })}
                    />
                  )}
                  <button
                    className="btn ghost"
                    onClick={() => {
                      const next = { ...found };
                      delete next[unit];
                      setFound(next);
                    }}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {loc && scannedCount > 0 && (
        <Section title={diff.length ? `Расхождения (${diff.length})` : 'Расхождений нет'}>
          <ul className="list">
            {diff.map((d) => {
              const item = state.items[state.units[d.unit]?.itemId];
              const elsewhere = unitLocations(state, d.unit).filter((w) => w.loc !== loc);
              return (
                <li key={d.unit} className="pad">
                  <b>{unitLabel(state, d.unit)}</b> <span className="muted small">{d.unit}</span>
                  <div className={d.delta > 0 ? 'ok-text small' : 'warn-text small'}>
                    по учёту {fmtQty(d.expected, item)}, найдено {fmtQty(d.found, item)}
                    {d.delta > 0 &&
                      elsewhere.length > 0 &&
                      ` · числилась: ${elsewhere.map((w) => locLabel(state, w.loc)).join(', ')}`}
                  </div>
                </li>
              );
            })}
          </ul>
          {diff.length > 0 && (
            <>
              <p className="muted small">
                Всё, что не отсканировано, будет списано с «{locLabel(state, loc)}» как «не найдено». Проводите, когда
                пересчитали всё место целиком.
              </p>
              <button className="btn primary big" onClick={apply}>
                Исправить учёт
              </button>
            </>
          )}
        </Section>
      )}
    </>
  );
}
