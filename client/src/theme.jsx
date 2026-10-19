import { useEffect, useState } from 'react';

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
  return (
    <label className="field small">
      Тема
      <select value={mode} onChange={(e) => setMode(e.target.value)}>
        {Object.entries(OPTIONS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </label>
  );
}
