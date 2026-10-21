import { useEffect, useMemo, useRef, useState } from 'react';

// Таблица в духе Excel: выделенная ячейка, стрелки, Enter и Tab, ввод прямо в ячейку,
// копирование и вставка блоков из Excel. Последняя пустая строка — для новой записи.
//
// columns: [{ key, title, width, align, editable, render(row), value(row) }]
// onEdit(row | null, changes) — row = null для новой строки; changes = { key: text, ... }
export function Grid({ columns, rows, onEdit, onOpen, rowKey = (r) => r.id, rowClass, newRow = true }) {
  const [sel, setSel] = useState({ r: 0, c: firstEditable(columns) });
  const [anchor, setAnchor] = useState(null);
  const [edit, setEditState] = useState(null); // { r, c, text }
  // Текущая правка и в ref: Enter и потеря фокуса не должны сохранить одно значение дважды.
  const editRef = useRef(null);
  const setEdit = (v) => {
    editRef.current = v;
    setEditState(v);
  };
  const [sort, setSort] = useState(null); // { key, dir }
  const wrap = useRef(null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    const val = col.value || ((r) => r[col.key]);
    return [...rows].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const cmp =
        typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'ru');
      return sort.dir * cmp;
    });
  }, [rows, columns, sort]);

  const total = sorted.length + (newRow ? 1 : 0);
  const rowAt = (r) => (r < sorted.length ? sorted[r] : null);
  const cellText = (r, c) => {
    const row = rowAt(r);
    const col = columns[c];
    if (!row) return '';
    const v = col.value ? col.value(row) : row[col.key];
    return v == null ? '' : String(v);
  };

  useEffect(() => {
    if (sel.r >= total) setSel({ r: Math.max(0, total - 1), c: sel.c });
  }, [total, sel]);

  useEffect(() => {
    const td = wrap.current?.querySelector(`[data-cell="${sel.r}:${sel.c}"]`);
    td?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [sel]);

  const input = useRef(null);
  useEffect(() => {
    if (edit) input.current?.focus();
  }, [edit?.r, edit?.c]); // eslint-disable-line react-hooks/exhaustive-deps

  function focus() {
    if (editRef.current) return;
    wrap.current?.focus({ preventScroll: true });
  }

  function move(dr, dc, extend = false) {
    if (extend && !anchor) setAnchor(sel);
    if (!extend) setAnchor(null);
    setSel(({ r, c }) => ({
      r: Math.min(Math.max(r + dr, 0), total - 1),
      c: Math.min(Math.max(c + dc, 0), columns.length - 1),
    }));
  }

  function startEdit(text) {
    if (!columns[sel.c].editable) {
      if (rowAt(sel.r)) onOpen?.(rowAt(sel.r));
      return;
    }
    setAnchor(null);
    setEdit({ r: sel.r, c: sel.c, text: text ?? cellText(sel.r, sel.c) });
  }

  function commit(dr = 0, dc = 0) {
    const cur = editRef.current;
    if (cur) {
      setEdit(null);
      if (cur.text !== cellText(cur.r, cur.c)) onEdit(rowAt(cur.r), { [columns[cur.c].key]: cur.text });
    }
    move(dr, dc);
    setTimeout(focus);
  }

  function range() {
    const a = anchor || sel;
    return {
      r1: Math.min(a.r, sel.r),
      r2: Math.max(a.r, sel.r),
      c1: Math.min(a.c, sel.c),
      c2: Math.max(a.c, sel.c),
    };
  }

  function onKeyDown(e) {
    if (edit) return;
    const k = e.key;
    if (k === 'ArrowUp') return e.preventDefault(), move(-1, 0, e.shiftKey);
    if (k === 'ArrowDown') return e.preventDefault(), move(1, 0, e.shiftKey);
    if (k === 'ArrowLeft') return e.preventDefault(), move(0, -1, e.shiftKey);
    if (k === 'ArrowRight') return e.preventDefault(), move(0, 1, e.shiftKey);
    if (k === 'Tab') return e.preventDefault(), move(0, e.shiftKey ? -1 : 1);
    if (k === 'Home') return e.preventDefault(), setSel({ r: e.ctrlKey ? 0 : sel.r, c: 0 });
    if (k === 'End') return e.preventDefault(), setSel({ r: e.ctrlKey ? total - 1 : sel.r, c: columns.length - 1 });
    if (k === 'Enter' || k === 'F2') return e.preventDefault(), startEdit();
    if ((k === 'Delete' || k === 'Backspace') && columns[sel.c].editable && rowAt(sel.r)) {
      e.preventDefault();
      if (cellText(sel.r, sel.c) !== '') onEdit(rowAt(sel.r), { [columns[sel.c].key]: '' });
      return;
    }
    if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      startEdit(k);
    }
  }

  // Ctrl+C: выделенный блок уходит в буфер так, что вставляется в Excel по ячейкам.
  function onCopy(e) {
    if (edit) return;
    const { r1, r2, c1, c2 } = range();
    const lines = [];
    for (let r = r1; r <= r2; r++) {
      const cells = [];
      for (let c = c1; c <= c2; c++) cells.push(cellText(r, c).replace(/[\t\n]/g, ' '));
      lines.push(cells.join('\t'));
    }
    e.clipboardData.setData('text/plain', lines.join('\n'));
    e.preventDefault();
  }

  // Ctrl+V: блок из Excel ложится начиная с выделенной ячейки; лишние строки становятся новыми записями.
  function onPaste(e) {
    if (edit) return;
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, '').replace(/\n$/, '').split('\n');
    lines.forEach((line, i) => {
      const changes = {};
      line.split('\t').forEach((v, j) => {
        const col = columns[sel.c + j];
        if (col?.editable) changes[col.key] = v.trim();
      });
      if (Object.keys(changes).length) onEdit(rowAt(sel.r + i), changes);
    });
  }

  const { r1, r2, c1, c2 } = range();
  const inRange = (r, c) => anchor && r >= r1 && r <= r2 && c >= c1 && c <= c2;

  function renderRow(row, r) {
    return (
      <tr key={row ? rowKey(row) : 'new'} className={row ? rowClass?.(row) || '' : 'grid-new'}>
        <th className="grid-num">{row ? r + 1 : '+'}</th>
        {columns.map((col, c) => {
          const active = sel.r === r && sel.c === c;
          const editing = edit && edit.r === r && edit.c === c;
          return (
            <td
              key={col.key}
              data-cell={`${r}:${c}`}
              className={[
                active ? 'sel' : '',
                inRange(r, c) ? 'in-range' : '',
                col.editable ? '' : 'ro',
                col.align === 'right' ? 'num' : '',
              ].join(' ')}
              onMouseDown={(e) => {
                if (editing) return;
                if (e.shiftKey) {
                  if (!anchor) setAnchor(sel);
                } else setAnchor(null);
                if (editRef.current) commit();
                setSel({ r, c });
                setTimeout(focus);
              }}
              onDoubleClick={() => {
                setSel({ r, c });
                if (col.editable) setEdit({ r, c, text: cellText(r, c) });
                else if (row) onOpen?.(row);
              }}
            >
              {editing ? (
                <input
                  ref={input}
                  autoFocus
                  className="grid-input"
                  value={edit.text}
                  onChange={(e) => setEdit({ ...editRef.current, text: e.target.value })}
                  onBlur={() => editRef.current && commit()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.preventDefault(), commit(e.shiftKey ? -1 : 1, 0);
                    else if (e.key === 'Tab') e.preventDefault(), commit(0, e.shiftKey ? -1 : 1);
                    else if (e.key === 'Escape') setEdit(null), setTimeout(focus);
                  }}
                />
              ) : row ? (
                col.render ? (
                  col.render(row)
                ) : (
                  cellText(r, c)
                )
              ) : c === firstEditable(columns) ? (
                <span className="muted">новая позиция…</span>
              ) : null}
            </td>
          );
        })}
      </tr>
    );
  }

  return (
    <div className="grid-wrap" ref={wrap} tabIndex={0} onKeyDown={onKeyDown} onCopy={onCopy} onPaste={onPaste}>
      <table className="grid">
        <colgroup>
          <col style={{ width: 44 }} />
          {columns.map((c) => (
            <col key={c.key} style={{ width: c.width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="grid-num" />
            {columns.map((col) => (
              <th
                key={col.key}
                className={col.align === 'right' ? 'num' : ''}
                onClick={() =>
                  setSort((s) =>
                    s?.key !== col.key ? { key: col.key, dir: 1 } : s.dir === 1 ? { key: col.key, dir: -1 } : null,
                  )
                }
              >
                {col.title}
                {sort?.key === col.key && (sort.dir === 1 ? ' ▲' : ' ▼')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, r) => renderRow(row, r))}
          {newRow && renderRow(null, sorted.length)}
        </tbody>
      </table>
    </div>
  );
}

function firstEditable(columns) {
  return Math.max(
    0,
    columns.findIndex((c) => c.editable),
  );
}
