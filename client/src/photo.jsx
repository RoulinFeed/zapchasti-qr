import { useRef, useState } from 'react';
import { api } from './api.js';

export function photoUrl(id) {
  return id ? `/api/photos/${id}` : null;
}

// Уменьшаем снимок с телефона (там бывает 5–10 МБ) до ~1000 px, JPEG около 150 КБ.
async function shrink(file, max = 1024) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Не удалось открыть картинку'));
      i.src = url;
    });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * k);
    canvas.height = Math.round(img.naturalHeight * k);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadPhoto(file) {
  const data = await shrink(file);
  const { id } = await api('/api/photos', { data });
  return id;
}

export function Thumb({ id, size = 44 }) {
  const style = { width: size, height: size };
  if (!id) return <span className="thumb empty" style={style} aria-hidden="true" />;
  return <img className="thumb" style={style} src={photoUrl(id)} alt="" loading="lazy" />;
}

export function Photo({ id }) {
  const [big, setBig] = useState(false);
  if (!id) return null;
  return (
    <>
      <img className="photo" src={photoUrl(id)} alt="Фото запчасти" onClick={() => setBig(true)} />
      {big && (
        <div className="lightbox" onClick={() => setBig(false)}>
          <img src={photoUrl(id)} alt="Фото запчасти" />
        </div>
      )}
    </>
  );
}

// Поле фото в форме: снять камерой, выбрать картинку из галереи или с компьютера, убрать.
export function PhotoInput({ value, onChange }) {
  const cameraRef = useRef(null);
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      onChange(await uploadPhoto(file));
    } catch (ex) {
      setErr(ex.status === 0 ? 'Для загрузки фото нужна связь с сервером' : ex.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field">
      <div className="label">Фото</div>
      <div className="photo-input">
        {value ? <Photo id={value} /> : <span className="photo empty">Нет фото</span>}
        <div className="photo-actions">
          <button type="button" className="btn small" disabled={busy} onClick={() => cameraRef.current.click()}>
            📷 Сфотографировать
          </button>
          <button type="button" className="btn small" disabled={busy} onClick={() => fileRef.current.click()}>
            Выбрать картинку
          </button>
          {value && (
            <button type="button" className="btn ghost small" disabled={busy} onClick={() => onChange(null)}>
              Убрать
            </button>
          )}
          {busy && <span className="muted small">Загрузка…</span>}
        </div>
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
      {err && <div className="msg msg-error">{err}</div>}
    </div>
  );
}
