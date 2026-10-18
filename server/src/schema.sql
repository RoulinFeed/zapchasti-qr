create table if not exists users (
  id serial primary key,
  login text not null unique,
  name text not null,
  role text not null check (role in ('admin', 'storekeeper', 'mechanic')),
  pin_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token text primary key,
  user_id int not null references users(id),
  created_at timestamptz not null default now()
);

-- Журнал операций: единственный источник правды. Строки никогда не меняются и не удаляются.
create table if not exists ops (
  seq bigserial primary key,
  id text not null unique,
  kind text not null,
  payload jsonb not null,
  user_id int not null references users(id),
  created_at timestamptz not null,
  received_at timestamptz not null default now()
);

-- Счётчики для кодов этикеток: P-000001, B-000001, V-01 и т.д.
create table if not exists label_counters (
  prefix text primary key,
  next int not null default 1
);
