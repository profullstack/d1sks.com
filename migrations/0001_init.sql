-- One row per disk: the descriptor as fetched (unknown keys kept) plus the
-- columns the list filters and sorts on. Arrays are jsonb, never text[].
create table if not exists disks (
  id              text primary key,
  origin          text not null,
  url             text not null,
  name            text not null,
  key             text,
  operator        text,
  web             text,
  free_gib        numeric not null default 0,
  total_gib       numeric,
  per_gib_month   numeric not null default 0,
  currency        text not null default 'USD',
  countries       jsonb not null default '[]'::jsonb,
  regions         jsonb not null default '[]'::jsonb,
  visibility      jsonb not null default '[]'::jsonb,
  bases           jsonb not null default '[]'::jsonb,
  encrypted_only  boolean,
  hubs            jsonb not null default '[]'::jsonb,
  proof_hours     integer,
  standing        integer,
  data            jsonb not null,
  warnings        jsonb not null default '[]'::jsonb,
  etag            text,
  descriptor_updated_at timestamptz,
  fetched_at      timestamptz not null default now(),
  first_seen_at   timestamptz not null default now(),
  status          text not null default 'active',
  gone_since      timestamptz,
  failures        integer not null default 0,
  last_error      text
);
create index if not exists disks_status_idx on disks (status);
create index if not exists disks_price_idx on disks (per_gib_month);
create index if not exists disks_free_idx on disks (free_gib);
create index if not exists disks_countries_idx on disks using gin (countries);
create index if not exists disks_fetched_idx on disks (fetched_at);

create table if not exists submissions (
  id          bigserial primary key,
  url         text not null,
  ip          text,
  ok          boolean not null,
  detail      text,
  created_at  timestamptz not null default now()
);
create index if not exists submissions_ip_idx on submissions (ip, created_at);
