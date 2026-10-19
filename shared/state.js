// Общая логика сервера и приложения: состояние склада собирается из журнала операций.
// Операции только добавляются, поэтому одинаковый журнал всегда даёт одинаковое состояние.

export const OP_KINDS = ['item.upsert', 'location.upsert', 'unit.bind', 'move', 'issue.resolve'];

export const MOVE_TYPES = {
  receipt: 'Приход',
  transfer: 'Перемещение',
  install: 'Установка',
  remove: 'Снятие',
  writeoff: 'Списание',
  adjust: 'Корректировка',
};

export const LOCATION_KINDS = {
  warehouse: 'Склад',
  van: 'Газель',
  machine: 'Техника',
  person: 'Сотрудник',
};

export const CONDITIONS = {
  ok: 'Годная',
  repair: 'В ремонт',
  defect: 'Брак',
};

// Префиксы кодов на этикетках
export const CODE_PREFIX = {
  piece: 'P',
  batch: 'B',
  warehouse: 'W',
  van: 'V',
  machine: 'M',
  person: 'E',
};

export function emptyState() {
  return {
    items: {}, // id -> позиция каталога
    locations: {}, // code -> место
    units: {}, // code -> { code, itemId, serial, note, condition }
    stock: {}, // unitCode -> { locationCode -> qty }
    moves: [], // операции перемещения по порядку
    issues: [], // нестыковки, найденные при разборе журнала
    resolved: {}, // moveId -> { note, userName, createdAt } для разобранных нестыковок
  };
}

export function normalizeCode(raw) {
  return String(raw || '').trim().toUpperCase();
}

// Проверка формы операции. Возвращает текст ошибки или null.
export function validateOp(op) {
  if (!op || typeof op !== 'object') return 'операция должна быть объектом';
  if (typeof op.id !== 'string' || op.id.length < 8 || op.id.length > 64) return 'неверный id операции';
  if (!OP_KINDS.includes(op.kind)) return `неизвестный тип операции: ${op.kind}`;
  const p = op.payload;
  if (!p || typeof p !== 'object') return 'нет данных операции';
  switch (op.kind) {
    case 'item.upsert':
      if (!p.id || !p.name) return 'у позиции нужны id и название';
      if (p.tracking && !['piece', 'batch'].includes(p.tracking)) return 'учёт: piece или batch';
      return null;
    case 'location.upsert':
      if (!p.code || !p.name) return 'у места нужны код и название';
      if (!LOCATION_KINDS[p.kind]) return `неизвестный вид места: ${p.kind}`;
      return null;
    case 'unit.bind':
      if (!p.code || !p.itemId) return 'для привязки этикетки нужны код и позиция';
      return null;
    case 'move': {
      if (!p.unit) return 'не указана единица учёта';
      if (!MOVE_TYPES[p.type]) return `неизвестный вид движения: ${p.type}`;
      const qty = Number(p.qty);
      if (!Number.isFinite(qty) || qty <= 0) return 'количество должно быть больше нуля';
      if (!p.from && !p.to) return 'нужно указать откуда или куда';
      if (p.condition && !CONDITIONS[p.condition]) return 'неизвестное состояние';
      if (p.price != null && !(Number(p.price) >= 0)) return 'цена не может быть отрицательной';
      return null;
    }
    case 'issue.resolve':
      if (!p.moveId) return 'не указана операция';
      return null;
  }
  return null;
}

function addStock(state, unit, loc, delta) {
  if (!loc) return;
  const row = (state.stock[unit] ||= {});
  const next = (row[loc] || 0) + delta;
  if (Math.abs(next) < 1e-9) delete row[loc];
  else row[loc] = next;
}

// Применяет одну операцию к состоянию (мутирует его).
export function applyOp(state, op) {
  const p = op.payload;
  switch (op.kind) {
    case 'item.upsert': {
      const prev = state.items[p.id] || {};
      state.items[p.id] = {
        tracking: 'piece',
        unitName: 'шт',
        minQty: 0,
        ...prev,
        ...p,
        updatedAt: op.createdAt,
      };
      break;
    }
    case 'location.upsert': {
      const code = normalizeCode(p.code);
      state.locations[code] = { ...(state.locations[code] || {}), ...p, code };
      break;
    }
    case 'unit.bind': {
      const code = normalizeCode(p.code);
      const prev = state.units[code];
      // Первая привязка этикетки побеждает; повторная может менять только заметки.
      if (prev && prev.itemId !== p.itemId) break;
      state.units[code] = { condition: 'ok', ...(prev || {}), ...p, code, boundAt: prev?.boundAt || op.createdAt };
      break;
    }
    case 'move': {
      const unit = normalizeCode(p.unit);
      const qty = Number(p.qty);
      const from = p.from ? normalizeCode(p.from) : null;
      const to = p.to ? normalizeCode(p.to) : null;
      const issues = findIssues(state, { unit, qty, from, to, type: p.type });
      addStock(state, unit, from, -qty);
      addStock(state, unit, to, qty);
      if (p.condition && state.units[unit]) state.units[unit].condition = p.condition;
      for (const kind of issues) {
        state.issues.push({ moveId: op.id, kind, unit, from, to, qty, type: p.type, createdAt: op.createdAt, userName: op.userName });
      }
      state.moves.push({
        id: op.id,
        seq: op.seq,
        createdAt: op.createdAt,
        userId: op.userId,
        userName: op.userName,
        ...p,
        unit,
        from,
        to,
        qty,
      });
      break;
    }
    case 'issue.resolve':
      state.resolved[p.moveId] = { note: p.note || '', userName: op.userName, createdAt: op.createdAt };
      break;
  }
  return state;
}

export const ISSUE_KINDS = {
  short: 'Взяли больше, чем было по учёту',
  twice: 'Поштучная деталь числится в двух местах',
  nosource: 'Неизвестно, откуда взяли',
};

// Проверка движения до его применения. Такое бывает, когда люди работают без связи
// и узнают о действиях друг друга только при синхронизации.
function findIssues(state, { unit, qty, from, to, type }) {
  const res = [];
  const row = state.stock[unit] || {};
  const tracking = state.items[state.units[unit]?.itemId]?.tracking;
  if (from && (row[from] || 0) + 1e-9 < qty) res.push('short');
  if (!from && to && type !== 'receipt' && type !== 'adjust') {
    const elsewhere = Object.entries(row).some(([loc, q]) => loc !== to && q > 0);
    if (tracking !== 'piece' || !elsewhere) res.push('nosource');
  }
  if (tracking === 'piece' && to) {
    const after = { ...row };
    if (from) after[from] = (after[from] || 0) - qty;
    after[to] = (after[to] || 0) + qty;
    const places = Object.values(after).filter((q) => q > 1e-9);
    if (places.length > 1 || places.some((q) => q > 1 + 1e-9)) res.push('twice');
  }
  return res;
}

export function openIssues(state) {
  return state.issues.filter((i) => !state.resolved[i.moveId]);
}

export function buildState(ops) {
  const state = emptyState();
  for (const op of sortOps(ops)) applyOp(state, op);
  return state;
}

// Порядок: сначала подтверждённые сервером (по seq), затем ещё не отправленные (по времени создания).
export function sortOps(ops) {
  return [...ops].sort((a, b) => {
    const as = a.seq ?? Infinity;
    const bs = b.seq ?? Infinity;
    if (as !== bs) return as - bs;
    return String(a.createdAt).localeCompare(String(b.createdAt));
  });
}

// --- выборки для экранов и отчётов ---

export function unitLocations(state, unitCode) {
  const row = state.stock[normalizeCode(unitCode)] || {};
  return Object.entries(row)
    .filter(([, q]) => q > 0)
    .map(([loc, qty]) => ({ loc, qty }));
}

export function locationContents(state, locCode) {
  const code = normalizeCode(locCode);
  const res = [];
  for (const [unit, row] of Object.entries(state.stock)) {
    const qty = row[code];
    if (qty && qty > 0) {
      const u = state.units[unit];
      res.push({ unit, qty, item: u ? state.items[u.itemId] : null, condition: u?.condition });
    }
  }
  return res.sort((a, b) => (a.item?.name || a.unit).localeCompare(b.item?.name || b.unit, 'ru'));
}

export function itemTotals(state) {
  const totals = {};
  for (const id of Object.keys(state.items)) totals[id] = { total: 0, byKind: {}, units: 0 };
  for (const [unit, row] of Object.entries(state.stock)) {
    const u = state.units[unit];
    if (!u || !totals[u.itemId]) continue;
    for (const [loc, qty] of Object.entries(row)) {
      if (qty <= 0) continue;
      const kind = state.locations[loc]?.kind || 'unknown';
      // То, что установлено на технику, уже не запас.
      if (kind === 'machine') continue;
      totals[u.itemId].total += qty;
      totals[u.itemId].byKind[kind] = (totals[u.itemId].byKind[kind] || 0) + qty;
    }
  }
  for (const u of Object.values(state.units)) if (totals[u.itemId]) totals[u.itemId].units++;
  return totals;
}

export function lowStock(state) {
  const totals = itemTotals(state);
  return Object.values(state.items)
    .filter((it) => !it.archived && Number(it.minQty) > 0 && totals[it.id].total < Number(it.minQty))
    .map((it) => ({ item: it, total: totals[it.id].total }));
}

export function movesFor(state, { unit, location, itemId } = {}) {
  const u = unit && normalizeCode(unit);
  const l = location && normalizeCode(location);
  return state.moves.filter((m) => {
    if (u && m.unit !== u) return false;
    if (l && m.from !== l && m.to !== l) return false;
    if (itemId && state.units[m.unit]?.itemId !== itemId) return false;
    return true;
  });
}

// Сравнение инвентаризации: найдено (unit -> qty) против учёта на месте.
export function inventoryDiff(state, locCode, found) {
  const expected = Object.fromEntries(locationContents(state, locCode).map((r) => [r.unit, r.qty]));
  const all = new Set([...Object.keys(expected), ...Object.keys(found)]);
  const rows = [];
  for (const unit of all) {
    const exp = expected[unit] || 0;
    const fnd = found[unit] || 0;
    if (exp !== fnd) rows.push({ unit, expected: exp, found: fnd, delta: fnd - exp });
  }
  return rows;
}

// Цена единицы в движении: зафиксированная в момент операции, иначе текущая из каталога.
export function movePrice(state, m) {
  if (m.price != null) return Number(m.price);
  const it = state.items[state.units[m.unit]?.itemId];
  return Number(it?.price) || 0;
}

// Затраты за период: что поставили на технику (сумма по цене) в разрезе техники и механиков.
export function installCosts(state, { from, to } = {}) {
  const machines = {};
  const people = {};
  let total = 0;
  let unpriced = 0;
  for (const m of state.moves) {
    if (m.type !== 'install') continue;
    if (from && m.createdAt < from) continue;
    if (to && m.createdAt > to) continue;
    const price = movePrice(state, m);
    if (!price) unpriced++;
    const sum = price * m.qty;
    total += sum;
    const mc = (machines[m.to] ||= { code: m.to, sum: 0, count: 0, moves: [] });
    mc.sum += sum;
    mc.count += 1;
    mc.moves.push({ ...m, price, sum });
    const key = m.userName || '—';
    const pc = (people[key] ||= { name: key, sum: 0, count: 0 });
    pc.sum += sum;
    pc.count += 1;
  }
  const byMachine = Object.values(machines).sort((a, b) => b.sum - a.sum);
  const byPerson = Object.values(people).sort((a, b) => b.sum - a.sum);
  return { total, unpriced, byMachine, byPerson };
}

// Стоимость запаса по видам мест (склады, Газели, сотрудники). Установленное на технику не входит.
export function stockValue(state) {
  const byKind = {};
  let total = 0;
  for (const [unit, row] of Object.entries(state.stock)) {
    const price = Number(state.items[state.units[unit]?.itemId]?.price) || 0;
    if (!price) continue;
    for (const [loc, qty] of Object.entries(row)) {
      const kind = state.locations[loc]?.kind;
      if (qty <= 0 || kind === 'machine') continue;
      byKind[kind] = (byKind[kind] || 0) + qty * price;
      total += qty * price;
    }
  }
  return { total, byKind };
}
