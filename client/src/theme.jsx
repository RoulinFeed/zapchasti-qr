import { useEffect, useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';

const KEY = 'zapchasti.theme';
const OPTIONS = { light: 'Светлая', dark: 'Тёмная', auto: 'Как в системе' };

function read() {
  try {
    return localStorage.getItem(KEY) || 'auto';
  } catch {
    return 'auto';
  }
}

export function applyTheme(mode = read()) {
  const root = document.documentElement;
  if (mode === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
}

const NEXT = { auto: 'light', light: 'dark', dark: 'auto' };
const ICONS = { light: Sun, dark: Moon, auto: Monitor };

// Кнопка в меню: по нажатию тема меняется по кругу — светлая, тёмная, как в системе.
export function ThemeSwitch() {
  const [mode, setMode] = useState(read);
  useEffect(() => {
    applyTheme(mode);
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* не важно */
    }
  }, [mode]);
  const Icon = ICONS[mode];
  return (
    <button
      className="side-item theme-switch"
      data-mode={mode}
      title={`Тема: ${OPTIONS[mode]}. Нажмите, чтобы сменить`}
      onClick={() => setMode(NEXT[mode])}
    >
      <Icon size={20} strokeWidth={1.8} />
      <span className="label">Тема: {OPTIONS[mode]}</span>
    </button>
  );
}
