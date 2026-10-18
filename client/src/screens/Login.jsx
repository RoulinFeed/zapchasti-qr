import { useState } from 'react';
import { login } from '../store.js';

export default function Login() {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(name, pin);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <h1>Учёт запчастей</h1>
        <label>
          Логин
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" autoFocus />
        </label>
        <label>
          PIN-код
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
          />
        </label>
        {error && <div className="msg msg-error">{error}</div>}
        <button className="btn primary big" disabled={busy || !name || !pin}>
          {busy ? 'Вход…' : 'Войти'}
        </button>
        <p className="muted small">Для первого входа нужна связь с сервером, дальше приложение работает и без неё.</p>
      </form>
    </div>
  );
}
