import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useStore, isOwner } from '../store.js';
import { Section, Message } from '../ui.jsx';

const ROLES = { owner: 'Администратор', admin: 'Руководитель', storekeeper: 'Кладовщик', mechanic: 'Механик' };

function UserForm({ user, onDone }) {
  const me = useStore((s) => s.user);
  const roles = Object.entries(ROLES).filter(([k]) => k !== 'owner' || isOwner(me));
  const [f, setF] = useState({ login: '', name: '', role: 'mechanic', active: true, ...user, pin: '' });
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setErr(null);
    try {
      await api('/api/users', f);
      onDone();
    } catch (e) {
      setErr(e.message);
    }
  }
  return (
    <Section title={user ? user.name : 'Новый сотрудник'}>
      <div className="grid2">
        <label className="field">
          Имя*
          <input value={f.name} onChange={set('name')} />
        </label>
        <label className="field">
          Логин для входа*
          <input value={f.login} onChange={set('login')} autoCapitalize="none" />
        </label>
        <label className="field">
          Роль
          <select value={f.role} onChange={set('role')}>
            {roles.map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {user ? 'Новый PIN (если меняем)' : 'PIN (4–8 цифр)*'}
          <input value={f.pin} onChange={set('pin')} inputMode="numeric" />
        </label>
      </div>
      {user && (
        <label className="check">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />{' '}
          Работает (снимите, чтобы закрыть доступ)
        </label>
      )}
      <p className="muted small">
        Механик может перемещать, ставить и снимать детали. Кладовщик ещё делает приход, инвентаризацию и ведёт каталог.
        Руководитель управляет сотрудниками. Администратор может ещё исправлять и отменять проведённые операции в журнале и
        назначать других администраторов.
      </p>
      {err && <Message kind="error">{err}</Message>}
      <div className="row">
        <button className="btn primary" onClick={save}>
          Сохранить
        </button>
        <button className="btn" onClick={onDone}>
          Отмена
        </button>
      </div>
    </Section>
  );
}

export default function Users() {
  const [users, setUsers] = useState(null);
  const [edit, setEdit] = useState(undefined);
  const [err, setErr] = useState(null);
  const load = () =>
    api('/api/users')
      .then((r) => setUsers(r.users))
      .catch((e) => setErr(e.message));
  useEffect(() => {
    load();
  }, []);

  if (edit !== undefined) return <UserForm user={edit} onDone={() => (setEdit(undefined), load())} />;
  return (
    <Section
      title="Сотрудники"
      actions={
        <button className="btn primary small" onClick={() => setEdit(null)}>
          + Сотрудник
        </button>
      }
    >
      {err && <Message kind="error">{err} Список сотрудников доступен только при связи с сервером.</Message>}
      <ul className="list">
        {(users || []).map((u) => (
          <li key={u.id}>
            <button className="list-btn" onClick={() => setEdit(u)}>
              <b className={u.active ? '' : 'muted'}>{u.name}</b>
              <span className="muted">
                {ROLES[u.role]} · {u.login}
                {!u.active && ' · доступ закрыт'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}
