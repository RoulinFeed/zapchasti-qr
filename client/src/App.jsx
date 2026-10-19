import { useEffect, useState } from 'react';
import { useStore, sync, logout, canManage } from './store.js';
import { fmtDate, navigate } from './ui.jsx';
import Login from './screens/Login.jsx';
import Home from './screens/Home.jsx';
import Lookup from './screens/Lookup.jsx';
import Move from './screens/Move.jsx';
import Receive from './screens/Receive.jsx';
import Inventory from './screens/Inventory.jsx';
import Stock from './screens/Stock.jsx';
import Catalog from './screens/Catalog.jsx';
import Locations from './screens/Locations.jsx';
import Labels from './screens/Labels.jsx';
import Users from './screens/Users.jsx';
import Data from './screens/Data.jsx';
import Problems from './screens/Problems.jsx';
import Issues from './screens/Issues.jsx';
import Costs from './screens/Costs.jsx';
import { openIssues } from '../../shared/state.js';
import { ThemeSwitch } from './theme.jsx';

const ROUTES = {
  '': Home,
  scan: Lookup,
  move: Move,
  receive: Receive,
  inventory: Inventory,
  stock: Stock,
  catalog: Catalog,
  locations: Locations,
  labels: Labels,
  users: Users,
  data: Data,
  problems: Problems,
  issues: Issues,
  costs: Costs,
};

function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const [name, ...rest] = path.split('/');
  return { name, args: rest, params: Object.fromEntries(new URLSearchParams(query)) };
}

function SyncBadge() {
  const { online, pending, syncing, lastSync, syncError, rejected } = useStore();
  return (
    <button className={`sync ${online ? 'on' : 'off'}`} onClick={() => sync()} title={syncError || ''}>
      <span className="dot" />
      {syncing ? 'Синхронизация…' : online ? 'На связи' : 'Без связи'}
      {pending > 0 && <span className="badge">не отправлено: {pending}</span>}
      {rejected.length > 0 && <span className="badge warn">ошибок: {rejected.length}</span>}
      {!syncing && lastSync && <span className="muted small">обновлено {fmtDate(lastSync)}</span>}
    </button>
  );
}

export default function App() {
  const { ready, user, rejected, state } = useStore();
  const [route, setRoute] = useState(parseHash);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    const on = () => {
      setRoute(parseHash());
      setMenu(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  if (!ready) return <div className="center muted">Загрузка…</div>;
  if (!user) return <Login />;

  const Screen = ROUTES[route.name] || Home;
  const manage = canManage(user);
  const links = [
    ['', 'Главная'],
    ['scan', 'Найти по QR'],
    ['stock', 'Остатки'],
    manage && ['receive', 'Приход'],
    manage && ['inventory', 'Инвентаризация'],
    manage && ['issues', `Нестыковки${openIssues(state).length ? ` (${openIssues(state).length})` : ''}`],
    manage && ['costs', 'Затраты'],
    manage && ['catalog', 'Каталог'],
    manage && ['locations', 'Склады, Газели, техника'],
    manage && ['labels', 'Печать этикеток'],
    user.role === 'admin' && ['users', 'Сотрудники'],
    ['data', 'Выгрузка в Excel'],
    rejected.length > 0 && ['problems', `Ошибки (${rejected.length})`],
  ].filter(Boolean);

  return (
    <div className="app">
      <header className="top">
        <button className="btn ghost menu-btn" onClick={() => setMenu(!menu)} aria-label="Меню">
          ☰
        </button>
        <a className="brand" href="#/">
          Запчасти
        </a>
        <SyncBadge />
      </header>
      <div className="layout">
        <nav className={`side ${menu ? 'open' : ''}`}>
          {links.map(([path, label]) => (
            <a key={path} href={`#/${path}`} className={route.name === path ? 'active' : ''}>
              {label}
            </a>
          ))}
          <div className="side-user">
            <ThemeSwitch />
            <div>{user.name}</div>
            <button
              className="btn ghost small"
              onClick={() => logout().catch((e) => alert(e.message))}
            >
              Выйти
            </button>
          </div>
        </nav>
        <main className="main">
          <Screen key={window.location.hash} args={route.args} params={route.params} navigate={navigate} />
        </main>
      </div>
    </div>
  );
}
