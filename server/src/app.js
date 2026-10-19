import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateOp, CODE_PREFIX } from '../../shared/state.js';
import { canWrite, checkPin, hashPin, isAdmin, newToken, ROLES } from './auth.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MECHANIC_MOVES = ['transfer', 'install', 'remove'];
const PAGE = 5000;
const PHOTO_ID = /^[0-9a-f-]{36}$/;
const MAX_PHOTO = 3 * 1024 * 1024;

// Фото определяем по первым байтам, а не по тому, что прислал клиент.
function photoType(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.slice(0, 4).toString('hex') === '89504e47') return 'image/png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

export async function migrate(pool) {
  await pool.query(readFileSync(path.join(here, 'schema.sql'), 'utf8'));
}

// Первый запуск: создаём администратора из переменных окружения.
export async function ensureAdmin(pool, { login, name, pin }) {
  const { rows } = await pool.query('select count(*)::int as n from users');
  if (rows[0].n > 0 || !login || !pin) return false;
  await pool.query('insert into users (login, name, role, pin_hash) values ($1, $2, $3, $4)', [
    login,
    name || login,
    'owner',
    hashPin(pin),
  ]);
  return true;
}

function publicUser(u) {
  return { id: u.id, login: u.login, name: u.name, role: u.role, active: u.active };
}

function rowToOp(r) {
  return {
    seq: Number(r.seq),
    id: r.id,
    kind: r.kind,
    payload: r.payload,
    userId: r.user_id,
    userName: r.user_name,
    createdAt: r.created_at.toISOString(),
  };
}

function formatCode(prefix, n) {
  const width = prefix === 'P' || prefix === 'B' ? 6 : 3;
  return `${prefix}-${String(n).padStart(width, '0')}`;
}

export function buildApp({ pool, staticDir, photoDir, logger = false }) {
  const app = Fastify({ logger, bodyLimit: 10 * 1024 * 1024 });
  if (photoDir) mkdirSync(photoDir, { recursive: true });

  // Фото отдаются без входа: id случайный и не угадывается, а тег <img> не умеет передавать токен.
  app.get('/api/photos/:id', async (req, reply) => {
    const { id } = req.params;
    if (!photoDir || !PHOTO_ID.test(id)) return reply.code(404).send({ error: 'Не найдено' });
    try {
      const buf = await readFile(path.join(photoDir, id));
      return reply
        .type(photoType(buf) || 'application/octet-stream')
        .header('cache-control', 'public, max-age=31536000, immutable')
        .send(buf);
    } catch {
      return reply.code(404).send({ error: 'Не найдено' });
    }
  });

  async function auth(req, reply) {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return reply.code(401).send({ error: 'Нужно войти' });
    const { rows } = await pool.query(
      'select u.* from sessions s join users u on u.id = s.user_id where s.token = $1 and u.active',
      [token],
    );
    if (!rows[0]) return reply.code(401).send({ error: 'Сессия истекла, войдите заново' });
    req.user = rows[0];
  }

  function adminOnly(req, reply, done) {
    if (!isAdmin(req.user.role)) return reply.code(403).send({ error: 'Только для руководителя' });
    done();
  }

  app.get('/api/health', async () => ({ ok: true }));

  app.post('/api/login', async (req, reply) => {
    const { login, pin } = req.body || {};
    const { rows } = await pool.query('select * from users where lower(login) = lower($1) and active', [
      String(login || '').trim(),
    ]);
    const user = rows[0];
    if (!user || !checkPin(pin, user.pin_hash)) return reply.code(401).send({ error: 'Неверный логин или PIN' });
    const token = newToken();
    await pool.query('insert into sessions (token, user_id) values ($1, $2)', [token, user.id]);
    return { token, user: publicUser(user) };
  });

  app.register(async (api) => {
    api.addHook('preHandler', auth);

    api.get('/api/me', async (req) => ({ user: publicUser(req.user) }));

    // Синхронизация: принимаем операции с устройства и отдаём всё новое с сервера.
    api.post('/api/sync', async (req) => {
      const { ops = [], since = 0 } = req.body || {};
      const results = [];
      for (const op of Array.isArray(ops) ? ops : []) {
        const err = validateOp(op);
        if (err) {
          results.push({ id: op?.id, status: 'rejected', error: err });
          continue;
        }
        if (!canWrite(req.user.role, op.kind)) {
          results.push({ id: op.id, status: 'rejected', error: 'Недостаточно прав для этой операции' });
          continue;
        }
        if (op.kind === 'move' && req.user.role === 'mechanic' && !MECHANIC_MOVES.includes(op.payload.type)) {
          results.push({ id: op.id, status: 'rejected', error: 'Механик может только перемещать, ставить и снимать' });
          continue;
        }
        const createdAt = Number.isNaN(Date.parse(op.createdAt)) ? new Date() : new Date(op.createdAt);
        await pool.query(
          `insert into ops (id, kind, payload, user_id, created_at) values ($1, $2, $3, $4, $5)
           on conflict (id) do nothing`,
          [op.id, op.kind, op.payload, req.user.id, createdAt],
        );
        results.push({ id: op.id, status: 'ok' });
      }
      const { rows } = await pool.query(
        `select o.*, u.name as user_name from ops o join users u on u.id = o.user_id
         where o.seq > $1 order by o.seq limit $2`,
        [Number(since) || 0, PAGE],
      );
      const newOps = rows.map(rowToOp);
      return {
        results,
        ops: newOps,
        cursor: newOps.length ? newOps[newOps.length - 1].seq : Number(since) || 0,
        hasMore: newOps.length === PAGE,
      };
    });

    // Выдача новых кодов для этикеток (нужна связь с сервером, обычно на складе).
    api.post('/api/labels', async (req, reply) => {
      if (req.user.role === 'mechanic') return reply.code(403).send({ error: 'Недостаточно прав' });
      const { prefix, count = 1 } = req.body || {};
      if (!Object.values(CODE_PREFIX).includes(prefix)) return reply.code(400).send({ error: 'Неизвестный префикс' });
      const n = Math.min(Math.max(parseInt(count, 10) || 1, 1), 500);
      const { rows } = await pool.query(
        `insert into label_counters (prefix, next) values ($1, $2::int + 1)
         on conflict (prefix) do update set next = label_counters.next + $2::int
         returning next - $2::int as first`,
        [prefix, n],
      );
      const first = rows[0].first;
      return { codes: Array.from({ length: n }, (_, i) => formatCode(prefix, first + i)) };
    });

    // Загрузка фото запчасти. Приложение заранее уменьшает снимок, сюда приходит base64.
    api.post('/api/photos', async (req, reply) => {
      if (!photoDir) return reply.code(500).send({ error: 'Хранилище фото не настроено' });
      if (req.user.role === 'mechanic') return reply.code(403).send({ error: 'Недостаточно прав' });
      const data = String(req.body?.data || '').replace(/^data:[^,]*,/, '');
      const buf = Buffer.from(data, 'base64');
      if (!buf.length || buf.length > MAX_PHOTO) return reply.code(400).send({ error: 'Фото слишком большое или пустое' });
      if (!photoType(buf)) return reply.code(400).send({ error: 'Это не картинка (нужен JPEG, PNG или WebP)' });
      const id = randomUUID();
      await writeFile(path.join(photoDir, id), buf);
      return { id };
    });

    api.get('/api/users', async (req) => {
      const { rows } = await pool.query('select * from users order by name');
      // Список имён нужен всем (кому передаю деталь), роли и логины видит только руководитель.
      return {
        users: rows.map((u) => (isAdmin(req.user.role) ? publicUser(u) : { id: u.id, name: u.name, active: u.active })),
      };
    });

    api.post('/api/users', { preHandler: adminOnly }, async (req, reply) => {
      const { id, login, name, role, pin, active } = req.body || {};
      if (!ROLES.includes(role)) return reply.code(400).send({ error: 'Неизвестная роль' });
      // Назначать администраторов и менять их учётные записи может только администратор.
      if (req.user.role !== 'owner') {
        if (role === 'owner') return reply.code(403).send({ error: 'Назначить администратора может только администратор' });
        if (id) {
          const { rows } = await pool.query('select role from users where id = $1', [id]);
          if (rows[0]?.role === 'owner') return reply.code(403).send({ error: 'Изменить администратора может только администратор' });
        }
      }
      if (id && Number(id) === req.user.id && (role !== req.user.role || active === false))
        return reply.code(400).send({ error: 'Нельзя снять роль или закрыть доступ самому себе' });
      if (!login || !name) return reply.code(400).send({ error: 'Нужны логин и имя' });
      if (pin != null && pin !== '' && !/^\d{4,8}$/.test(String(pin)))
        return reply.code(400).send({ error: 'PIN: от 4 до 8 цифр' });
      try {
        if (id) {
          const { rows } = await pool.query(
            `update users set login = $2, name = $3, role = $4, active = $5,
               pin_hash = coalesce($6, pin_hash) where id = $1 returning *`,
            [id, login, name, role, active !== false, pin ? hashPin(pin) : null],
          );
          if (!rows[0]) return reply.code(404).send({ error: 'Нет такого сотрудника' });
          if (active === false) await pool.query('delete from sessions where user_id = $1', [id]);
          return { user: publicUser(rows[0]) };
        }
        if (!pin) return reply.code(400).send({ error: 'Для нового сотрудника нужен PIN' });
        const { rows } = await pool.query(
          'insert into users (login, name, role, pin_hash) values ($1, $2, $3, $4) returning *',
          [login, name, role, hashPin(pin)],
        );
        return { user: publicUser(rows[0]) };
      } catch (e) {
        if (e.code === '23505') return reply.code(409).send({ error: 'Такой логин уже есть' });
        throw e;
      }
    });

    api.post('/api/logout', async (req) => {
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      await pool.query('delete from sessions where token = $1', [token]);
      return { ok: true };
    });
  });

  if (staticDir && existsSync(staticDir)) {
    app.register(fastifyStatic, { root: staticDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Не найдено' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
