import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp, ensureAdmin, migrate } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://app:app@localhost:5432/zapchasti' });

await migrate(pool);
if (await ensureAdmin(pool, { login: process.env.ADMIN_LOGIN, name: process.env.ADMIN_NAME, pin: process.env.ADMIN_PIN })) {
  console.log(`Создан администратор ${process.env.ADMIN_LOGIN}`);
}

const app = buildApp({
  pool,
  staticDir: process.env.STATIC_DIR || path.resolve(here, '../../client/dist'),
  logger: true,
});
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT) || 3000 });
