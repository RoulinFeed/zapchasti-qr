import { useStore, canManage } from '../store.js';
import { lowStock, openIssues } from '../../../shared/state.js';
import { ScanField } from '../Scanner.jsx';
import { Section, Message, fmtDate, moveText, unitLabel, fmtQty } from '../ui.jsx';

export default function Home({ navigate }) {
  const { user, state } = useStore();
  const manage = canManage(user);
  const low = lowStock(state);
  const recent = state.moves.slice(-8).reverse();

  const actions = [
    ['move/transfer', 'Переместить / выдать', 'Склад, Газель, другой механик'],
    ['move/install', 'Поставить на технику', 'Деталь на комбайн'],
    ['move/remove', 'Снять с техники', 'Брак, ремонт или годная'],
    manage && ['receive', 'Приход на склад', 'Новые запчасти и этикетки'],
    manage && ['inventory', 'Инвентаризация', 'Пересчёт склада или Газели'],
    manage && ['move/writeoff', 'Списать', 'Утиль, утеря'],
  ].filter(Boolean);

  return (
    <>
      <Section title="Что отсканировать?">
        <ScanField onScan={(code) => navigate(`/scan?code=${encodeURIComponent(code)}`)} />
        <p className="muted small">Отсканируйте деталь, ячейку, Газель или комбайн, чтобы увидеть, что это и где лежит.</p>
      </Section>

      {manage && openIssues(state).length > 0 && (
        <Message kind="warn">
          Есть нестыковки в учёте: {openIssues(state).length}. <a href="#/issues">Разобраться</a>
        </Message>
      )}

      <div className="tiles">
        {actions.map(([path, title, sub]) => (
          <a key={path} className="tile" href={`#/${path}`}>
            <b>{title}</b>
            <span>{sub}</span>
          </a>
        ))}
      </div>

      {manage && low.length > 0 && (
        <Section title={`Заканчивается (${low.length})`} actions={<a href="#/stock?tab=low">Все</a>}>
          <ul className="list">
            {low.slice(0, 5).map(({ item, total }) => (
              <li key={item.id} className="pad">
                {item.name} <span className="muted">— осталось {fmtQty(total, item)}, минимум {item.minQty}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Последние движения">
        {recent.length === 0 && <p className="muted">Пока ничего не было.</p>}
        <ul className="list">
          {recent.map((m) => (
            <li key={m.id} className="pad">
              <a href={`#/scan?code=${m.unit}`}>{unitLabel(state, m.unit)}</a>
              <div className="muted small">
                {moveText(state, m)} · {m.qty} · {m.userName || ''} · {fmtDate(m.createdAt)}
                {m.seq == null && ' · не отправлено'}
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
