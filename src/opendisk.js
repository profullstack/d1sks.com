/**
 * OpenDisk 0.1 (https://logicsrc.com/docs/opendisk): read a descriptor,
 * say what is wrong with it, normalise what is right, and map it onto an
 * OpenServer offer. Pure functions, no I/O.
 */

export const VISIBILITY = ['private', 'public', 'personal'];
export const BASES = ['own', 'licensed', 'open-license', 'public-domain', 'personal'];
export const PROOF_KINDS = ['challenge', 'probe'];
export const STORAGE_TYPES = ['nvme', 'ssd', 'hdd'];

const KEY_RE = /^ed25519:[0-9a-f]{64}$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const strList = (v) => (Array.isArray(v) ? v.filter(isStr).map((s) => s.trim()) : []);
const isUrl = (v) => {
  if (!isStr(v)) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};
const isDate = (v) => isStr(v) && !Number.isNaN(Date.parse(v));
const iso = (v) => (isDate(v) ? new Date(v).toISOString() : null);

/** The descriptor URL for whatever a person typed: a host, an origin, or the file itself. */
export function descriptorUrl(input) {
  let s = String(input ?? '').trim();
  if (!s) throw new Error('Give a domain or an origin.');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new Error('That is not a URL.');
  }
  if (u.username || u.password) throw new Error('No credentials in the URL.');
  if (u.pathname !== '/' && u.pathname !== '/.well-known/opendisk.json')
    throw new Error('A descriptor lives at /.well-known/opendisk.json on its own origin.');
  return `${u.origin}/.well-known/opendisk.json`;
}

/**
 * Validate and normalise. Returns { ok, errors, warnings, disk }. `disk` is
 * the normalised view the site stores beside the raw document; unknown keys
 * stay in the raw document, as the spec says a reader must keep them.
 */
export function validate(doc) {
  const errors = [];
  const warnings = [];
  if (!isObj(doc)) return { ok: false, errors: ['The descriptor is not a JSON object.'], warnings };

  if (!isStr(doc.name)) errors.push('`name` is required and must be a non-empty string.');
  if (!isObj(doc.capacity) || !isNum(doc.capacity.free_gib) || doc.capacity.free_gib < 0)
    errors.push('`capacity.free_gib` is required and must be a number of GiB, zero or more.');
  if (!isObj(doc.price) || !isNum(doc.price.per_gib_month) || doc.price.per_gib_month < 0)
    errors.push('`price.per_gib_month` is required and must be a number, zero or more.');
  if (errors.length) return { ok: false, errors, warnings };

  const cap = doc.capacity;
  const price = doc.price;
  for (const k of ['total_gib', 'reserved_gib'])
    if (cap[k] !== undefined && !(isNum(cap[k]) && cap[k] >= 0))
      warnings.push(`\`capacity.${k}\` is not a number and was ignored.`);
  if (isNum(cap.total_gib) && cap.free_gib > cap.total_gib)
    warnings.push('`capacity.free_gib` is larger than `capacity.total_gib`.');

  let currency = 'USD';
  if (price.currency === undefined) warnings.push('`price.currency` is missing; USD assumed.');
  else if (!/^[A-Z]{3}$/.test(String(price.currency)))
    warnings.push('`price.currency` is not an ISO 4217 code; USD assumed.');
  else currency = price.currency;
  for (const k of ['per_gib_transfer', 'min_gib', 'max_gib', 'min_days', 'max_days'])
    if (price[k] !== undefined && !(isNum(price[k]) && price[k] >= 0))
      warnings.push(`\`price.${k}\` is not a number and was ignored.`);

  if (doc.operator !== undefined && !isUrl(doc.operator))
    warnings.push('`operator` should be an OpenProfile.md URL.');
  if (doc.web !== undefined && !isUrl(doc.web)) warnings.push('`web` should be a URL.');
  if (doc.key !== undefined && !KEY_RE.test(String(doc.key)))
    warnings.push('`key` should be `ed25519:` followed by 64 hex characters.');
  if (doc.hubs !== undefined && !(Array.isArray(doc.hubs) && doc.hubs.every(isUrl)))
    warnings.push('`hubs` should be a list of URLs.');
  if (doc.updated !== undefined && !isDate(doc.updated))
    warnings.push('`updated` should be an ISO 8601 timestamp.');

  const location = isObj(doc.location) ? doc.location : {};
  const countries = strList(location.countries).map((c) => c.toUpperCase());
  if (countries.some((c) => !/^[A-Z]{2}$/.test(c)))
    warnings.push('`location.countries` should be ISO 3166-1 alpha-2 codes.');

  const accepts = isObj(doc.accepts) ? doc.accepts : {};
  const visibility = strList(accepts.visibility);
  if (visibility.some((v) => !VISIBILITY.includes(v)))
    warnings.push(`\`accepts.visibility\` values should be ${VISIBILITY.join(', ')}.`);
  const bases = strList(accepts.bases);
  if (bases.some((v) => !BASES.includes(v)))
    warnings.push(`\`accepts.bases\` values should be ${BASES.join(', ')}.`);

  const proof = isObj(doc.proof) ? doc.proof : {};
  const proofKinds = strList(proof.kinds);
  if (proofKinds.some((v) => !PROOF_KINDS.includes(v)))
    warnings.push('`proof.kinds` values should be challenge or probe.');
  if (
    proof.every_hours_min !== undefined &&
    !(isNum(proof.every_hours_min) && proof.every_hours_min > 0)
  )
    warnings.push('`proof.every_hours_min` should be a positive number of hours.');

  const record = isObj(doc.record) ? doc.record : {};
  if (record.source !== undefined && !isUrl(record.source))
    warnings.push('`record.source` should be the hub URL for this seeder.');

  const storage = Array.isArray(doc.storage)
    ? doc.storage.filter(isObj).map((d) => ({
        type: STORAGE_TYPES.includes(d.type) ? d.type : d.type ? String(d.type) : undefined,
        size_gb: isNum(d.size_gb) ? d.size_gb : undefined,
      }))
    : [];

  const network = isObj(doc.network) ? doc.network : {};

  const disk = {
    name: doc.name.trim(),
    web: isUrl(doc.web) ? doc.web : null,
    operator: isUrl(doc.operator) ? doc.operator : null,
    key: KEY_RE.test(String(doc.key ?? '')) ? doc.key : null,
    hubs: Array.isArray(doc.hubs) ? doc.hubs.filter(isUrl) : [],
    developer: isObj(doc.developer) ? doc.developer : null,
    updated: iso(doc.updated),
    capacity: {
      total_gib: isNum(cap.total_gib) ? cap.total_gib : null,
      free_gib: cap.free_gib,
      reserved_gib: isNum(cap.reserved_gib) ? cap.reserved_gib : null,
    },
    price: {
      currency,
      per_gib_month: price.per_gib_month,
      per_gib_transfer: isNum(price.per_gib_transfer) ? price.per_gib_transfer : null,
      min_gib: isNum(price.min_gib) ? price.min_gib : null,
      max_gib: isNum(price.max_gib) ? price.max_gib : null,
      min_days: isNum(price.min_days) ? price.min_days : null,
      max_days: isNum(price.max_days) ? price.max_days : null,
    },
    location: { regions: strList(location.regions), countries },
    network: {
      bandwidth_mbps: isNum(network.bandwidth_mbps) ? network.bandwidth_mbps : null,
      transfer_gb: isNum(network.transfer_gb) ? network.transfer_gb : null,
      ipv4: isNum(network.ipv4) ? network.ipv4 : null,
      ipv6: typeof network.ipv6 === 'boolean' ? network.ipv6 : null,
    },
    storage,
    accepts: {
      visibility,
      bases,
      encrypted_only: typeof accepts.encrypted_only === 'boolean' ? accepts.encrypted_only : null,
      max_file_gib: isNum(accepts.max_file_gib) ? accepts.max_file_gib : null,
      feeds: typeof accepts.feeds === 'boolean' ? accepts.feeds : null,
    },
    proof: {
      kinds: proofKinds.filter((k) => PROOF_KINDS.includes(k)),
      every_hours_min:
        isNum(proof.every_hours_min) && proof.every_hours_min > 0 ? proof.every_hours_min : null,
      webhook: isUrl(proof.webhook) ? proof.webhook : null,
    },
    record: {
      source: isUrl(record.source) ? record.source : null,
      standing: isNum(record.standing) ? record.standing : null,
      proven: isNum(record.proven) ? record.proven : null,
      failed: isNum(record.failed) ? record.failed : null,
      abandoned: isNum(record.abandoned) ? record.abandoned : null,
      since: iso(record.since),
    },
    payout: isObj(doc.payout)
      ? {
          payee: isStr(doc.payout.payee) ? doc.payout.payee : null,
          network: isStr(doc.payout.network) ? doc.payout.network : null,
        }
      : null,
    holding: isUrl(doc.holding) ? doc.holding : Array.isArray(doc.holding) ? doc.holding : null,
  };
  return { ok: true, errors, warnings, disk };
}

/** One seeder identity is one disk, whatever URL it was found at. */
export function diskId(disk, origin) {
  if (disk.key) return disk.key.replace(':', '-');
  return new URL(origin).host.replace(/:/g, '-');
}

/** The OpenServer offer a disk maps onto, as the spec's table says. */
export function toOpenServerOffer(disk, { url, origin, updated }) {
  const stated = disk.data?.model;
  const model = stated === 'centralized' || stated === 'p2p' ? stated : 'p2p';
  const stock =
    disk.capacity.free_gib > 0 && disk.capacity.free_gib >= (disk.price.min_gib ?? 1)
      ? 'in_stock'
      : 'out_of_stock';
  return {
    id: disk.key ?? origin,
    name: disk.name,
    url,
    kind: 'storage',
    premises: 'off-prem',
    management: 'unmanaged',
    tenancy: 'shared',
    model,
    location: disk.location,
    network: Object.fromEntries(Object.entries(disk.network).filter(([, v]) => v !== null)),
    storage: disk.storage,
    price: {
      amount: disk.price.per_gib_month,
      currency: disk.price.currency,
      interval: 'month',
      unit: 'gib',
    },
    stock,
    updated: updated ?? disk.updated ?? null,
  };
}

/** A descriptor a person can paste into a web root, from the generator form. */
export function generate(fields) {
  const num = (v) => {
    const n = Number(v);
    return v === undefined || v === '' || !Number.isFinite(n) ? undefined : n;
  };
  const str = (v) => (isStr(v) ? String(v).trim() : undefined);
  const doc = {
    name: str(fields.name) ?? 'my spare drive',
    capacity: { free_gib: num(fields.free_gib) ?? 100 },
    price: {
      currency: (str(fields.currency) ?? 'USD').toUpperCase(),
      per_gib_month: num(fields.per_gib_month) ?? 0.05,
    },
  };
  if (num(fields.total_gib) !== undefined) doc.capacity.total_gib = num(fields.total_gib);
  if (num(fields.per_gib_transfer) !== undefined)
    doc.price.per_gib_transfer = num(fields.per_gib_transfer);
  if (num(fields.max_gib) !== undefined) doc.price.max_gib = num(fields.max_gib);
  if (num(fields.max_days) !== undefined) doc.price.max_days = num(fields.max_days);
  if (str(fields.web)) doc.web = str(fields.web);
  if (str(fields.operator)) doc.operator = str(fields.operator);
  if (str(fields.key)) doc.key = str(fields.key);
  if (str(fields.hubs))
    doc.hubs = str(fields.hubs)
      .split(/[\s,]+/)
      .filter(Boolean);
  if (str(fields.country)) doc.location = { countries: [str(fields.country).toUpperCase()] };
  if (num(fields.bandwidth_mbps) !== undefined)
    doc.network = { bandwidth_mbps: num(fields.bandwidth_mbps) };
  if (STORAGE_TYPES.includes(fields.storage_type)) {
    const drive = { type: fields.storage_type };
    if (num(fields.size_gb) !== undefined) drive.size_gb = num(fields.size_gb);
    doc.storage = [drive];
  }
  const accepts = {};
  const vis = [].concat(fields.visibility ?? []).filter((v) => VISIBILITY.includes(v));
  if (vis.length) accepts.visibility = vis;
  const bases = [].concat(fields.bases ?? []).filter((v) => BASES.includes(v));
  if (bases.length) accepts.bases = bases;
  if (fields.encrypted_only === 'on' || fields.encrypted_only === true)
    accepts.encrypted_only = true;
  if (num(fields.max_file_gib) !== undefined) accepts.max_file_gib = num(fields.max_file_gib);
  if (Object.keys(accepts).length) doc.accepts = accepts;
  if (num(fields.proof_hours) !== undefined)
    doc.proof = { kinds: ['challenge', 'probe'], every_hours_min: num(fields.proof_hours) };
  doc.updated = new Date().toISOString();
  return doc;
}
