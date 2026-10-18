import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useStore, allocateCodes } from '../store.js';
import { getMeta, setMeta } from '../db.js';
import { normalizeCode } from '../../../shared/state.js';
import { Section, Message, kindName, unitLabel } from '../ui.jsx';

const FORMAT_KEY = 'zapchasti.labelFormat';
const DEFAULT_FORMAT = { mode: 'roll', w: 40, h: 25, cols: 4 };

export async function addToPrintQueue(codes) {
  const q = await getMeta('printQueue', []);
  await setMeta('printQueue', [...new Set([...q, ...codes])]);
}

function caption(state, code) {
  if (state.locations[code]) return `${kindName(state.locations[code].kind)}: ${state.locations[code].name}`;
  if (state.units[code]) return unitLabel(state, code);
  return '';
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// Печать через обычный диалог браузера: на принтер этикеток (рулон) или на лист A4.
export async function printLabels(state, codes, format) {
  const area = document.getElementById('print-area');
  const svgs = await Promise.all(
    codes.map((c) => QRCode.toString(c, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })),
  );
  const { mode, w, h, cols } = format;
  const pageCss =
    mode === 'roll'
      ? `@page { size: ${w}mm ${h}mm; margin: 0 } #print-area .label { width: ${w}mm; height: ${h}mm; page-break-after: always; }`
      : `@page { size: A4; margin: 8mm } #print-area .sheet { display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: 2mm; }
         #print-area .label { height: ${h}mm; border: 0.2mm dashed #bbb; }`;
  area.innerHTML =
    `<style>${pageCss}</style><div class="${mode === 'roll' ? '' : 'sheet'}">` +
    codes
      .map(
        (c, i) => `<div class="label" style="--h:${h}mm">
          <div class="label-qr">${svgs[i]}</div>
          <div class="label-text"><div class="label-code">${esc(c)}</div><div class="label-cap">${esc(caption(state, c))}</div></div>
        </div>`,
      )
      .join('') +
    '</div>';
  await new Promise((r) => setTimeout(r, 50));
  window.print();
  // Стили печати глобальные, после печати убираем их, чтобы не задеть экран.
  area.innerHTML = '';
}

function loadFormat() {
  try {
    return { ...DEFAULT_FORMAT, ...JSON.parse(localStorage.getItem(FORMAT_KEY) || '{}') };
  } catch {
    return DEFAULT_FORMAT;
  }
}

export default function Labels({ params }) {
  const { state, online } = useStore();
  const [queue, setQueue] = useState([]);
  const [format, setFormat] = useState(loadFormat);
  const [blankCount, setBlankCount] = useState('20');
  const [blankPrefix, setBlankPrefix] = useState('P');
  const [extra, setExtra] = useState(params.code ? [normalizeCode(params.code)] : []);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    getMeta('printQueue', []).then(setQueue);
  }, []);

  const saveFormat = (patch) => {
    const f = { ...format, ...patch };
    setFormat(f);
    try {
      localStorage.setItem(FORMAT_KEY, JSON.stringify(f));
    } catch {
      /* не важно */
    }
  };

  async function printQueue() {
    await printLabels(state, queue, format);
    if (confirm('Этикетки напечатались? Очистить очередь печати?')) {
      await setMeta('printQueue', []);
      setQueue([]);
    }
  }

  async function printBlank() {
    setMsg(null);
    try {
      const codes = await allocateCodes(blankPrefix, Number(blankCount) || 1);
      await printLabels(state, codes, format);
      setMsg({ kind: 'ok', text: `Выданы коды ${codes[0]} … ${codes.at(-1)}. При приходе отсканируйте этикетку и выберите позицию.` });
    } catch (e) {
      setMsg({ kind: 'error', text: e.message });
    }
  }

  const locations = Object.values(state.locations).filter((l) => !l.archived);

  return (
    <>
      <Section title="Формат этикеток">
        <div className="seg">
          <button className={`btn ${format.mode === 'roll' ? 'primary' : ''}`} onClick={() => saveFormat({ mode: 'roll' })}>
            Принтер этикеток
          </button>
          <button className={`btn ${format.mode === 'a4' ? 'primary' : ''}`} onClick={() => saveFormat({ mode: 'a4' })}>
            Лист A4
          </button>
        </div>
        <div className="grid3">
          {format.mode === 'roll' && (
            <label className="field">
              Ширина, мм
              <input value={format.w} onChange={(e) => saveFormat({ w: Number(e.target.value) || 40 })} inputMode="numeric" />
            </label>
          )}
          <label className="field">
            Высота, мм
            <input value={format.h} onChange={(e) => saveFormat({ h: Number(e.target.value) || 25 })} inputMode="numeric" />
          </label>
          {format.mode === 'a4' && (
            <label className="field">
              Столбцов на листе
              <input value={format.cols} onChange={(e) => saveFormat({ cols: Number(e.target.value) || 4 })} inputMode="numeric" />
            </label>
          )}
        </div>
        <p className="muted small">
          Для принтера этикеток в окне печати выберите этот принтер и масштаб 100%. Для мастерской берите полиэстеровые
          этикетки с термотрансферной лентой: бумага не переживёт масло и солнце.
        </p>
      </Section>

      {extra.length > 0 && (
        <Section title="Напечатать выбранное">
          <p>{extra.map((c) => `${c} ${caption(state, c)}`).join(', ')}</p>
          <button className="btn primary" onClick={() => printLabels(state, extra, format)}>
            Печать
          </button>
          <button className="btn ghost" onClick={() => setExtra([])}>
            Убрать
          </button>
        </Section>
      )}

      <Section title={`Очередь печати (${queue.length})`}>
        {queue.length === 0 ? (
          <p className="muted">Пусто. Сюда попадают коды, выданные при приходе без этикетки.</p>
        ) : (
          <>
            <p className="small">{queue.join(', ')}</p>
            <button className="btn primary" onClick={printQueue}>
              Напечатать очередь
            </button>
          </>
        )}
      </Section>

      <Section title="Пустые этикетки впрок">
        <p className="muted small">
          Печатаете рулон заранее, а при приходе просто сканируете этикетку и выбираете, что это за запчасть.
        </p>
        <div className="grid2">
          <label className="field">
            Для чего
            <select value={blankPrefix} onChange={(e) => setBlankPrefix(e.target.value)}>
              <option value="P">Поштучный учёт (P-…)</option>
              <option value="B">Партии, коробки (B-…)</option>
            </select>
          </label>
          <label className="field">
            Сколько штук
            <input value={blankCount} onChange={(e) => setBlankCount(e.target.value)} inputMode="numeric" />
          </label>
        </div>
        <button className="btn primary" disabled={!online} onClick={printBlank}>
          Выдать коды и напечатать
        </button>
        {!online && <p className="muted small">Нужна связь с сервером.</p>}
        {msg && <Message kind={msg.kind}>{msg.text}</Message>}
      </Section>

      <Section title="Этикетки мест: склады, Газели, техника, сотрудники">
        <ul className="list">
          {locations.map((l) => (
            <li key={l.code} className="line">
              <span className="grow">
                {kindName(l.kind)}: {l.name} <span className="muted small">{l.code}</span>
              </span>
              <button className="btn small" onClick={() => printLabels(state, [l.code], format)}>
                Печать
              </button>
            </li>
          ))}
        </ul>
        {locations.length > 0 && (
          <button className="btn" onClick={() => printLabels(state, locations.map((l) => l.code), format)}>
            Напечатать все
          </button>
        )}
      </Section>
    </>
  );
}
