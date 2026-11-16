// Закупка: заявка → цены поставщиков → распределение количества → заказы.
// Всё хранится операциями в том же журнале, что и движения, поэтому работает без связи
// и одинаково собирается на сервере и в приложении.

export const PURCHASE_OPS = ['supplier.upsert', 'purchase.upsert', 'purchase.line', 'offer.list', 'alloc.set', 'map.set'];

export const PURCHASE_STATUS = {
  collect: 'Сбор цен',
  ordered: 'Заказано',
  closed: 'Закрыта',
};

export const OFFER_SOURCES = {
  excel: 'Excel',
  pdf: 'PDF',
  text: 'Вставка текста',
  message: 'Сообщение',
  manual: 'Вручную',
};

const EPS = 1e-9;

export function emptyPurchaseState() {
  return {
    suppliers: {}, // id -> { id, name, contact, note }
    purchases: {}, // id -> заявка со строками, предложениями и распределением
    supplierMap: {}, // supplierId -> { ключ их позиции -> itemId }
  };
}

const num = (v) => (v === '' || v == null ? null : Number(v));
const isQty = (v) => v == null || v === '' || (Number.isFinite(Number(v)) && Number(v) >= 0);

export function validatePurchaseOp(op) {
  const p = op.payload;
  switch (op.kind) {
    case 'supplier.upsert':
      if (!p.id || !String(p.name || '').trim()) return 'у поставщика нужны id и название';
      return null;
    case 'purchase.upsert':
      if (!p.id) return 'не указана заявка';
      if (p.status && !PURCHASE_STATUS[p.status]) return `неизвестное состояние заявки: ${p.status}`;
      return null;
    case 'purchase.line':
      if (!p.purchaseId || !p.id) return 'у строки заявки нужны заявка и id';
      if (!isQty(p.qty)) return 'количество в заявке не может быть отрицательным';
      return null;
    case 'offer.list': {
      if (!p.purchaseId || !p.supplierId) return 'у прайса нужны заявка и поставщик';
      if (!Array.isArray(p.rows)) return 'в прайсе нет строк';
      if (p.source && !OFFER_SOURCES[p.source]) return `неизвестный источник прайса: ${p.source}`;
      for (const r of p.rows) {
        if (!r || !r.lineId) return 'строка прайса не сопоставлена с заявкой';
        if (r.remove) continue;
        const price = Number(r.price);
        if (!Number.isFinite(price) || price < 0) return 'цена должна быть числом не меньше нуля';
        if (!isQty(r.qty)) return 'количество в прайсе не может быть отрицательным';
      }
      return null;
    }
    case 'alloc.set':
      if (!p.purchaseId || !p.lineId || !p.supplierId) return 'для распределения нужны заявка, строка и поставщик';
      if (!(Number(p.qty) >= 0)) return 'количество не может быть отрицательным';
      return null;
    case 'map.set':
      if (!p.supplierId || !p.key) return 'для сопоставления нужны поставщик и позиция';
      return null;
  }
  return null;
}

function purchase(state, id, op) {
  return (state.purchases[id] ||= {
    id,
    title: '',
    note: '',
    status: 'collect',
    createdAt: op.createdAt,
    userName: op.userName,
    lines: {},
    lineOrder: [],
    offers: {}, // lineId -> supplierId -> предложение
    alloc: {}, // lineId -> supplierId -> { qty, price }
    lists: [], // загруженные прайсы и сообщения, по порядку
  });
}

const sameOffer = (a, b) => a && b && a.price === b.price && a.qty === b.qty && !a.withdrawn && !b.withdrawn;

export function applyPurchaseOp(state, op) {
  const p = op.payload;
  switch (op.kind) {
    case 'supplier.upsert': {
      state.suppliers[p.id] = { ...(state.suppliers[p.id] || {}), ...p, name: String(p.name).trim() };
      break;
    }
    case 'purchase.upsert': {
      const pu = purchase(state, p.id, op);
      for (const k of ['title', 'note', 'status']) if (p[k] != null) pu[k] = p[k];
      if (p.status) pu.statusAt = op.createdAt;
      break;
    }
    case 'purchase.line': {
      const pu = purchase(state, p.purchaseId, op);
      const prev = pu.lines[p.id];
      const { purchaseId, ...rest } = p;
      pu.lines[p.id] = { qty: 0, unitName: 'шт', ...(prev || {}), ...rest, qty: Number(p.qty ?? prev?.qty ?? 0) };
      if (!prev) pu.lineOrder.push(p.id);
      break;
    }
    case 'offer.list': {
      const pu = purchase(state, p.purchaseId, op);
      const at = p.receivedAt || op.createdAt;
      const meta = { at, source: p.source || 'manual', fileName: p.fileName || '', listId: op.id };
      const seen = new Set();
      for (const r of p.rows) {
        const byLine = (pu.offers[r.lineId] ||= {});
        const prev = byLine[p.supplierId];
        seen.add(r.lineId);
        if (r.remove) {
          if (prev && !prev.withdrawn) push(byLine, p.supplierId, prev, { ...prev, ...meta, withdrawn: true });
          continue;
        }
        const next = {
          ...meta,
          price: Number(r.price),
          qty: num(r.qty),
          supName: r.supName || prev?.supName || '',
          supCode: r.supCode || prev?.supCode || '',
          withdrawn: false,
        };
        push(byLine, p.supplierId, prev, next);
      }
      // Полный прайс заменяет прежний: чего в нём нет, то поставщик больше не предлагает.
      if (p.full) {
        for (const [lineId, byLine] of Object.entries(pu.offers)) {
          const prev = byLine[p.supplierId];
          if (!seen.has(lineId) && prev && !prev.withdrawn)
            push(byLine, p.supplierId, prev, { ...prev, ...meta, withdrawn: true });
        }
      }
      pu.lists.push({
        id: op.id,
        supplierId: p.supplierId,
        at,
        createdAt: op.createdAt,
        userName: op.userName,
        source: meta.source,
        fileName: meta.fileName,
        full: !!p.full,
        count: p.rows.filter((r) => !r.remove).length,
        note: p.note || '',
      });
      break;
    }
    case 'alloc.set': {
      const pu = purchase(state, p.purchaseId, op);
      const byLine = (pu.alloc[p.lineId] ||= {});
      const qty = Number(p.qty);
      if (qty > EPS) byLine[p.supplierId] = { qty, price: num(p.price), at: op.createdAt };
      else delete byLine[p.supplierId];
      break;
    }
    case 'map.set': {
      // Их позиция → наша: позиция каталога, а если строка заявки не из каталога — её название.
      const m = (state.supplierMap[p.supplierId] ||= {});
      if (p.itemId) m[p.key] = p.itemId;
      else if (p.lineName) m[p.key] = `name:${normName(p.lineName)}`;
      else delete m[p.key];
      break;
    }
  }
  return state;
}

// Новое предложение того же поставщика заменяет прежнее, а прежнее уходит в историю.
function push(byLine, supplierId, prev, next) {
  const history = prev?.history ? [...prev.history] : [];
  if (prev && !sameOffer(prev, next)) {
    const { history: _h, ...old } = prev;
    history.push(old);
  }
  // Цена та же: обновляем только дату и источник, историю не засоряем.
  byLine[supplierId] = { ...next, history };
}

// --- выборки ---

export function purchaseLines(pu) {
  return pu.lineOrder.map((id) => pu.lines[id]).filter((l) => l && !l.deleted);
}

// Предложения по строке: действующие, от дешёвого к дорогому.
export function lineOffers(pu, lineId) {
  return Object.entries(pu.offers[lineId] || {})
    .filter(([, o]) => !o.withdrawn)
    .map(([supplierId, o]) => ({ supplierId, ...o }))
    .sort((a, b) => a.price - b.price);
}

// Лучшая цена среди тех, у кого товар есть (неизвестное наличие считаем «есть»).
export function bestOffer(pu, lineId) {
  return lineOffers(pu, lineId).find((o) => o.qty == null || o.qty > EPS) || null;
}

// Как цена менялась от прайса к прайсу: «было 1200, стало 1100».
export function priceTrend(offer) {
  const prev = [...(offer?.history || [])].reverse().find((h) => !h.withdrawn && h.price !== offer.price);
  if (!prev) return null;
  return { was: prev.price, now: offer.price, delta: offer.price - prev.price };
}

export function lineAlloc(pu, lineId) {
  return Object.entries(pu.alloc[lineId] || {}).map(([supplierId, a]) => ({ supplierId, ...a }));
}

export function lineStatus(pu, line) {
  const offers = pu.offers[line.id] || {};
  const allocs = lineAlloc(pu, line.id);
  const allocated = allocs.reduce((s, a) => s + a.qty, 0);
  let sum = 0;
  const problems = [];
  const warnings = [];
  for (const a of allocs) {
    const o = offers[a.supplierId];
    if (!o || o.withdrawn) {
      problems.push({ supplierId: a.supplierId, kind: 'nooffer' });
      sum += a.qty * (a.price || 0);
      continue;
    }
    sum += a.qty * o.price;
    if (o.qty != null && a.qty > o.qty + EPS) problems.push({ supplierId: a.supplierId, kind: 'overstock', have: o.qty });
    if (a.price != null && Math.abs(a.price - o.price) > EPS)
      warnings.push({ supplierId: a.supplierId, kind: 'price', was: a.price, now: o.price });
  }
  const need = Number(line.qty) || 0;
  const remaining = need - allocated;
  if (remaining > EPS) problems.push({ kind: 'short', qty: remaining });
  if (remaining < -EPS) problems.push({ kind: 'extra', qty: -remaining });
  return { need, allocated, remaining, sum, problems, warnings, best: bestOffer(pu, line.id) };
}

export const PROBLEM_TEXT = {
  short: (p) => `не распределено ${fmt(p.qty)}`,
  extra: (p) => `распределено на ${fmt(p.qty)} больше, чем нужно`,
  overstock: (p, name) => `у «${name}» есть только ${fmt(p.have)}`,
  nooffer: (p, name) => `у «${name}» больше нет цены на эту позицию`,
  price: (p, name) => `«${name}» изменил цену: было ${fmt(p.was)}, стало ${fmt(p.now)}`,
};

const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

// Можно ли оформлять заказы: всё распределено, ничего не превышает наличие.
export function purchaseCheck(pu) {
  const lines = purchaseLines(pu).filter((l) => Number(l.qty) > 0);
  const problems = [];
  const warnings = [];
  let total = 0;
  let done = 0;
  for (const line of lines) {
    const st = lineStatus(pu, line);
    total += st.sum;
    if (!st.problems.length) done++;
    for (const p of st.problems) problems.push({ ...p, lineId: line.id });
    for (const w of st.warnings) warnings.push({ ...w, lineId: line.id });
  }
  return { ok: lines.length > 0 && problems.length === 0, problems, warnings, total, done, count: lines.length };
}

// Автораспределение: начиная с самой низкой цены, сколько есть у каждого поставщика.
// Трогает только строки, где ещё ничего не распределено (или все, если all = true).
export function autoAllocate(pu, { all = false } = {}) {
  const changes = [];
  for (const line of purchaseLines(pu)) {
    const current = lineAlloc(pu, line.id);
    if (!all && current.length) continue;
    let left = Number(line.qty) || 0;
    const plan = {};
    for (const o of lineOffers(pu, line.id)) {
      if (left <= EPS) break;
      const can = o.qty == null ? left : Math.min(left, o.qty);
      if (can <= EPS) continue;
      plan[o.supplierId] = { qty: can, price: o.price };
      left -= can;
    }
    for (const a of current) if (!plan[a.supplierId]) changes.push({ lineId: line.id, supplierId: a.supplierId, qty: 0 });
    for (const [supplierId, a] of Object.entries(plan)) {
      const cur = current.find((c) => c.supplierId === supplierId);
      if (!cur || Math.abs(cur.qty - a.qty) > EPS || cur.price !== a.price)
        changes.push({ lineId: line.id, supplierId, qty: a.qty, price: a.price });
    }
  }
  return changes;
}

// Заказы: по одному на каждого поставщика из распределения.
export function purchaseOrders(state, pu) {
  const bySupplier = {};
  for (const line of purchaseLines(pu)) {
    for (const a of lineAlloc(pu, line.id)) {
      const o = pu.offers[line.id]?.[a.supplierId];
      const price = o && !o.withdrawn ? o.price : a.price || 0;
      const order = (bySupplier[a.supplierId] ||= {
        supplierId: a.supplierId,
        supplier: state.suppliers[a.supplierId] || { id: a.supplierId, name: '?' },
        rows: [],
        total: 0,
      });
      const item = line.itemId ? state.items?.[line.itemId] : null;
      order.rows.push({
        lineId: line.id,
        name: item?.name || line.name,
        sku: item?.sku || line.sku || '',
        unitName: line.unitName || item?.unitName || 'шт',
        supName: o?.supName || '',
        supCode: o?.supCode || '',
        qty: a.qty,
        price,
        sum: a.qty * price,
      });
      order.total += a.qty * price;
    }
  }
  return Object.values(bySupplier).sort((a, b) => a.supplier.name.localeCompare(b.supplier.name, 'ru'));
}

// Поставщики, у которых есть хоть одна цена в заявке, в порядке появления.
export function purchaseSuppliers(state, pu) {
  const ids = [];
  for (const l of pu.lists) if (!ids.includes(l.supplierId)) ids.push(l.supplierId);
  for (const byLine of Object.values(pu.alloc)) for (const s of Object.keys(byLine)) if (!ids.includes(s)) ids.push(s);
  return ids.map((id) => state.suppliers[id] || { id, name: '?' });
}

// --- сопоставление строк прайса с заявкой ---

// Ключ позиции поставщика: артикул без пробелов и знаков, иначе название.
export function offerKey({ code, name }) {
  const c = normCode(code);
  if (c) return `code:${c}`;
  const n = normName(name);
  return n ? `name:${n}` : '';
}

export function normCode(s) {
  return String(s ?? '')
    .toUpperCase()
    .replace(/[\s.\-_/\\]/g, '')
    .replace(/^0+(?=\d)/, '');
}

export function normName(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .trim();
}

function words(s) {
  return new Set(normName(s).split(' ').filter((w) => w.length > 1));
}

// Похожесть названий: доля общих слов. Цифры (размеры, номера) весят больше.
function nameScore(a, b) {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let common = 0;
  let total = 0;
  for (const w of new Set([...A, ...B])) {
    const weight = /\d/.test(w) ? 2 : 1;
    total += weight;
    if (A.has(w) && B.has(w)) common += weight;
  }
  return common / total;
}

// Какая доля слов нашей позиции нашлась в их тексте (для сообщений, где вокруг много лишних слов).
function coverage(text, ours) {
  const T = words(text);
  const O = words(ours);
  if (!O.size) return 0;
  let hit = 0;
  let total = 0;
  for (const w of O) {
    const weight = /\d/.test(w) ? 2 : 1;
    total += weight;
    if (T.has(w)) hit += weight;
  }
  return hit / total;
}

// Ищет строку заявки для строки прайса.
// how: map — уже подтверждали раньше, code — совпал артикул, name — похоже по названию (проверить глазами).
export function matchOfferRow(state, pu, supplierId, row) {
  const lines = purchaseLines(pu);
  const map = state.supplierMap[supplierId] || {};
  const codeKey = row.code ? `code:${normCode(row.code)}` : '';
  const nameKey = row.name ? `name:${normName(row.name)}` : '';
  for (const key of [codeKey, nameKey]) {
    const ref = key && map[key];
    if (!ref) continue;
    const line = ref.startsWith('name:')
      ? lines.find((l) => !l.itemId && `name:${normName(l.name)}` === ref)
      : lines.find((l) => l.itemId === ref);
    if (line) return { lineId: line.id, how: 'map' };
  }
  const code = normCode(row.code);
  if (code) {
    for (const l of lines) {
      const skus = [l.sku, l.itemId && state.items?.[l.itemId]?.sku].map(normCode).filter(Boolean);
      if (skus.includes(code)) return { lineId: l.id, how: 'code' };
    }
  }
  let best = null;
  for (const l of lines) {
    const name = (l.itemId && state.items?.[l.itemId]?.name) || l.name;
    const s = Math.max(nameScore(row.name, name), coverage(row.name, name) * 0.85);
    if (s >= 0.5 && (!best || s > best.score)) best = { lineId: l.id, how: 'name', score: s };
  }
  return best || { lineId: null, how: null };
}

// --- разбор чисел из прайсов и сообщений ---

// «1 200,50 руб.» → 1200.5; пусто или текст → null.
export function parseNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '')
    .replace(/ /g, ' ')
    .replace(/(руб|р\.|₽|шт|ед|компл|кмп)\S*/gi, '')
    .trim();
  const m = s.match(/\d(?:[\d\s.,]*\d)?/);
  if (!m) return null;
  let t = m[0].replace(/\s/g, '');
  const seps = t.match(/[.,]/g) || [];
  if (seps.length) {
    const last = Math.max(t.lastIndexOf('.'), t.lastIndexOf(','));
    const tail = t.slice(last + 1);
    // «1.200,50», «1,200.50», «1.200.000»: знаки до последнего — разделители тысяч.
    // Один знак и ровно три цифры после него («1.200») — тоже тысячи: копейки пишут двумя цифрами.
    const thousandsOnly = new Set(seps).size === 1 && (seps.length > 1 || tail.length === 3);
    if (thousandsOnly) t = t.replace(/[.,]/g, '');
    else t = t.slice(0, last).replace(/[.,]/g, '') + '.' + tail;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// Наличие: «5», «5 шт», «>10» → число; «нет», «под заказ» → 0; пусто или «есть» → null (неизвестно).
export function parseStock(v) {
  if (typeof v === 'number') return v >= 0 ? v : null;
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/^(нет|0|-|—|отсутств|под заказ|ожида)/.test(s)) return 0;
  const n = parseNumber(s.replace(/^[<>≥≤+]+/, ''));
  return n != null && n >= 0 ? n : null;
}

// Цена и количество из сообщения в Telegram: «Подшипник 6205 — 5 шт по 1 150 р».
export function parseMessage(text) {
  const s = String(text || '').replace(/ /g, ' ');
  const price =
    s.match(/(\d[\d\s]*(?:[.,]\d{1,2})?)\s*(?:₽|руб|р\b|р\.)/i)?.[1] ||
    s.match(/(?:цена|по|за)\s*:?\s*(\d[\d\s]*(?:[.,]\d{1,2})?)/i)?.[1];
  const qty = s.match(/(\d+(?:[.,]\d+)?)\s*(?:шт|ед|компл|кмп|pcs)/i)?.[1];
  return { price: price != null ? parseNumber(price) : null, qty: qty != null ? parseNumber(qty) : null };
}

// --- таблица из файла или вставки: поиск строки заголовков и колонок ---

const HEAD = {
  name: /наимен|название|товар|номенклат|описан|позиц|деталь/i,
  code: /артикул|код|каталож|номер|кат\.?\s*№|part|№\s*детал/i,
  price: /цена|стоим|руб|₽|price/i,
  qty: /кол|наличи|остат|склад|шт|qty/i,
};

export function guessColumns(rows) {
  let headerRow = -1;
  let bestHits = 0;
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const cells = rows[r].map((c) => String(c ?? ''));
    const hits = Object.values(HEAD).filter((re) => cells.some((c) => c.length < 60 && re.test(c))).length;
    if (hits > bestHits) {
      bestHits = hits;
      headerRow = r;
    }
  }
  if (bestHits < 2) headerRow = -1;
  const map = { name: '', code: '', price: '', qty: '' };
  if (headerRow >= 0) {
    const cells = rows[headerRow].map((c) => String(c ?? ''));
    const used = new Set();
    // Сначала цена и артикул: слова «код» и «кол-во» в названии колонки не должны путаться.
    for (const key of ['price', 'code', 'qty', 'name']) {
      const i = cells.findIndex((c, i) => !used.has(i) && c.length < 60 && HEAD[key].test(c));
      if (i >= 0) {
        map[key] = String(i);
        used.add(i);
      }
    }
  }
  const body = rows.slice(headerRow + 1);
  // Без заголовков: цена — самая правая колонка с дробными числами, название — самая длинная текстовая.
  if (!map.price || !map.name) {
    const width = Math.max(0, ...body.map((r) => r.length));
    const stats = Array.from({ length: width }, (_, i) => {
      const vals = body.map((r) => r[i]).filter((v) => v != null && String(v).trim() !== '');
      const nums = vals.filter((v) => parseNumber(v) != null && /^[\d\s.,]+(руб|р|₽)?\.?$/i.test(String(v).trim()));
      const len = vals.reduce((s, v) => s + String(v).length, 0) / (vals.length || 1);
      return { i, n: vals.length, nums: nums.length, len };
    });
    if (!map.name) {
      const t = stats.filter((s) => s.n && s.nums < s.n / 2).sort((a, b) => b.len - a.len)[0];
      if (t) map.name = String(t.i);
    }
    if (!map.price) {
      const p = stats.filter((s) => s.n && s.nums >= s.n * 0.6 && String(s.i) !== map.name).pop();
      if (p) map.price = String(p.i);
    }
  }
  return { headerRow, map };
}

// Разбор вставленного текста: из Excel приходит через табуляцию, из PDF — через несколько пробелов.
export function parseTable(text) {
  const lines = String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = lines.some((l) => l.includes('\t')) ? /\t/ : lines.filter((l) => l.includes(';')).length > lines.length / 2 ? /;/ : /\s{2,}|\t/;
  return lines.map((l) => l.split(sep).map((c) => c.trim()));
}
