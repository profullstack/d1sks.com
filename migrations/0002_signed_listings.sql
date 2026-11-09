-- Signed listings: a disk pushes its own descriptor, signed by its ed25519
-- (libp2p) key, every few minutes. No origin fetch, so disks behind NAT list
-- too. `source` says how a row is kept fresh: 'origin' (polled) or 'signed'
-- (heartbeats; expires_at is when it goes quiet).
alter table disks add column if not exists source text not null default 'origin';
alter table disks add column if not exists peer_id text;
alter table disks add column if not exists heartbeat_at timestamptz;
alter table disks add column if not exists expires_at timestamptz;
alter table disks add column if not exists announce_ts bigint;
alter table disks add column if not exists reachable text;
alter table disks add column if not exists addrs jsonb not null default '[]'::jsonb;
create index if not exists disks_signed_expiry_idx on disks (expires_at) where source = 'signed';
create index if not exists disks_peer_idx on disks (peer_id);

create table if not exists announces (
  id          bigserial primary key,
  ip          text,
  key         text,
  ok          boolean not null,
  detail      text,
  created_at  timestamptz not null default now()
);
create index if not exists announces_ip_idx on announces (ip, created_at);
