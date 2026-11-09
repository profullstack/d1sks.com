/**
 * Signed listings: a c0mpute node (or any OpenDisk seeder with an ed25519
 * libp2p identity) pushes its descriptor here instead of waiting to be
 * fetched, so a disk behind NAT can be listed too. Pure functions, no I/O.
 *
 * Wire format (POST /api/v1/disks/announce):
 *   { "payload": "<JSON text>", "signature": "<hex ed25519 over the text>" }
 * payload:
 *   { type: "c0mpute.disk.announce/1", marketplace, peer_id, key, ts,
 *     expires_in, origin, descriptor }
 *
 * The key inside the libp2p peer id IS the signer: the peer id is checked to
 * be the identity multihash of `key`, and the signature is checked against
 * that key. No origin fetch is needed.
 */
import { createPublicKey, verify } from 'node:crypto';
import { validate } from './opendisk.js';

export const ANNOUNCE_TYPE = 'c0mpute.disk.announce/1';

export const LIMITS = Object.freeze({
  maxBodyBytes: 32 * 1024,
  maxPayloadBytes: 24 * 1024,
  pastSkewSecs: 600,
  futureSkewSecs: 120,
  minExpiresIn: 300,
  maxExpiresIn: 3600,
  defaultExpiresIn: 1200,
  maxGib: 1024 * 1024,
  maxPricePerGibMonth: 10,
  maxName: 120,
  maxAddrs: 16,
  maxAddrLen: 256,
});

const KEY_RE = /^ed25519:([0-9a-f]{64})$/;
const SIG_RE = /^[0-9a-f]{128}$/;
const PEER_RE = /^[1-9A-HJ-NP-Za-km-z]{40,64}$/;
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
// SubjectPublicKeyInfo DER prefix for a raw 32-byte Ed25519 key.
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');

export function base58(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/**
 * The libp2p peer id of a raw ed25519 public key: base58btc of the identity
 * multihash (0x00, length 36) over the protobuf PublicKey { Type: Ed25519, Data }.
 */
export function peerIdOfKey(raw) {
  const pb = Buffer.concat([Buffer.from([0x08, 0x01, 0x12, 0x20]), Buffer.from(raw)]);
  return base58(Buffer.concat([Buffer.from([0x00, pb.length]), pb]));
}

export function verifyEd25519(raw, message, signature) {
  try {
    const key = createPublicKey({
      key: Buffer.concat([SPKI_ED25519, Buffer.from(raw)]),
      format: 'der',
      type: 'spki',
    });
    return verify(null, Buffer.from(message), key, Buffer.from(signature));
  } catch {
    return false;
  }
}

function ipv4Public(s) {
  const o = s.split('.').map(Number);
  if (o.length !== 4 || o.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return false;
  const [a, b, c] = o;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  return true;
}

function ipv6Public(s) {
  const v = s.toLowerCase();
  if (v === '::' || v === '::1') return false;
  if (/^f[cd]/.test(v)) return false; // fc00::/7
  if (/^fe[89ab]/.test(v)) return false; // fe80::/10
  if (v.startsWith('::ffff:')) return ipv4Public(v.slice(7));
  return /^[0-9a-f:]+$/.test(v);
}

/** A multiaddr on a public IP or a DNS name. */
export function isPublicMultiaddr(addr) {
  const p = String(addr).split('/');
  // ['', 'ip4', '1.2.3.4', 'tcp', '4001', ...]
  for (let i = 1; i + 1 < p.length; i += 1) {
    if (p[i] === 'ip4') return ipv4Public(p[i + 1]);
    if (p[i] === 'ip6') return ipv6Public(p[i + 1]);
    if (p[i] === 'dns' || p[i] === 'dns4' || p[i] === 'dns6') return p[i + 1].includes('.');
  }
  return false;
}

/** How a listed disk is reached: https origin, a public multiaddr, or only through c0mpute. */
export function reachabilityOf(origin, addrs) {
  if (origin) return 'https';
  if (addrs.some(isPublicMultiaddr)) return 'direct';
  return 'c0mpute';
}

function httpsOrigin(v) {
  if (v === null || v === undefined || v === '') return null;
  let u;
  try {
    u = new URL(String(v));
  } catch {
    throw new Error('`origin` is not a URL.');
  }
  if (u.protocol !== 'https:') throw new Error('`origin` must be https.');
  if (u.username || u.password) throw new Error('No credentials in `origin`.');
  return u.origin;
}

class Refused extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Check a signed listing. Returns the listing to store, or throws a
 * `Refused` carrying an HTTP status and a reason a person can read.
 * `hosts` are the marketplace hostnames this server answers to.
 */
export function verifyListing(body, { now = Date.now(), hosts = [] } = {}) {
  if (body === null || typeof body !== 'object' || Array.isArray(body))
    throw new Refused('Send {"payload": "<JSON text>", "signature": "<hex>"}.');
  const { payload, signature } = body;
  if (typeof payload !== 'string' || !payload.length) throw new Refused('`payload` is missing.');
  if (Buffer.byteLength(payload) > LIMITS.maxPayloadBytes)
    throw new Refused('`payload` is too large.', 413);
  if (typeof signature !== 'string' || !SIG_RE.test(signature))
    throw new Refused('`signature` must be 128 hex characters (ed25519).');

  let p;
  try {
    p = JSON.parse(payload);
  } catch {
    throw new Refused('`payload` is not JSON.');
  }
  if (p === null || typeof p !== 'object' || Array.isArray(p))
    throw new Refused('`payload` is not an object.');
  if (p.type !== ANNOUNCE_TYPE) throw new Refused(`\`type\` must be ${ANNOUNCE_TYPE}.`);

  const km = KEY_RE.exec(String(p.key ?? ''));
  if (!km) throw new Refused('`key` must be ed25519: followed by 64 hex characters.');
  const raw = Buffer.from(km[1], 'hex');
  if (typeof p.peer_id !== 'string' || !PEER_RE.test(p.peer_id))
    throw new Refused('`peer_id` is not a libp2p peer id.');
  if (peerIdOfKey(raw) !== p.peer_id) throw new Refused('`peer_id` is not the peer id of `key`.');
  if (!verifyEd25519(raw, payload, Buffer.from(signature, 'hex')))
    throw new Refused('The signature does not verify against `key`.', 401);

  if (hosts.length && !hosts.includes(String(p.marketplace ?? '').toLowerCase()))
    throw new Refused('This listing was signed for another marketplace.');
  if (!Number.isSafeInteger(p.ts)) throw new Refused('`ts` must be unix seconds.');
  const nowSecs = Math.floor(now / 1000);
  if (p.ts < nowSecs - LIMITS.pastSkewSecs) throw new Refused('`ts` is too old; check the clock.');
  if (p.ts > nowSecs + LIMITS.futureSkewSecs)
    throw new Refused('`ts` is in the future; check the clock.');

  const expiresIn = Number.isFinite(p.expires_in)
    ? Math.min(Math.max(Math.round(p.expires_in), LIMITS.minExpiresIn), LIMITS.maxExpiresIn)
    : LIMITS.defaultExpiresIn;

  let origin;
  try {
    origin = httpsOrigin(p.origin);
  } catch (err) {
    throw new Refused(err.message);
  }

  const doc = p.descriptor;
  const v = validate(doc);
  if (!v.ok) throw new Refused(v.errors.join(' '));
  if (doc.key !== undefined && doc.key !== p.key)
    throw new Refused('`descriptor.key` is not the signing key.');
  doc.key = p.key;
  v.disk.key = p.key;
  const c = doc.c0mpute && typeof doc.c0mpute === 'object' ? doc.c0mpute : null;
  if (c && c.peer_id !== undefined && c.peer_id !== p.peer_id)
    throw new Refused('`descriptor.c0mpute.peer_id` is not the signer.');

  const d = v.disk;
  if (d.name.length > LIMITS.maxName) throw new Refused('`name` is too long.');
  if (d.capacity.free_gib > LIMITS.maxGib) throw new Refused('`capacity.free_gib` is not sane.');
  if (d.capacity.total_gib !== null && d.capacity.total_gib > LIMITS.maxGib)
    throw new Refused('`capacity.total_gib` is not sane.');
  if (d.capacity.total_gib !== null && d.capacity.free_gib > d.capacity.total_gib + 0.01)
    throw new Refused('`capacity.free_gib` is larger than `capacity.total_gib`.');
  if (d.price.per_gib_month > LIMITS.maxPricePerGibMonth)
    throw new Refused('`price.per_gib_month` is not sane.');

  const rawAddrs = c?.addrs ?? [];
  if (!Array.isArray(rawAddrs) || rawAddrs.length > LIMITS.maxAddrs)
    throw new Refused(`\`c0mpute.addrs\` must be a list of at most ${LIMITS.maxAddrs}.`);
  const addrs = rawAddrs.filter(
    (a) => typeof a === 'string' && a.startsWith('/') && a.length <= LIMITS.maxAddrLen,
  );
  if (addrs.length !== rawAddrs.length) throw new Refused('`c0mpute.addrs` must be multiaddrs.');
  const reachable = reachabilityOf(origin, addrs);
  if (c) c.reachable = reachable;

  return {
    key: p.key,
    peerId: p.peer_id,
    ts: p.ts,
    expiresIn,
    origin,
    addrs,
    reachable,
    doc,
    disk: d,
    warnings: v.warnings,
  };
}

export { Refused };
