import { useState } from 'react';
import { useStore, record, allocateCodes, isOwner } from '../store.js';
import { LOCATION_KINDS, CODE_PREFIX, locationContents } from '../../../shared/state.js';
import { Section, Message } from '../ui.jsx';

function LocationForm({ loc, onDone }) {
  const { online, users, state, user } = useStore();
  const [f, setF] = useState({ kind: 'machine', name: '', model: '', invNo: '', note: '', userId: '', ...loc });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function remove() {
    const left = locationContents(state, loc.code).length;
    if (left > 0) return setErr(`Удалить нельзя: здесь по учёту ещё ${left} поз. Сначала переместите или спишите их.`);
    if (!confirm(`Удалить «${loc.name}» насовсем? В старых записях журнала название останется.`)) return;
    try {
      await record('location.delete', { code: loc.code });
      onDone();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const code = f.code || (await allocateCodes(CODE_PREFIX[f.kind], 1))[0];
      await record('location.upsert', { ...f, code, name: f.name.trim() });
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={loc ? `${LOCATION_KINDS[f.kind]}: ${loc.name}` : 'Новое место'}>
      <div className="grid2">
        <label className="field">
          Вид
          <select value={f.kind} onChange={set('kind')} disabled={!!loc}>
            {Object.entries(LOCATION_KINDS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Название*
          <input
            value={f.name}
            onChange={set('name')}
            placeholder={
              { machine: 'Акрос 595 №7', van: 'Газель 1', warehouse: 'Основной склад', person: 'Иванов И.' }[f.kind]
            }
          />
        </label>
        {f.kind === 'machine' && (
          <label className="field">
            Модель
            <input value={f.model} onChange={set('model')} />
          </label>
        )}
        {(f.kind === 'machine' || f.kind === 'van') && (
          <label className="field">
            {f.kind === 'van' ? 'Гос. номер' : 'Инв. / гос. номер'}
            <input value={f.invNo} onChange={set('invNo')} />
          </label>
        )}
        {(f.kind === 'van' || f.kind === 'person') && (
          <label className="field">
            {f.kind === 'van' ? 'Механик' : 'Сотрудник в системе'}
            <select value={f.userId || ''} onChange={set('userId')}>
              <option value="">—</option>
              {users
                .filter((u) => u.active)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label className="field">
          Заметка
          <input value={f.note} onChange={set('note')} />
        </label>
      </div>
      {loc && (
        <label className="check">
          <input type="checkbox" checked={!!f.archived} onChange={(e) => setF({ ...f, archived: e.target.checked })} />{' '}
          Не используется (скрыть)
        </label>
      )}
      {!loc && !online && (
        <Message kind="warn">Для нового места нужна связь с сервером: он выдаёт код для этикетки.</Message>
      )}
      {err && <Message kind="error">{err}</Message>}
      <div className="row">
        <button className="btn primary" disabled={busy || !f.name.trim() || (!loc && !online)} onClick={save}>
          Сохранить
        </button>
        <button className="btn" onClick={onDone}>
          Отмена
        </button>
        {loc?.archived && isOwner(user) && (
          <button className="btn danger" onClick={remove}>
            Удалить насовсем
          </button>
        )}
      </div>
    </Section>
  );
}

export default function Locations({ params, navigate }) {
  const { state } = useStore();
  if (params.code !== undefined) {
    return (
      <LocationForm loc={params.code ? state.locations[params.code] : null} onDone={() => navigate('/locations')} />
    );
  }
  const all = Object.values(state.locations).filter((l) => !l.deleted);
  return (
    <>
      <Section
        title="Склады, Газели, техника, сотрудники"
        actions={
          <a className="btn primary small" href="#/locations?code=">
            + Добавить
          </a>
        }
      >
        {all.length === 0 && (
          <Message>
            Начните с основного склада, трёх Газелей и вашей техники. Потом напечатайте их этикетки в разделе «Печать
            этикеток» и наклейте: на Газель — в кузов, на комбайн — в кабину.
          </Message>
        )}
      </Section>
      {Object.entries(LOCATION_KINDS).map(([kind, title]) => {
        const list = all.filter((l) => l.kind === kind).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
        if (!list.length) return null;
        return (
          <Section key={kind} title={`${title} (${list.length})`}>
            <ul className="list">
              {list.map((l) => (
                <li key={l.code} className="line">
                  <a className="grow" href={`#/locations?code=${l.code}`}>
                    <b className={l.archived ? 'muted' : ''}>{l.name}</b>{' '}
                    <span className="muted small">
                      {[l.code, l.model, l.invNo].filter(Boolean).join(' · ')} ·{' '}
                      {locationContents(state, l.code).length} поз.
                    </span>
                  </a>
                  <a className="btn small" href={`#/scan?code=${l.code}`}>
                    Открыть
                  </a>
                </li>
              ))}
            </ul>
          </Section>
        );
      })}
    </>
  );
}
