import { beforeAll, describe, expect, it } from 'bun:test';
import { app } from '../src/app.jsx';
import { migrate, sql } from '../src/db.js';
import { expireSigned } from '../src/disks.js';
import { makeListing } from './sign.js';

/**
 * Signed listings end to end against the test database: a NAT'd node pushes
 * a listing, it is listed as reachable via c0mpute, replays and floods are
 * refused, and it expires when the heartbeats stop. Skipped without Postgres.
 */
const req = (path, init) => app.request(`http://d1sks.test${path}`, init);
const post = (body, ip = '198.51.100.7') =>
  req('/api/v1/disks/announce', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });

let dbOk = true;
beforeAll(async () => {
  try {
    await migrate({ log: () => {} });
    await sql`delete from disks where source = 'signed'`;
    await sql`delete from announces`;
  } catch {
    dbOk = false;
  }
});

describe('signed listings over the API', () => {
  it('lists a NAT disk from its signed heartbeat, with no origin fetch', async () => {
    if (!dbOk) return;
    const l = makeListing();
    const r = await post(l.body);
    expect(r.status).toBe(200);
    const a = await r.json();
    expect(a.reachable).toBe('c0mpute');
    expect(a.id).toBe(l.key.replace(':', '-'));

    const list = await (await req('/api/v1/disks?hosting=1&reachable=c0mpute')).json();
    const row = list.disks.find((d) => d.id === a.id);
    expect(row.source).toBe('signed');
    expect(row.peer_id).toBe(l.peer);
    expect(row.c0mpute_hosting).toBe(true);
    expect(row.heartbeat_age_s).toBeLessThan(30);
    expect(row.addrs).toEqual(['/ip4/192.168.1.9/tcp/4001']);
    const pub = await (await req('/api/v1/disks?reachable=public')).json();
    expect(pub.disks.some((d) => d.id === a.id)).toBe(false);

    const html = await (await req(`/disks/${encodeURIComponent(a.id)}`)).text();
    expect(html).toContain('reachable via c0mpute');
    const page = await (await req('/disks?hosting=1')).text();
    expect(page).toContain('reachable via c0mpute');
  });

  it('refuses replays, floods of one key, and bad signatures', async () => {
    if (!dbOk) return;
    const keys = makeListing().keys;
    const first = makeListing({}, { keys, now: Date.now() - 5_000 });
    expect((await post(first.body)).status).toBe(200);
    expect((await post(first.body)).status).toBe(409);
    const soon = makeListing({}, { keys });
    const r = await post(soon.body);
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('60');
    // Once a minute has passed, the next heartbeat is taken.
    await sql`update disks set heartbeat_at = now() - interval '2 minutes' where peer_id = ${first.peer}`;
    expect((await post(soon.body)).status).toBe(200);

    const bad = { ...soon.body, signature: '00'.repeat(64) };
    expect((await post(bad)).status).toBe(401);
    expect((await post({ nope: true })).status).toBe(400);
  });

  it('caps new keys per address per day', async () => {
    if (!dbOk) return;
    const ip = '203.0.113.50';
    await sql`insert into announces (ip, key, ok, detail)
      select ${ip}, 'ed25519:' || lpad(g::text, 64, '0'), true, 'seed' from generate_series(1, 50) g`;
    expect((await post(makeListing().body, ip)).status).toBe(429);
  });

  it('expires a disk that stops heartbeating, and brings it back on the next one', async () => {
    if (!dbOk) return;
    const keys = makeListing().keys;
    const l = makeListing({}, { keys, now: Date.now() - 10_000 });
    const { id } = await (await post(l.body)).json();
    await sql`update disks set expires_at = now() - interval '1 second', heartbeat_at = now() - interval '30 minutes' where id = ${id}`;
    let list = await (await req('/api/v1/disks?source=signed')).json();
    expect(list.disks.some((d) => d.id === id)).toBe(false);
    expect(await expireSigned()).toBeGreaterThanOrEqual(1);
    let [row] = await sql`select status from disks where id = ${id}`;
    expect(row.status).toBe('gone');

    expect((await post(makeListing({}, { keys }).body)).status).toBe(200);
    [row] = await sql`select status, expires_at > now() as live from disks where id = ${id}`;
    expect(row.status).toBe('active');
    expect(row.live).toBe(true);
    list = await (await req('/api/v1/disks?source=signed&fresh=10')).json();
    expect(list.disks.some((d) => d.id === id)).toBe(true);
  });
});
