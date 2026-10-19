create table if not exists users (
  id serial primary key,
  login text not null unique,
  name text not null,
  role text not null,
  pin_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Роли: owner (главный), admin (руководитель), storekeeper (кладовщик), mechanic (механик)
alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check check (role in ('owner', 'admin', 'storekeeper', 'mechanic'));

-- Если главного ещё нет, им становится самый первый руководитель.
update users set role = 'owner'
where id = (select id from users where role = 'admin' order by id limit 1)
  and not exists (select 1 from users where role = 'owner');

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
