import { useStore } from '../store.js';
import { itemTotals, installCosts, MOVE_TYPES, LOCATION_KINDS, CONDITIONS } from '../../../shared/state.js';
import { Section, fmtDate, locLabel } from '../ui.jsx';

// CSV с разделителем «;» и BOM: русский Excel открывает такой файл двойным щелчком без настройки.
function downloadCsv(name, header, rows) {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const num = (v) => (typeof v === 'number' ? String(v).replace('.', ',') : v);
  const text = [header, ...rows].map((r) => r.map((v) => cell(num(v))).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function Data() {
  const { state } = useStore();

  const exports = [
    [
      'Остатки по местам',
      'Что где лежит и что стоит на технике, по каждой этикетке',
      () => {
        const rows = [];
        for (const [unit, row] of Object.entries(state.stock)) {
          const u = state.units[unit];
          const it = u && state.items[u.itemId];
          for (const [loc, qty] of Object.entries(row)) {
            if (qty <= 0) continue;
            const l = state.locations[loc];
            rows.push([LOCATION_KINDS[l?.kind] || '', locLabel(state, loc), it?.name, it?.sku, unit, u?.serial, qty, it?.unitName, CONDITIONS[u?.condition]]);
          }
        }
        rows.sort((a, b) => (a[0] + a[1] + a[2]).localeCompare(b[0] + b[1] + b[2], 'ru'));
        downloadCsv('остатки', ['Вид места', 'Место', 'Позиция', 'Артикул', 'Код', 'Серийный №', 'Кол-во', 'Ед.', 'Состояние'], rows);
      },
    ],
    [
      'Итоги по позициям',
      'Каталог с запасом на складах и в Газелях',
      () => {
        const totals = itemTotals(state);
        const rows = Object.values(state.items)
          .filter((i) => !i.archived)
          .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
          .map((i) => {
            const t = totals[i.id];
            return [i.name, i.sku, i.manufacturer, i.models, i.tracking === 'batch' ? 'партией' : 'поштучно', t.byKind.warehouse || 0, (t.byKind.van || 0) + (t.byKind.person || 0), t.total, i.unitName, i.minQty, Number(i.price) || 0, (Number(i.price) || 0) * t.total];
          });
        downloadCsv('позиции', ['Позиция', 'Артикул', 'Производитель', 'Модели', 'Учёт', 'На складах', 'В Газелях и у людей', 'Всего', 'Ед.', 'Мин. остаток', 'Цена, ₽', 'Стоимость запаса, ₽'], rows);
      },
    ],
    [
      'Журнал движений',
      'Все операции: кто, когда, что, откуда, куда',
      () => {
        const rows = state.moves.map((m) => {
          const u = state.units[m.unit];
          const it = u && state.items[u.itemId];
          return [fmtDate(m.createdAt), MOVE_TYPES[m.type], it?.name, it?.sku, m.unit, m.qty, locLabel(state, m.from), locLabel(state, m.to), m.userName, m.hours, CONDITIONS[m.condition], m.comment, m.voided ? `${m.voided.reason} (${m.voided.userName})` : ''];
        });
        downloadCsv('движения', ['Дата', 'Операция', 'Позиция', 'Артикул', 'Код', 'Кол-во', 'Откуда', 'Куда', 'Кто', 'Моточасы', 'Состояние', 'Комментарий', 'Отменено'], rows);
      },
    ],
    [
      'Паспорта техники',
      'Что ставили и снимали на каждой единице техники',
      () => {
        const machines = new Set(Object.values(state.locations).filter((l) => l.kind === 'machine').map((l) => l.code));
        const rows = state.moves
          .filter((m) => !m.voided && (machines.has(m.to) || machines.has(m.from)))
          .map((m) => {
            const machine = machines.has(m.to) ? m.to : m.from;
            const u = state.units[m.unit];
            const it = u && state.items[u.itemId];
            return [locLabel(state, machine), fmtDate(m.createdAt), machines.has(m.to) ? 'Установлено' : 'Снято', it?.name, it?.sku, m.unit, m.qty, m.hours, m.userName, CONDITIONS[m.condition]];
          })
          .sort((a, b) => a[0].localeCompare(b[0], 'ru'));
        downloadCsv('техника', ['Техника', 'Дата', 'Действие', 'Позиция', 'Артикул', 'Код', 'Кол-во', 'Моточасы', 'Кто', 'Состояние'], rows);
      },
    ],
    [
      'Затраты на технику',
      'Все установки с ценой: техника, деталь, сумма, механик',
      () => {
        const rows = installCosts(state).byMachine.flatMap((mc) =>
          mc.moves.map((m) => [locLabel(state, mc.code), fmtDate(m.createdAt), state.items[state.units[m.unit]?.itemId]?.name, m.unit, m.qty, m.price, m.sum, m.userName]),
        );
        downloadCsv('затраты', ['Техника', 'Дата', 'Позиция', 'Код', 'Кол-во', 'Цена, ₽', 'Сумма, ₽', 'Кто'], rows);
      },
    ],
  ];

  return (
    <Section title="Выгрузка в Excel">
      <p className="muted small">
        Файлы открываются в Excel. Это копия на всякий случай: работать продолжаем в приложении, а сервер дополнительно
        каждый день сохраняет резервную копию базы.
      </p>
      <ul className="list">
        {exports.map(([title, sub, fn]) => (
          <li key={title} className="line">
            <span className="grow">
              <b>{title}</b>
              <div className="muted small">{sub}</div>
            </span>
            <button className="btn" onClick={fn}>
              Скачать
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}
