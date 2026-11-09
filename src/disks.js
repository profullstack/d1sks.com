import { config } from './config.js';
import { jsonb, sql } from './db.js';
import { safeFetch } from './fetch.js';
import {
  c0mputeOf,
  descriptorUrl,
  diskId,
  toOpenServerOffer,
  validate,
  wantsHosting,
} from './opendisk.js';

export const SORTS = ['price', 'free', 'standing', 'updated', 'name', 'heartbeat'];

const num = (v) => (v === null || v === undefined ? null : Number(v));

function row(r) {
  if (!r) return null;
  const c0 = c0mputeOf(jsonb(r.data, {}));
  return {
    id: r.id,
    origin: r.origin,
    url: r.url,
    name: r.name,
    key: r.key,
    operator: r.operator,
    web: r.web,
    free_gib: num(r.free_gib),
    total_gib: num(r.total_gib),
    per_gib_month: num(r.per_gib_month),
    currency: r.currency,
    countries: jsonb(r.countries, []),
    regions: jsonb(r.regions, []),
    visibility: jsonb(r.visibility, []),
    bases: jsonb(r.bases, []),
    encrypted_only: r.encrypted_only,
    hubs: jsonb(r.hubs, []),
    proof_hours: r.proof_hours,
    standing: r.standing,
    warnings: jsonb(r.warnings, []),
    descriptor_updated_at: r.descriptor_updated_at,
    fetched_at: r.fetched_at,
    first_seen_at: r.first_seen_at,
    status: r.status,
    gone_since: r.gone_since,
    last_error: r.last_error,
    data: jsonb(r.data, {}),
    // A c0mpute node that holds static sites: a host for `c0mpute hosting publish --disks`.
    c0mpute_hosting: c0?.hosting === true,
    c0mpute_peer_id: c0?.peer_id ?? null,
    hosting_per_gib_month: c0?.hosting ? (c0.hosting_price ?? num(r.per_gib_month)) : null,
    // How the row stays fresh: 'origin' (fetched hourly) or 'signed' (the disk
    // pushes a signed heartbeat and the row expires when it goes quiet).
    source: r.source ?? 'origin',
    peer_id: r.peer_id ?? c0?.peer_id ?? null,
    // https (a public origin), direct (a public multiaddr) or c0mpute (behind
    // NAT, reached through the c0mpute network; no direct URL).
    reachable: r.reachable ?? (r.source === 'signed' ? null : 'https'),
    addrs: jsonb(r.addrs, []),
    heartbeat_at: r.heartbeat_at ?? null,
    heartbeat_age_s: r.heartbeat_at
      ? Math.max(0, Math.round((Date.now() - new Date(r.heartbeat_at).getTime()) / 1000))
      : null,
    expires_at: r.expires_at ?? null,
  };
}

/*
 * jsonb binding: with a `::jsonb` cast Bun's driver JSON-encodes the JS value
 * itself, so arrays and objects are passed raw. A pre-stringified value would
 * land as a JSON string scalar and break jsonb_array_elements_text.
 */

/** Fetch a descriptor by origin, validate it, and list it. Throws with a reason a person can read. */
export async function submit(input, { ip = null } = {}) {
  const url = descriptorUrl(input);
  const origin = new URL(url).origin;
  let outcome;
  try {
    outcome = await fetchAndStore(url, origin);
  } catch (err) {
    const detail = String(err?.message ?? err).slice(0, 500);
    await sql`insert into submissions (url, ip, ok, detail) values (${url}, ${ip}, false, ${detail})`;
    throw err;
  }
  await sql`insert into submissions (url, ip, ok, detail) values (${url}, ${ip}, true, ${outcome.disk.id})`;
  return outcome;
}

export async function recentSubmissions(ip, minutes = 60) {
  const [r] = await sql`
    select count(*)::int as n from submissions
    where ip = ${ip} and created_at > now() - make_interval(mins => ${minutes})`;
  return r?.n ?? 0;
}

/** Fetch, validate and upsert. Returns { disk, warnings, notModified }. */
export async function fetchAndStore(url, origin, { etag = null } = {}) {
  const res = await safeFetch(url, etag ? { headers: { 'if-none-match': etag } } : {});
  if (res.status === 304) return { notModified: true };
  if (res.status !== 200) throw new Error(`${url} answered ${res.status}.`);
  let doc;
  try {
    doc = JSON.parse(res.text);
  } catch {
    throw new Error(`${url} is not JSON.`);
  }
  const v = validate(doc);
  if (!v.ok) throw new Error(v.errors.join(' '));
  const id = diskId(v.disk, origin);
  const stored = await upsert({
    id,
    origin,
    url,
    doc,
    disk: v.disk,
    warnings: v.warnings,
    etag: res.headers.get('etag'),
  });
  return { disk: stored, warnings: v.warnings, notModified: false };
}

async function upsert({ id, origin, url, doc, disk: d, warnings, etag }) {
  const standing = d.record.standing === null ? null : Math.round(d.record.standing);
  const [r] = await sql`
    insert into disks (id, origin, url, name, key, operator, web, free_gib, total_gib, per_gib_month,
      currency, countries, regions, visibility, bases, encrypted_only, hubs, proof_hours, standing,
      data, warnings, etag, descriptor_updated_at, fetched_at, status, gone_since, failures, last_error)
    values (${id}, ${origin}, ${url}, ${d.name}, ${d.key}, ${d.operator},
      ${d.web}, ${d.capacity.free_gib}, ${d.capacity.total_gib}, ${d.price.per_gib_month}, ${d.price.currency},
      ${d.location.countries}::jsonb, ${d.location.regions}::jsonb,
      ${d.accepts.visibility}::jsonb, ${d.accepts.bases}::jsonb,
      ${d.accepts.encrypted_only}, ${d.hubs}::jsonb, ${d.proof.every_hours_min}, ${standing},
      ${doc}::jsonb, ${warnings}::jsonb, ${etag}, ${d.updated},
      now(), 'active', null, 0, null)
    on conflict (id) do update set
      origin = excluded.origin, url = excluded.url, name = excluded.name, key = excluded.key,
      operator = excluded.operator, web = excluded.web, free_gib = excluded.free_gib,
      total_gib = excluded.total_gib, per_gib_month = excluded.per_gib_month, currency = excluded.currency,
      countries = excluded.countries, regions = excluded.regions, visibility = excluded.visibility,
      bases = excluded.bases, encrypted_only = excluded.encrypted_only, hubs = excluded.hubs,
      proof_hours = excluded.proof_hours, standing = excluded.standing, data = excluded.data,
      warnings = excluded.warnings, etag = excluded.etag,
      descriptor_updated_at = excluded.descriptor_updated_at, fetched_at = now(),
      status = 'active', gone_since = null, failures = 0, last_error = null
    returning *`;
  return row(r);
}

export async function touch(id) {
  await sql`update disks set fetched_at = now(), failures = 0, last_error = null,
    status = 'active', gone_since = null where id = ${id}`;
}

/**
 * A failed fetch. Three in a row start the clock; a day on the clock marks
 * the disk gone. Gone is a status, never a delete: the row and its record stay.
 */
export async function failed(id, message) {
  const detail = String(message).slice(0, 500);
  const [r] = await sql`
    update disks set failures = failures + 1, last_error = ${detail}, fetched_at = now(),
      gone_since = case when failures + 1 >= 3 and gone_since is null then now() else gone_since end
    where id = ${id} returning failures, gone_since`;
  if (!r?.gone_since) return;
  const hours = (Date.now() - new Date(r.gone_since).getTime()) / 3_600_000;
  if (hours >= config.poll.goneAfterHours)
    await sql`update disks set status = 'gone' where id = ${id}`;
}

export async function due(limit = config.poll.batch) {
  return sql`
    select id, url, origin, etag from disks
    where source = 'origin' and fetched_at < now() - make_interval(mins => ${config.poll.staleMinutes})
    order by fetched_at asc limit ${limit}`;
}

export async function get(id) {
  const [r] = await sql`select * from disks where id = ${id}`;
  return row(r);
}

function whereClause(p) {
  const parts = [];
  const status = p.status === 'all' ? null : p.status === 'gone' ? 'gone' : 'active';
  if (status === 'active')
    parts.push(sql`status = 'active' and (expires_at is null or expires_at > now())`);
  else if (status) parts.push(sql`status = ${status}`);
  if (p.source === 'signed' || p.source === 'origin') parts.push(sql`source = ${p.source}`);
  if (p.reachable === 'public')
    parts.push(sql`coalesce(reachable, 'https') in ('https', 'direct')`);
  else if (['https', 'direct', 'c0mpute'].includes(p.reachable))
    parts.push(sql`coalesce(reachable, 'https') = ${p.reachable}`);
  if (p.fresh !== undefined && p.fresh !== '' && Number.isFinite(Number(p.fresh)))
    parts.push(
      sql`(source = 'origin' or heartbeat_at > now() - make_interval(mins => ${Math.max(1, Number(p.fresh))}))`,
    );
  if (p.country) {
    const codes = String(p.country)
      .toUpperCase()
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^[A-Z]{2}$/.test(s));
    if (codes.length) {
      const any = codes
        .map((c) => sql`countries @> ${[c]}::jsonb`)
        .reduce((acc, w) => sql`${acc} or ${w}`);
      parts.push(sql`(${any})`);
    }
  }
  if (p.min_gib !== undefined && p.min_gib !== '' && Number.isFinite(Number(p.min_gib)))
    parts.push(sql`free_gib >= ${Number(p.min_gib)}`);
  if (p.max_price !== undefined && p.max_price !== '' && Number.isFinite(Number(p.max_price)))
    parts.push(sql`per_gib_month <= ${Number(p.max_price)}`);
  if (p.encrypted === '1' || p.encrypted === 'true') parts.push(sql`encrypted_only = true`);
  if (p.encrypted === '0' || p.encrypted === 'false')
    parts.push(sql`coalesce(encrypted_only, false) = false`);
  if (p.visibility) parts.push(sql`visibility @> ${[String(p.visibility)]}::jsonb`);
  if (p.base) parts.push(sql`bases @> ${[String(p.base)]}::jsonb`);
  if (
    p.min_standing !== undefined &&
    p.min_standing !== '' &&
    Number.isFinite(Number(p.min_standing))
  )
    parts.push(sql`standing >= ${Number(p.min_standing)}`);
  if (wantsHosting(p.hosting)) {
    // Same rule as c0mputeOf(): a c0mpute peer id, and accepts.hosting or the hosting role.
    parts.push(sql`(data->'c0mpute'->>'peer_id' is not null and (
      data->'accepts'->'hosting' = 'true'::jsonb or data->'c0mpute'->'roles' @> ${['hosting']}::jsonb))`);
  }
  if (p.q) {
    const like = `%${String(p.q).replace(/[%_\\]/g, '\\$&')}%`;
    parts.push(sql`(name ilike ${like} or origin ilike ${like})`);
  }
  if (!parts.length) return sql``;
  return parts.reduce((acc, w, i) => (i === 0 ? sql`where ${w}` : sql`${acc} and ${w}`), sql``);
}

function orderClause(sort, dir) {
  const desc = dir === 'desc';
  switch (sort) {
    case 'free':
      return desc ? sql`free_gib desc` : sql`free_gib asc`;
    case 'standing':
      return desc ? sql`standing desc nulls last` : sql`standing asc nulls last`;
    case 'updated':
      return desc
        ? sql`coalesce(descriptor_updated_at, fetched_at) desc`
        : sql`coalesce(descriptor_updated_at, fetched_at) asc`;
    case 'name':
      return desc ? sql`name desc` : sql`name asc`;
    case 'heartbeat':
      return desc ? sql`heartbeat_at desc nulls last` : sql`heartbeat_at asc nulls last`;
    default:
      return desc ? sql`per_gib_month desc` : sql`per_gib_month asc`;
  }
}

/** The one query the page, the API and the OpenObject pool share. */
export async function list(p = {}) {
  const limit = Math.min(Math.max(Number(p.limit) || 50, 1), 200);
  const offset = Math.max(Number(p.offset) || 0, 0);
  const sort = SORTS.includes(p.sort) ? p.sort : 'price';
  const defaultDesc =
    sort === 'free' || sort === 'standing' || sort === 'updated' || sort === 'heartbeat';
  const dir = p.order === 'desc' || (p.order === undefined && defaultDesc) ? 'desc' : 'asc';
  const where = whereClause(p);
  const rows =
    await sql`select * from disks ${where} order by ${orderClause(sort, dir)}, name asc limit ${limit} offset ${offset}`;
  const [{ n }] = await sql`select count(*)::int as n from disks ${where}`;
  const countries = await sql`
    select c as country, count(*)::int as n
    from disks, jsonb_array_elements_text(countries) as c ${where}
    group by c order by n desc, c asc limit 40`;
  return {
    disks: rows.map(row),
    total: n,
    limit,
    offset,
    sort,
    order: dir,
    facets: { countries: countries.map((r) => ({ country: r.country, n: r.n })) },
  };
}

export async function stats() {
  const [r] = await sql`
    select count(*) filter (where status = 'active')::int as active,
           count(*) filter (where status = 'active' and source = 'signed')::int as signed,
           count(*) filter (where status = 'active' and reachable = 'c0mpute')::int as behind_nat,
           count(*) filter (where status = 'gone')::int as gone,
           coalesce(sum(free_gib) filter (where status = 'active'), 0)::float as free_gib,
           count(distinct operator) filter (where status = 'active' and operator is not null)::int as operators,
           min(per_gib_month) filter (where status = 'active')::float as cheapest,
           max(fetched_at) as fetched_at
    from disks`;
  const [c] = await sql`
    select count(distinct c)::int as n from disks, jsonb_array_elements_text(countries) as c
    where status = 'active'`;
  return { ...r, countries: c?.n ?? 0 };
}

/** Every active descriptor, as the OpenObject store's `disks` pool. */
export async function pool() {
  const rows = await sql`select * from disks where status = 'active'
    and (expires_at is null or expires_at > now()) order by per_gib_month asc, name asc`;
  return rows.map(row);
}

export function offerOf(d) {
  const v = validate(d.data);
  if (!v.ok) return null;
  return toOpenServerOffer(
    { ...v.disk, data: d.data },
    { url: d.url, origin: d.origin, updated: d.descriptor_updated_at ?? d.fetched_at },
  );
}

/* ---------- signed listings ---------- */

class Limited extends Error {
  constructor(message, status = 429) {
    super(message);
    this.status = status;
  }
}

export async function logAnnounce(ip, key, ok, detail) {
  await sql`insert into announces (ip, key, ok, detail)
    values (${ip}, ${key}, ${ok}, ${String(detail ?? '').slice(0, 300)})`;
}

/**
 * Store a verified signed listing (see announce.js). Rate limits: one
 * accepted heartbeat per key per `announce.minSecs`, `perIpPerHour` per
 * address, `newKeysPerIpPerDay` distinct new keys per address. A `ts` not
 * newer than the last one stored is a replay. Throws `Limited` with a status.
 */
export async function announce(l, { ip = null } = {}) {
  const id = diskId(l.disk, l.origin ?? 'https://c0mpute.invalid');
  const [prev] = await sql`select announce_ts, heartbeat_at, source from disks where id = ${id}`;
  if (
    prev?.announce_ts !== null &&
    prev?.announce_ts !== undefined &&
    Number(prev.announce_ts) >= l.ts
  )
    throw new Limited('Replayed or out-of-order listing (`ts` is not newer).', 409);
  if (
    prev?.heartbeat_at &&
    Date.now() - new Date(prev.heartbeat_at).getTime() < config.announce.minSecs * 1000
  )
    throw new Limited(`One heartbeat per ${config.announce.minSecs} s per key.`);
  if (ip) {
    const [h] = await sql`select count(*)::int as n from announces
      where ip = ${ip} and created_at > now() - interval '1 hour'`;
    if ((h?.n ?? 0) >= config.announce.perIpPerHour)
      throw new Limited('Too many listings from this address; try again later.');
    if (!prev) {
      const [k] = await sql`select count(distinct key)::int as n from announces
        where ip = ${ip} and ok and created_at > now() - interval '1 day'`;
      if ((k?.n ?? 0) >= config.announce.newKeysPerIpPerDay)
        throw new Limited('Too many new disks from this address today.');
    }
  }

  const d = l.disk;
  const origin = l.origin ?? `c0mpute://${l.peerId}`;
  const url = l.origin ? `${l.origin}/.well-known/opendisk.json` : `c0mpute://${l.peerId}`;
  const standing = d.record.standing === null ? null : Math.round(d.record.standing);
  const [r] = await sql`
    insert into disks (id, origin, url, name, key, operator, web, free_gib, total_gib, per_gib_month,
      currency, countries, regions, visibility, bases, encrypted_only, hubs, proof_hours, standing,
      data, warnings, etag, descriptor_updated_at, fetched_at, status, gone_since, failures, last_error,
      source, peer_id, heartbeat_at, expires_at, announce_ts, reachable, addrs)
    values (${id}, ${origin}, ${url}, ${d.name}, ${d.key}, ${d.operator},
      ${d.web}, ${d.capacity.free_gib}, ${d.capacity.total_gib}, ${d.price.per_gib_month}, ${d.price.currency},
      ${d.location.countries}::jsonb, ${d.location.regions}::jsonb,
      ${d.accepts.visibility}::jsonb, ${d.accepts.bases}::jsonb,
      ${d.accepts.encrypted_only}, ${d.hubs}::jsonb, ${d.proof.every_hours_min}, ${standing},
      ${l.doc}::jsonb, ${l.warnings}::jsonb, null, ${d.updated},
      now(), 'active', null, 0, null,
      'signed', ${l.peerId}, now(), now() + make_interval(secs => ${l.expiresIn}), ${l.ts},
      ${l.reachable}, ${l.addrs}::jsonb)
    on conflict (id) do update set
      origin = excluded.origin, url = excluded.url, name = excluded.name, key = excluded.key,
      operator = excluded.operator, web = excluded.web, free_gib = excluded.free_gib,
      total_gib = excluded.total_gib, per_gib_month = excluded.per_gib_month, currency = excluded.currency,
      countries = excluded.countries, regions = excluded.regions, visibility = excluded.visibility,
      bases = excluded.bases, encrypted_only = excluded.encrypted_only, hubs = excluded.hubs,
      proof_hours = excluded.proof_hours, standing = excluded.standing, data = excluded.data,
      warnings = excluded.warnings, etag = null,
      descriptor_updated_at = excluded.descriptor_updated_at, fetched_at = now(),
      status = 'active', gone_since = null, failures = 0, last_error = null,
      source = 'signed', peer_id = excluded.peer_id, heartbeat_at = now(),
      expires_at = excluded.expires_at, announce_ts = excluded.announce_ts,
      reachable = excluded.reachable, addrs = excluded.addrs
    returning *`;
  return row(r);
}

/** Signed listings whose heartbeat stopped: gone (never deleted). Old announce log rows go. */
export async function expireSigned() {
  const gone = await sql`
    update disks set status = 'gone', gone_since = coalesce(gone_since, expires_at)
    where source = 'signed' and status = 'active' and expires_at < now()
    returning id`;
  await sql`delete from announces where created_at < now() - interval '2 days'`;
  return gone.length;
}
