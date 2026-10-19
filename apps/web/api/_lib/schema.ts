// Writalin account and sync schema (Neon Postgres). Every statement is safe to re-run.
// Notes stay as files on each computer; these tables hold accounts and a sync copy.
export const SCHEMA: string[] = [
  `create extension if not exists citext`,
  `create extension if not exists pgcrypto`,
  `create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  password_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)`,
  `-- One-time email codes. Only a hash of the code is stored.
create table if not exists login_codes (
  id uuid primary key default gen_random_uuid(),
  email citext not null,
  ip text,
  code_hash text not null,
  purpose text not null default 'login',
  attempts int not null default 0,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
)`,
  `create index if not exists login_codes_email_idx on login_codes (email, created_at desc)`,
  `create index if not exists login_codes_ip_idx on login_codes (ip, created_at desc)`,
  `-- Sessions are opaque random tokens in an httpOnly cookie; only their hash is stored.
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
)`,
  `create index if not exists sessions_user_idx on sessions (user_id)`,
  `create table if not exists sync_vaults (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
)`,
  `create index if not exists sync_vaults_user_idx on sync_vaults (user_id)`,
  `create sequence if not exists sync_version_seq`,
  `-- Latest version of each file in a synced vault. Deletions are kept as tombstones
-- so other computers learn about them.
create table if not exists sync_files (
  vault_id uuid not null references sync_vaults(id) on delete cascade,
  path text not null,
  data bytea not null default ''::bytea,
  hash text,
  size int not null default 0,
  deleted boolean not null default false,
  version bigint not null default nextval('sync_version_seq'),
  updated_at timestamptz not null default now(),
  primary key (vault_id, path)
)`,
  `create index if not exists sync_files_version_idx on sync_files (vault_id, version)`,
  `-- AI helper. Each account picks the built-in key (server env) or its own
-- Anthropic key. Own keys are encrypted with AES-256-GCM before they reach the
-- database (see api/_lib/secrets.ts); the browser only ever sees the last 4 characters.
create table if not exists ai_settings (
  user_id uuid primary key references users(id) on delete cascade,
  mode text not null default 'builtin' check (mode in ('builtin', 'own')),
  key_ciphertext text,
  key_hint text,
  updated_at timestamptz not null default now()
)`,
  `-- Requests per account per day, for the daily limits.
create table if not exists ai_usage (
  user_id uuid not null references users(id) on delete cascade,
  day date not null,
  requests int not null default 0,
  primary key (user_id, day)
)`,
];
