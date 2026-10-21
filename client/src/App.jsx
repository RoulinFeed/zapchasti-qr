import { useEffect, useState } from 'react';
import { useStore, sync, logout, canManage, isAdmin } from './store.js';
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
import {
  House,
  QrCode,
  Boxes,
  PackagePlus,
  ClipboardCheck,
  TriangleAlert,
  Wallet,
  BookOpen,
  Warehouse,
  Printer,
  Users as UsersIcon,
  FileSpreadsheet,
  CircleAlert,
  LogOut,
  Wrench,
} from 'lucide-react';

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

// Экраны с широкими таблицами занимают всю ширину окна.
const WIDE = ['catalog', 'stock'];

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
  const issues = manage ? openIssues(state).length : 0;
  // [путь, подпись, иконка, счётчик]
  const links = [
    ['', 'Главная', House],
    ['scan', 'Найти по QR', QrCode],
    ['stock', 'Остатки', Boxes],
    manage && ['receive', 'Приход', PackagePlus],
    manage && ['inventory', 'Инвентаризация', ClipboardCheck],
    manage && ['issues', 'Нестыковки', TriangleAlert, issues],
    manage && ['costs', 'Затраты', Wallet],
    manage && ['catalog', 'Каталог', BookOpen],
    manage && ['locations', 'Склады, Газели, техника', Warehouse],
    manage && ['labels', 'Печать этикеток', Printer],
    isAdmin(user) && ['users', 'Сотрудники', UsersIcon],
    ['data', 'Выгрузка в Excel', FileSpreadsheet],
    rejected.length > 0 && ['problems', 'Ошибки', CircleAlert, rejected.length],
  ].filter(Boolean);

  return (
    <div className="app">
      <nav className={`side ${menu ? 'open' : ''}`}>
        <a className="side-brand" href="#/" title="Запчасти">
          <span className="side-logo">
            <Wrench size={14} strokeWidth={2.2} />
          </span>
          <span className="label">Запчасти</span>
        </a>
        {links.map(([path, label, Icon, count]) => (
          <a key={path} href={`#/${path}`} className={route.name === path ? 'active' : ''} title={label}>
            <Icon size={20} strokeWidth={1.8} />
            <span className="label">{label}</span>
            {count > 0 && <span className="count">{count}</span>}
          </a>
        ))}
        <div className="side-user">
          <ThemeSwitch />
          <button
            className="side-item"
            title={`Выйти (${user.name})`}
            onClick={() => logout().catch((e) => alert(e.message))}
          >
            <LogOut size={20} strokeWidth={1.8} />
            <span className="label">Выйти · {user.name}</span>
          </button>
        </div>
      </nav>
      {menu && <div className="side-shade" onClick={() => setMenu(false)} />}
      <div className="shell">
        <header className="top">
          <button className="btn ghost menu-btn" onClick={() => setMenu(!menu)} aria-label="Меню">
            ☰
          </button>
          <a className="brand" href="#/">
            Запчасти
          </a>
          <SyncBadge />
        </header>
        <main className={`main ${WIDE.includes(route.name) ? 'wide' : ''}`}>
          <Screen key={window.location.hash} args={route.args} params={route.params} navigate={navigate} />
        </main>
      </div>
    </div>
  );
}
