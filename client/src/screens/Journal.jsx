import { useMemo, useState } from 'react';
import { useStore } from '../store.js';
import { MOVE_TYPES, CONDITIONS } from '../../../shared/state.js';
import { Section, fmtDate, locLabel, navigate } from '../ui.jsx';
import { Grid } from '../Grid.jsx';
import { MoveList } from '../MoveList.jsx';
import { useView, ViewSwitch } from '../views.jsx';

const LIMIT = { table: 1000, list: 200 };

// Весь журнал движений: поиск по детали, месту, человеку и комментарию.
export default function Journal() {
  const { state } = useStore();
  const [view, setView] = useView('journal');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');

  const rows = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return state.moves
      .map((m) => {
        const item = state.items[state.units[m.unit]?.itemId];
        return {
          ...m,
          itemName: item?.name || '',
          sku: item?.sku || '',
          unitName: item?.unitName || 'шт',
          fromName: locLabel(state, m.from),
          toName: locLabel(state, m.to),
        };
      })
      .filter((r) => !type || r.type === type)
      .filter((r) => {
        if (!words.length) return true;
        const hay = [r.itemName, r.sku, r.unit, r.fromName, r.toName, r.userName, r.comment].join(' ').toLowerCase();
        return words.every((w) => hay.includes(w));
      });
  }, [state, q, type]);

  const shown = rows.slice(-LIMIT[view]);

  return (
    <Section title={`Журнал движений (${rows.length})`} actions={<ViewSwitch view={view} setView={setView} />}>
      <div className="filters">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск: деталь, код, место, кто, комментарий"
        />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Все операции</option>
          {Object.entries(MOVE_TYPES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      {view === 'table' ? (
        <Grid
          newRow={false}
          rows={shown.slice().reverse()}
          onEdit={() => {}}
          onOpen={(r) => navigate(`/scan?code=${r.unit}`)}
          rowClass={(r) => (r.voided ? 'muted voided-row' : '')}
          columns={[
            { key: 'createdAt', title: 'Когда', width: 130, render: (r) => fmtDate(r.createdAt) },
            {
              key: 'type',
              title: 'Операция',
              width: 120,
              value: (r) => MOVE_TYPES[r.type],
              render: (r) => <span className={`tag tag-${r.type}`}>{MOVE_TYPES[r.type]}</span>,
            },
            { key: 'itemName', title: 'Позиция', width: 220 },
            { key: 'unit', title: 'Код', width: 90 },
            { key: 'qty', title: 'Кол-во', width: 80, align: 'right' },
            { key: 'unitName', title: 'Ед.', width: 50 },
            { key: 'fromName', title: 'Откуда', width: 160 },
            { key: 'toName', title: 'Куда', width: 160 },
            { key: 'userName', title: 'Кто', width: 120 },
            { key: 'hours', title: 'Моточасы', width: 90, align: 'right' },
            { key: 'condition', title: 'Состояние', width: 110, value: (r) => CONDITIONS[r.condition] || '' },
            { key: 'comment', title: 'Комментарий', width: 200 },
            {
              key: 'voided',
              title: 'Отменено',
              width: 200,
              value: (r) => (r.voided ? `${r.voided.reason} (${r.voided.userName})` : ''),
            },
          ]}
        />
      ) : (
        <MoveList state={state} moves={shown} empty="Ничего не найдено." />
      )}
      {rows.length > shown.length && (
        <p className="muted small">
          Показаны последние {shown.length}. Уточните поиск или выгрузите весь журнал в разделе «Выгрузка в Excel».
        </p>
      )}
    </Section>
  );
}
