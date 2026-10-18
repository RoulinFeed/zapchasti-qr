import { useStore, canManage } from '../store.js';
import { locationContents, movesFor, unitLocations, normalizeCode } from '../../../shared/state.js';
import { ScanField } from '../Scanner.jsx';
import { Section, Message, fmtDate, fmtQty, kindName, locLabel, moveText, unitLabel, CONDITIONS } from '../ui.jsx';

function History({ moves, state, showUnit }) {
  if (!moves.length) return <p className="muted">Движений нет.</p>;
  return (
    <ul className="list">
      {[...moves].reverse().map((m) => (
        <li key={m.id} className="pad">
          {showUnit && (
            <div>
              <a href={`#/scan?code=${m.unit}`}>{unitLabel(state, m.unit)}</a> <span className="muted small">{m.unit}</span>
            </div>
          )}
          <div>
            {moveText(state, m)} <b>{m.qty}</b>
          </div>
          <div className="muted small">
            {fmtDate(m.createdAt)} · {m.userName || ''}
            {m.hours ? ` · моточасы ${m.hours}` : ''}
            {m.condition ? ` · ${CONDITIONS[m.condition]}` : ''}
            {m.comment ? ` · ${m.comment}` : ''}
            {m.seq == null && ' · не отправлено'}
          </div>
        </li>
      ))}
    </ul>
  );
}

function UnitView({ code, state, manage }) {
  const unit = state.units[code];
  const item = state.items[unit.itemId];
  const where = unitLocations(state, code);
  const onMachine = where.find((w) => state.locations[w.loc]?.kind === 'machine');
  return (
    <>
      <Section title={item?.name || 'Неизвестная позиция'}>
        <div className="kv">
          <span>Код</span>
          <b>{code}</b>
          {item?.sku && (
            <>
              <span>Артикул</span>
              <b>{item.sku}</b>
            </>
          )}
          <span>Учёт</span>
          <b>{item?.tracking === 'batch' ? 'партией' : 'поштучно'}</b>
          {unit.serial && (
            <>
              <span>Серийный №</span>
              <b>{unit.serial}</b>
            </>
          )}
          <span>Состояние</span>
          <b className={unit.condition !== 'ok' ? 'warn-text' : ''}>{CONDITIONS[unit.condition] || 'Годная'}</b>
        </div>
        <h3>Где сейчас</h3>
        {where.length === 0 && <p className="muted">Нигде не числится (списано или ещё не оприходовано).</p>}
        <ul className="list">
          {where.map((w) => (
            <li key={w.loc} className="pad">
              <a href={`#/scan?code=${w.loc}`}>
                {kindName(state.locations[w.loc]?.kind)}: {locLabel(state, w.loc)}
              </a>{' '}
              — {fmtQty(w.qty, item)}
            </li>
          ))}
        </ul>
        <div className="row wrap">
          {where.length > 0 && !onMachine && (
            <>
              <a className="btn" href={`#/move/transfer?unit=${code}`}>
                Переместить
              </a>
              <a className="btn" href={`#/move/install?unit=${code}`}>
                Поставить на технику
              </a>
            </>
          )}
          {onMachine && (
            <a className="btn" href={`#/move/remove?unit=${code}`}>
              Снять с техники
            </a>
          )}
          {manage && item?.tracking === 'batch' && (
            <a className="btn" href={`#/receive?code=${code}`}>
              Пополнить
            </a>
          )}
          {manage && (
            <a className="btn" href={`#/labels?code=${code}`}>
              Напечатать этикетку
            </a>
          )}
        </div>
      </Section>
      <Section title="История">
        <History moves={movesFor(state, { unit: code })} state={state} />
      </Section>
    </>
  );
}

function LocationView({ code, state, manage }) {
  const loc = state.locations[code];
  const contents = locationContents(state, code);
  const isMachine = loc.kind === 'machine';
  return (
    <>
      <Section title={`${kindName(loc.kind)}: ${loc.name}`}>
        <div className="kv">
          <span>Код</span>
          <b>{code}</b>
          {loc.model && (
            <>
              <span>Модель</span>
              <b>{loc.model}</b>
            </>
          )}
          {loc.invNo && (
            <>
              <span>Инв. / гос. №</span>
              <b>{loc.invNo}</b>
            </>
          )}
          {loc.note && (
            <>
              <span>Заметка</span>
              <b>{loc.note}</b>
            </>
          )}
        </div>
        <div className="row wrap">
          {isMachine ? (
            <a className="btn" href={`#/move/install?to=${code}`}>
              Поставить деталь
            </a>
          ) : (
            <a className="btn" href={`#/move/transfer?to=${code}`}>
              Загрузить сюда
            </a>
          )}
          {manage && !isMachine && (
            <a className="btn" href={`#/inventory?loc=${code}`}>
              Инвентаризация
            </a>
          )}
          {manage && (
            <a className="btn" href={`#/labels?code=${code}`}>
              Напечатать этикетку
            </a>
          )}
        </div>
      </Section>
      <Section title={isMachine ? `Установлено (${contents.length})` : `Здесь лежит (${contents.length})`}>
        {contents.length === 0 && <p className="muted">Пусто.</p>}
        <ul className="list">
          {contents.map((r) => (
            <li key={r.unit} className="pad">
              <a href={`#/scan?code=${r.unit}`}>{r.item?.name || r.unit}</a>{' '}
              <span className="muted small">{r.unit}</span> — {fmtQty(r.qty, r.item)}
              {r.condition && r.condition !== 'ok' && <span className="warn-text"> · {CONDITIONS[r.condition]}</span>}
            </li>
          ))}
        </ul>
      </Section>
      <Section title={isMachine ? 'Паспорт: что ставили и снимали' : 'История'}>
        <History moves={movesFor(state, { location: code })} state={state} showUnit />
      </Section>
    </>
  );
}

export default function Lookup({ params, navigate }) {
  const { state, user } = useStore();
  const manage = canManage(user);
  const code = params.code ? normalizeCode(params.code) : null;
  let body = null;
  if (code) {
    if (state.units[code]) body = <UnitView code={code} state={state} manage={manage} />;
    else if (state.locations[code]) body = <LocationView code={code} state={state} manage={manage} />;
    else if (/^[PB]-/.test(code))
      body = (
        <Message kind="warn">
          Этикетка {code} ещё не привязана к запчасти.{' '}
          {manage ? <a href={`#/receive?code=${code}`}>Оприходовать с этой этикеткой</a> : 'Передайте деталь на склад для оприходования.'}
        </Message>
      );
    else body = <Message kind="error">Код {code} не найден. Если связи давно не было, синхронизируйте данные.</Message>;
  }
  return (
    <>
      <Section title="Найти по QR">
        <ScanField onScan={(c) => navigate(`/scan?code=${encodeURIComponent(c)}`)} autoFocus={!code} />
      </Section>
      {body}
    </>
  );
}
