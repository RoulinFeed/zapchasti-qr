import { useState } from 'react';

// Вид списка — таблица или карточки — запоминается отдельно для каждого раздела.
// На компьютере по умолчанию таблица, на телефоне карточки.
export function useView(name) {
  const key = `zapchasti.view.${name}`;
  const [view, setState] = useState(() => {
    try {
      return localStorage.getItem(key) || (window.innerWidth >= 900 ? 'table' : 'list');
    } catch {
      return 'list';
    }
  });
  const setView = (v) => {
    setState(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      /* не важно */
    }
  };
  return [view, setView];
}

export function ViewSwitch({ view, setView }) {
  return (
    <div className="switch">
      <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>
        Таблица
      </button>
      <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
        Карточки
      </button>
    </div>
  );
}
