import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { app } from '../src/app.jsx';
import { close, migrate, sql } from '../src/db.js';
import { pollOnce } from '../src/poller.js';

/**
 * End to end against the test database: a local origin serves a descriptor,
 * the site fetches, validates, lists, filters, refetches and marks it gone.
 * Needs DATABASE_URL (CI provides one); skipped when Postgres is not there.
 */
let origin;
let server;
let doc = {
  name: 'test drive, Lisbon',
  capacity: { total_gib: 1000, free_gib: 640 },
  price: { currency: 'USD', per_gib_month: 0.07 },
  location: { countries: ['PT'] },
  accepts: { visibility: ['public'], encrypted_only: true },
};
let answer = 200;

const req = (path, init) => app.request(`http://d1sks.test${path}`, init);

let dbOk = true;
beforeAll(async () => {
  try {
    await migrate({ log: () => {} });
    await sql`delete from disks where origin like 'http://localhost:%'`;
  } catch {
    dbOk = false;
    return;
  }
  server = Bun.serve({
    port: 0,
    fetch(r) {
      if (new URL(r.url).pathname !== '/.well-known/opendisk.json')
        return new Response('no', { status: 404 });
      if (answer !== 200) return new Response('gone', { status: answer });
      return Response.json(doc, { headers: { etag: `"${doc.capacity.free_gib}"` } });
    },
  });
  origin = `http://localhost:${server.port}`;
});
afterAll(async () => {
  server?.stop(true);
  if (dbOk) await close();
});

describe('d1sks end to end', () => {
  it('lists a disk from its origin and answers as JSON and HTML', async () => {
    if (!dbOk) return;
    const r = await req('/api/v1/disks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: origin }),
    });
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.disk.name).toBe(doc.name);
    expect(body.disk.countries).toEqual(['PT']);

    const list = await (await req('/api/v1/disks?country=pt&min_gib=500&encrypted=1')).json();
    expect(list.total).toBeGreaterThanOrEqual(1);
    expect(list.disks.some((d) => d.origin === origin)).toBe(true);
    const none = await (await req('/api/v1/disks?country=DE&q=test+drive')).json();
    expect(none.disks.some((d) => d.origin === origin)).toBe(false);

    const html = await req(`/disks/${encodeURIComponent(body.disk.id)}`);
    expect(html.status).toBe(200);
    expect(await html.text()).toContain('test drive, Lisbon');

    const offer = await (
      await req(`/api/v1/disks/${encodeURIComponent(body.disk.id)}/openserver.json`)
    ).json();
    expect(offer.kind).toBe('storage');
    expect(offer.price.amount).toBe(0.07);
  });

  it('refuses a descriptor that is not valid, with the reason', async () => {
    if (!dbOk) return;
    const bad = { ...doc };
    delete bad.price;
    const keep = doc;
    doc = bad;
    const r = await req('/api/v1/disks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: origin }),
    });
    doc = keep;
    expect(r.status).toBe(422);
    expect((await r.json()).error).toMatch(/per_gib_month/);
  });

  it('serves the store, pool and OpenServer descriptors', async () => {
    if (!dbOk) return;
    const store = await (await req('/.well-known/openobject.json')).json();
    expect(store.policies.find((p) => p.default).id).toBe('3x');
    expect(store.buckets.open).toBe(false);
    const pool = await (await req('/api/disks')).json();
    expect(pool.disks.some((d) => d.name === doc.name)).toBe(true);
    const os = await (await req('/.well-known/openserver.json')).json();
    expect(os.offers.length).toBe(3);
    const api = await req('/openobject/v1/b/x', { method: 'PUT' });
    expect(api.status).toBe(501);
  });

  it('refetches on the poll and marks a silent disk gone after a day of failures', async () => {
    if (!dbOk) return;
    await sql`update disks set fetched_at = now() - interval '2 hours' where origin = ${origin}`;
    doc = { ...doc, capacity: { ...doc.capacity, free_gib: 100 } };
    let r = await pollOnce({ log: () => {} });
    expect(r.ok).toBe(1);
    let [row] = await sql`select free_gib, status from disks where origin = ${origin}`;
    expect(Number(row.free_gib)).toBe(100);

    answer = 500;
    for (let i = 0; i < 3; i++) {
      await sql`update disks set fetched_at = now() - interval '2 hours' where origin = ${origin}`;
      r = await pollOnce({ log: () => {} });
      expect(r.bad).toBe(1);
    }
    [row] = await sql`select status, failures, gone_since from disks where origin = ${origin}`;
    expect(row.failures).toBe(3);
    expect(row.status).toBe('active');
    await sql`update disks set gone_since = now() - interval '25 hours', fetched_at = now() - interval '2 hours' where origin = ${origin}`;
    await pollOnce({ log: () => {} });
    [row] = await sql`select status from disks where origin = ${origin}`;
    expect(row.status).toBe('gone');

    answer = 200;
    await sql`update disks set fetched_at = now() - interval '2 hours' where origin = ${origin}`;
    await pollOnce({ log: () => {} });
    [row] = await sql`select status from disks where origin = ${origin}`;
    expect(row.status).toBe('active');
  });
});
