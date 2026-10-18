import { useEffect, useRef, useState } from 'react';
import QrScanner from 'qr-scanner';
import { normalizeCode } from '../../shared/state.js';

function signal() {
  navigator.vibrate?.(60);
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    o.frequency.value = 1200;
    o.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.08);
  } catch {
    /* без звука */
  }
}

// Окно камеры. В режиме continuous не закрывается после каждого кода (для сканирования подряд).
export function CameraScanner({ onScan, onClose, continuous = false, hint }) {
  const videoRef = useRef(null);
  const scannerRef = useRef(null);
  const lastRef = useRef({ code: null, at: 0 });
  const [error, setError] = useState(null);
  const [hasFlash, setHasFlash] = useState(false);
  const [flash, setFlash] = useState(false);
  const [last, setLast] = useState(null);
  // Обработчик меняется на каждой отрисовке родителя, камера должна вызывать свежий.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    const scanner = new QrScanner(
      videoRef.current,
      (result) => {
        const code = normalizeCode(result.data);
        const now = Date.now();
        // Камера видит один и тот же код много раз подряд, повторы в течение 2 секунд пропускаем.
        if (code === lastRef.current.code && now - lastRef.current.at < 2000) return;
        lastRef.current = { code, at: now };
        signal();
        setLast(code);
        onScanRef.current(code);
        if (!continuous) onClose();
      },
      { preferredCamera: 'environment', highlightScanRegion: true, returnDetailedScanResult: true, maxScansPerSecond: 8 },
    );
    scannerRef.current = scanner;
    scanner
      .start()
      .then(() => scanner.hasFlash().then(setHasFlash))
      .catch(() =>
        setError('Нет доступа к камере. Разрешите доступ в настройках браузера или введите код вручную.'),
      );
    return () => {
      scanner.stop();
      scanner.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="camera">
      <video ref={videoRef} playsInline muted />
      <div className="camera-bar">
        {hint && <div className="camera-hint">{hint}</div>}
        {last && <div className="camera-last">Считано: {last}</div>}
        {error && <div className="camera-error">{error}</div>}
        <div className="row">
          {hasFlash && (
            <button
              className="btn"
              onClick={() => scannerRef.current.toggleFlash().then(() => setFlash(scannerRef.current.isFlashOn()))}
            >
              {flash ? 'Фонарь выкл' : 'Фонарь'}
            </button>
          )}
          <button className="btn primary" onClick={onClose}>
            {continuous ? 'Готово' : 'Закрыть'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Поле для кода: можно ввести вручную, считать USB-сканером (он «печатает» код и Enter) или камерой.
export function ScanField({ onScan, placeholder = 'Код с этикетки', continuous = false, hint, autoFocus }) {
  const [value, setValue] = useState('');
  const [camera, setCamera] = useState(false);
  const submit = (e) => {
    e.preventDefault();
    const code = normalizeCode(value);
    if (code) onScan(code);
    setValue('');
  };
  return (
    <>
      <form className="scanfield" onSubmit={submit}>
        <button type="button" className="btn primary scan-btn" onClick={() => setCamera(true)}>
          📷 Сканировать
        </button>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoCapitalize="characters"
          autoComplete="off"
        />
        <button type="submit" className="btn">
          OK
        </button>
      </form>
      {camera && (
        <CameraScanner onScan={onScan} onClose={() => setCamera(false)} continuous={continuous} hint={hint} />
      )}
    </>
  );
}
