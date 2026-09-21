import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { config } from './config.js';
import * as disks from './disks.js';
import { safeFetch } from './fetch.js';
import { descriptorUrl, generate, validate } from './opendisk.js';
import { openobjectDescriptor, openserverDescriptor, POLICIES, STORE_PRICE } from './store.js';
import { Disk, Disks } from './views/disks.jsx';
import { Docs } from './views/docs.jsx';
import { ErrorPage, Home, Serve, Store, Submit, Validate } from './views/pages.jsx';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const render = async (node) => `<!doctype html>${await node.toString()}`;
const params = (c) => Object.fromEntries(new URL(c.req.url).searchParams);
const wantsJson = (c) =>
  (c.req.header('accept') ?? '').includes('application/json') || c.req.path.startsWith('/api/');
const ipOf = (c) =>
  (c.req.header('x-forwarded-for') ?? '').split(',')[0].trim() || c.req.header('x-real-ip') || null;

class Denied extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const app = new Hono();

app.use('*', async (c, next) => {
  c.header('x-content-type-options', 'nosniff');
  c.header('referrer-policy', 'strict-origin-when-cross-origin');
  if (!c.req.path.startsWith('/api/') && !c.req.path.startsWith('/openobject/'))
    c.header(
      'content-security-policy',
      "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'none'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
  await next();
});

app.onError(async (err, c) => {
  const status = err instanceof Denied ? err.status : Number(err?.status) || 500;
  if (status >= 500) console.error('[web]', err);
  const message = status >= 500 ? 'Something broke on our side. It is logged.' : err.message;
  if (wantsJson(c)) return c.json({ error: message }, status);
  return c.html(await render(<ErrorPage status={status} message={message} />), status);
});
app.notFound(async (c) => {
  if (wantsJson(c)) return c.json({ error: 'Not found' }, 404);
  return c.html(
    await render(<ErrorPage status={404} message="Nothing lives at that address." />),
    404,
  );
});

/* ---------- static ---------- */
const STATIC = {
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/logo.svg': ['logo.svg', 'image/svg+xml'],
  '/favicon.svg': ['logo.svg', 'image/svg+xml'],
  '/favicon.ico': ['logo.svg', 'image/svg+xml'],
};
for (const [path, [file, type]] of Object.entries(STATIC))
  app.get(path, async (c) => {
    const body = await readFile(join(PUBLIC, file));
    c.header('content-type', type);
    c.header('cache-control', 'public, max-age=3600');
    return c.body(body);
  });

app.get('/healthz', async (c) => {
  const s = await disks.stats();
  return c.json({ ok: true, disks: s.active, gone: s.gone, at: new Date().toISOString() });
});

app.get('/robots.txt', (c) =>
  c.text(`User-agent: *\nAllow: /\nSitemap: ${config.siteUrl}/sitemap.xml\n`),
);
app.get('/sitemap.xml', async (c) => {
  const r = await disks.list({ limit: 200, sort: 'updated' });
  const urls = ['/', '/disks', '/store', '/submit', '/serve', '/validate', '/docs'].map(
    (p) => `${config.siteUrl}${p}`,
  );
  for (const d of r.disks) urls.push(`${config.siteUrl}/disks/${encodeURIComponent(d.id)}`);
  c.header('content-type', 'application/xml; charset=utf-8');
  return c.body(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `  <url><loc>${u}</loc></url>`)
      .join('\n')}\n</urlset>\n`,
  );
});

app.get('/llms.txt', async (c) => {
  const s = await disks.stats();
  c.header('content-type', 'text/plain; charset=utf-8');
  return c.body(llmsTxt(s));
});

/* ---------- well-known ---------- */
app.get('/.well-known/openobject.json', async (c) => {
  const [s, pool] = await Promise.all([disks.stats(), disks.pool()]);
  c.header('cache-control', 'public, max-age=300');
  return c.json(openobjectDescriptor({ stats: s, pool }));
});
app.get('/.well-known/openserver.json', async (c) => {
  const s = await disks.stats();
  c.header('cache-control', 'public, max-age=300');
  return c.json(openserverDescriptor({ stats: s }));
});
/** The OpenObject store's `disks` pool: every active descriptor, as fetched. */
app.get('/api/disks', async (c) => {
  const pool = await disks.pool();
  c.header('cache-control', 'public, max-age=300');
  return c.json({
    updated: new Date().toISOString(),
    count: pool.length,
    disks: pool.map((d) => ({
      ...d.data,
      _d1sks: { id: d.id, url: d.url, fetched_at: d.fetched_at },
    })),
  });
});

/* ---------- OpenObject store API: the index is open, buckets are not ---------- */
app.get('/openobject/v1', (c) =>
  c.json({
    openobject: '0.1',
    store: config.siteName,
    api: `${config.siteUrl}/openobject/v1`,
    descriptor: `${config.siteUrl}/.well-known/openobject.json`,
    policies: POLICIES,
    price: STORE_PRICE,
    buckets: {
      open: false,
      why: 'Buckets open when the first OpenDisk disks take pay2seed leases through this store. Until then this store indexes disks and places nothing.',
      spec: 'https://logicsrc.com/docs/openobject',
    },
  }),
);
app.all('/openobject/v1/*', (c) =>
  c.json(
    {
      error: 'Buckets are not open at this store yet.',
      spec: 'https://logicsrc.com/docs/openobject',
      status: `${config.siteUrl}/openobject/v1`,
    },
    501,
  ),
);

/* ---------- JSON API ---------- */
app.use('/api/v1/*', async (c, next) => {
  c.header('access-control-allow-origin', '*');
  c.header('access-control-allow-headers', 'content-type');
  c.header('access-control-allow-methods', 'GET, POST, OPTIONS');
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
});
app.get('/api/v1', (c) =>
  c.json({
    name: config.siteName,
    version: 1,
    description: 'The OpenDisk marketplace: every disk that serves /.well-known/opendisk.json.',
    documentation: `${config.siteUrl}/docs`,
    llms: `${config.siteUrl}/llms.txt`,
    endpoints: [
      'GET /api/v1/disks?country=&min_gib=&max_price=&encrypted=&visibility=&base=&min_standing=&q=&sort=price|free|standing|updated|name&order=&limit=&offset=&status=active|gone|all',
      'GET /api/v1/disks/:id',
      'GET /api/v1/disks/:id/openserver.json',
      'POST /api/v1/disks {"url": "https://example.com"}',
      'GET /api/v1/validate?url=https://example.com',
      'POST /api/v1/validate <descriptor JSON>',
      'GET /api/v1/stats',
      'GET /api/disks (the OpenObject pool)',
      'GET /.well-known/openobject.json',
      'GET /.well-known/openserver.json',
    ],
    specs: {
      opendisk: 'https://logicsrc.com/docs/opendisk',
      openobject: 'https://logicsrc.com/docs/openobject',
      openserver: 'https://logicsrc.com/docs/openserver',
    },
  }),
);
app.get('/api/v1/stats', async (c) => c.json(await disks.stats()));
app.get('/api/v1/disks', async (c) => c.json(await disks.list(params(c))));
app.get('/api/v1/disks/:id', async (c) => {
  const d = await disks.get(c.req.param('id'));
  if (!d) throw new Denied('No such disk.', 404);
  return c.json({ ...d, openserver: disks.offerOf(d) });
});
app.get('/api/v1/disks/:id/openserver.json', async (c) => {
  const d = await disks.get(c.req.param('id'));
  if (!d) throw new Denied('No such disk.', 404);
  return c.json(disks.offerOf(d));
});
app.post('/api/v1/disks', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const r = await submitGuarded(c, body.url ?? body.origin);
  return c.json({ ok: true, disk: r.disk, warnings: r.warnings }, 201);
});
app.get('/api/v1/validate', async (c) => c.json(await validateRemote(params(c).url)));
app.post('/api/v1/validate', async (c) => {
  const doc = await c.req.json().catch(() => null);
  if (doc === null) throw new Denied('Send the descriptor as JSON.');
  const v = validate(doc);
  return c.json({ ok: v.ok, errors: v.errors, warnings: v.warnings, disk: v.ok ? v.disk : null });
});

async function submitGuarded(c, input) {
  const ip = ipOf(c);
  if (ip && (await disks.recentSubmissions(ip)) >= config.submit.perIpPerHour)
    throw new Denied('Too many submissions from this address; try again in an hour.', 429);
  try {
    return await disks.submit(input, { ip });
  } catch (err) {
    throw new Denied(err?.message ?? String(err), 422);
  }
}

async function validateRemote(input) {
  let url;
  try {
    url = descriptorUrl(input);
  } catch (err) {
    return { ok: false, url: null, errors: [err.message], warnings: [] };
  }
  let res;
  try {
    res = await safeFetch(url);
  } catch (err) {
    return { ok: false, url, errors: [err.message], warnings: [] };
  }
  if (res.status !== 200)
    return { ok: false, url, errors: [`${url} answered ${res.status}.`], warnings: [] };
  let doc;
  try {
    doc = JSON.parse(res.text);
  } catch {
    return { ok: false, url, errors: ['The body is not JSON.'], warnings: [] };
  }
  const v = validate(doc);
  return { ok: v.ok, url, errors: v.errors, warnings: v.warnings, disk: v.ok ? v.disk : null };
}

/* ---------- pages ---------- */
app.get('/', async (c) => {
  const [s, cheapest, biggest] = await Promise.all([
    disks.stats(),
    disks.list({ sort: 'price', limit: 6 }),
    disks.list({ sort: 'free', limit: 6 }),
  ]);
  c.header('cache-control', 'public, max-age=120');
  return c.html(await render(<Home stats={s} cheapest={cheapest.disks} biggest={biggest.disks} />));
});

app.get('/disks', async (c) => {
  const p = params(c);
  const page = Math.max(1, Number(p.page) || 1);
  const limit = Math.min(Number(p.limit) || 25, 100);
  const r = await disks.list({ ...p, limit, offset: (page - 1) * limit });
  if (wantsJson(c)) return c.json(r);
  return c.html(await render(<Disks result={r} page={page} params={p} />));
});
app.get('/disks/:id', async (c) => {
  const d = await disks.get(c.req.param('id'));
  if (!d) throw new Denied('No such disk.', 404);
  if (wantsJson(c)) return c.json({ ...d, openserver: disks.offerOf(d) });
  return c.html(await render(<Disk disk={d} offer={disks.offerOf(d)} notice={params(c).notice} />));
});
app.get('/disks/:id/openserver.json', async (c) => {
  const d = await disks.get(c.req.param('id'));
  if (!d) throw new Denied('No such disk.', 404);
  return c.json(disks.offerOf(d));
});
app.post('/disks', async (c) => {
  const form = await c.req.parseBody();
  try {
    const r = await submitGuarded(c, form.url);
    return c.redirect(`/disks/${encodeURIComponent(r.disk.id)}?notice=listed`, 303);
  } catch (err) {
    return c.html(
      await render(<Submit error={err.message} url={String(form.url ?? '')} />),
      err.status ?? 400,
    );
  }
});

app.get('/submit', async (c) => c.html(await render(<Submit url={params(c).url ?? ''} />)));
app.get('/validate', async (c) => {
  const url = params(c).url;
  const result = url ? await validateRemote(url) : null;
  return c.html(await render(<Validate url={url ?? ''} result={result} />));
});
app.get('/serve', async (c) => c.html(await render(<Serve />)));
app.post('/serve', async (c) => {
  const form = await c.req.parseBody({ all: true });
  const doc = generate(form);
  const v = validate(doc);
  return c.html(await render(<Serve fields={form} doc={doc} warnings={v.warnings} />));
});
app.get('/store', async (c) => {
  const s = await disks.stats();
  return c.html(await render(<Store stats={s} />));
});
app.get('/docs', async (c) => c.html(await render(<Docs />)));

function llmsTxt(s) {
  return `# d1sks.com

> The OpenDisk marketplace and the OpenObject reference store. Every disk that serves /.well-known/opendisk.json (free GiB, price per GiB-month, country, policy, proof cadence, hub standing) is listed here, refetched hourly, marked gone rather than deleted. The store descriptor at /.well-known/openobject.json says how buckets are kept at three replicas on three operators in two countries. ${s.active} disks listed, ${Math.round(s.free_gib).toLocaleString('en-US')} GiB free across ${s.countries} countries.

## Read
- [Disks](${config.siteUrl}/disks): the list, filterable by country, free GiB, price, policy and standing. Add \`accept: application/json\` for the same rows as data.
- [API](${config.siteUrl}/api/v1): GET /api/v1/disks with the same parameters; GET /api/v1/disks/:id; GET /api/v1/stats.
- [OpenObject pool](${config.siteUrl}/api/disks): every listed descriptor as fetched, the store's \`disks\` field.
- [Store descriptor](${config.siteUrl}/.well-known/openobject.json) and [OpenServer descriptor](${config.siteUrl}/.well-known/openserver.json).

## Write
- POST ${config.siteUrl}/api/v1/disks with {"url": "https://your-disk.example"}: fetches /.well-known/opendisk.json from that origin, validates it against OpenDisk 0.1, lists it.
- GET ${config.siteUrl}/api/v1/validate?url=… checks a descriptor without listing it; POST a descriptor body to /api/v1/validate to check one before serving it.

## Specs
- OpenDisk: https://logicsrc.com/docs/opendisk
- OpenObject: https://logicsrc.com/docs/openobject
- OpenServer: https://logicsrc.com/docs/openserver
- OpenSwarm (pay2seed, paid2seed): https://logicsrc.com/openswarm
`;
}
