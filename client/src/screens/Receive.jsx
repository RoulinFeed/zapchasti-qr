import { useState } from 'react';
import { useStore, recordMany, allocateCodes, uid } from '../store.js';
import { normalizeCode, unitLocations } from '../../../shared/state.js';
import { ScanField } from '../Scanner.jsx';
import { Section, Message, ItemPicker, LocationSelect, fmtQty, locLabel } from '../ui.jsx';
import { addToPrintQueue } from './Labels.jsx';

const LAST_WH = 'zapchasti.lastWarehouse';

function NewItemForm({ onCreate, onCancel }) {
  const [f, setF] = useState({ name: '', sku: '', manufacturer: '', tracking: 'piece', unitName: 'шт' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="subcard">
      <h3>Новая позиция каталога</h3>
      <label className="field">
        Название*
        <input value={f.name} onChange={set('name')} autoFocus />
      </label>
      <div className="grid2">
        <label className="field">
          Артикул
          <input value={f.sku} onChange={set('sku')} />
        </label>
        <label className="field">
          Производитель
          <input value={f.manufacturer} onChange={set('manufacturer')} />
        </label>
        <label className="field">
          Учёт
          <select value={f.tracking} onChange={set('tracking')}>
            <option value="piece">Поштучно (QR на каждую)</option>
            <option value="batch">Партией (QR на коробку)</option>
          </select>
        </label>
        <label className="field">
          Ед. изм.
          <input value={f.unitName} onChange={set('unitName')} />
        </label>
      </div>
      <div className="row">
        <button className="btn primary" disabled={!f.name.trim()} onClick={() => onCreate({ ...f, id: uid(), name: f.name.trim() })}>
          Создать
        </button>
        <button className="btn" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </div>
  );
}

export default function Receive({ params }) {
  const { state, online } = useStore();
  const [warehouse, setWarehouse] = useState(() => {
    try {
      return localStorage.getItem(LAST_WH);
    } catch {
      return null;
    }
  });
  const [code, setCode] = useState(params.code ? normalizeCode(params.code) : null);
  const [item, setItem] = useState(null); // для новой этикетки
  const [newItem, setNewItem] = useState(null); // позиция, которую создаём вместе с приходом
  const [creating, setCreating] = useState(false);
  const [qty, setQty] = useState('1');
  const [serial, setSerial] = useState('');
  const [noLabel, setNoLabel] = useState(false); // приход без готовой этикетки: коды выдаст сервер
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const chooseWarehouse = (w) => {
    setWarehouse(w);
    try {
      localStorage.setItem(LAST_WH, w || '');
    } catch {
      /* не важно */
    }
  };

  const bound = code && state.units[code];
  const boundItem = bound && state.items[bound.itemId];
  const target = boundItem || item || newItem;
  const batch = target?.tracking === 'batch';

  function reset() {
    setCode(null);
    setItem(null);
    setNewItem(null);
    setQty('1');
    setSerial('');
    setNoLabel(false);
  }

  function onScan(c) {
    setMsg(null);
    if (state.locations[c]) {
      if (state.locations[c].kind === 'warehouse') chooseWarehouse(c);
      else setMsg({ kind: 'warn', text: 'Это не склад' });
      return;
    }
    if (!/^[PB]-/.test(c)) {
      setMsg({ kind: 'error', text: `${c} не похож на этикетку запчасти` });
      return;
    }
    setNoLabel(false);
    setCode(c);
  }

  const n = Number(String(qty).replace(',', '.'));
  const problems = [];
  if (!warehouse) problems.push('Выберите склад');
  if (!code && !noLabel) problems.push('Отсканируйте этикетку');
  if (!target) problems.push('Выберите позицию');
  if (!(n > 0)) problems.push('Количество должно быть больше нуля');
  if (!batch && noLabel && !Number.isInteger(n)) problems.push('Поштучно — целое число');
  if (!batch && code && n !== 1) problems.push('На одну этикетку поштучного учёта — одна штука');
  if (target && code && !bound && batch !== code.startsWith('B-'))
    problems.push(batch ? 'Для партии нужна этикетка B-…' : 'Для поштучного учёта нужна этикетка P-…');
  if (bound && !batch && unitLocations(state, code).length) problems.push('Эта деталь уже оприходована');
  if (noLabel && !online) problems.push('Для новых кодов нужна связь с сервером');

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const ops = [];
      if (newItem) ops.push({ kind: 'item.upsert', payload: newItem });
      let codes = code ? [code] : [];
      if (noLabel) {
        codes = await allocateCodes(batch ? 'B' : 'P', batch ? 1 : n);
        await addToPrintQueue(codes);
      }
      for (const c of codes) {
        if (!state.units[c]) {
          ops.push({
            kind: 'unit.bind',
            payload: { code: c, itemId: target.id, ...(serial && codes.length === 1 ? { serial } : {}) },
          });
        }
        ops.push({ kind: 'move', payload: { type: 'receipt', unit: c, qty: batch ? n : 1, to: warehouse } });
      }
      await recordMany(ops);
      setMsg({
        kind: 'ok',
        text: `Оприходовано: ${target.name}, ${fmtQty(n, target)} на «${locLabel(state, warehouse)}»${
          noLabel ? `. Коды ${codes.join(', ')} добавлены в очередь печати.` : ''
        }`,
      });
      reset();
    } catch (e) {
      setMsg({ kind: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Section title="Приход на склад">
        <div className="field">
          <div className="label">Склад</div>
          <LocationSelect value={warehouse} onChange={chooseWarehouse} kinds={['warehouse']} />
        </div>
        <div className="field">
          <div className="label">Этикетка</div>
          {code ? (
            <div className="row">
              <b>{code}</b>
              <button className="btn ghost small" onClick={reset}>
                Другая
              </button>
            </div>
          ) : noLabel ? (
            <div className="row">
              <span>Новые коды выдаст сервер, этикетки напечатаете потом.</span>
              <button className="btn ghost small" onClick={() => setNoLabel(false)}>
                Отмена
              </button>
            </div>
          ) : (
            <>
              <ScanField onScan={onScan} placeholder="Готовая этикетка P-… или B-…" />
              <button className="btn ghost small" onClick={() => setNoLabel(true)}>
                Нет этикетки — выдать новые коды
              </button>
            </>
          )}
        </div>

        {(code || noLabel) && (
          <div className="field">
            <div className="label">Позиция</div>
            {bound ? (
              <b>{boundItem?.name}</b>
            ) : target ? (
              <div className="row">
                <b>{target.name}</b>
                <button className="btn ghost small" onClick={() => (setItem(null), setNewItem(null))}>
                  Другая
                </button>
              </div>
            ) : creating ? (
              <NewItemForm onCreate={(it) => (setNewItem(it), setCreating(false))} onCancel={() => setCreating(false)} />
            ) : (
              <>
                <ItemPicker onPick={setItem} />
                <button className="btn ghost small" onClick={() => setCreating(true)}>
                  + Новая позиция
                </button>
              </>
            )}
          </div>
        )}

        {target && (
          <div className="grid2">
            {(batch || noLabel) && (
              <label className="field">
                Количество{!batch && ' (каждой штуке свой код)'}
                <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" />
              </label>
            )}
            {!batch && !bound && (code || n === 1) && (
              <label className="field">
                Серийный номер (если есть)
                <input value={serial} onChange={(e) => setSerial(e.target.value)} />
              </label>
            )}
          </div>
        )}

        {msg && <Message kind={msg.kind}>{msg.text}</Message>}
        {(code || noLabel) && problems.length > 0 && <Message kind="warn">{problems[0]}</Message>}
        {(code || noLabel) && (
          <button className="btn primary big" disabled={problems.length > 0 || busy} onClick={submit}>
            Оприходовать
          </button>
        )}
      </Section>
    </>
  );
}
