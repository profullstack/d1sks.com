import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { config } from './config.js';

/**
 * Fetch a document a stranger named. https only, no private addresses at any
 * hop, three redirects at most, a byte cap and a timeout.
 */
const PRIVATE_V4 = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^224\./,
  /^240\./,
  /^255\./,
];
export function isPrivateIp(ip) {
  const v = isIP(ip);
  if (v === 4) return PRIVATE_V4.some((re) => re.test(ip));
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === '::1' || s === '::') return true;
    if (s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80')) return true;
    const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isPrivateIp(m[1]);
    return false;
  }
  return true;
}

async function assertPublic(url) {
  const u = new URL(url);
  const local = !config.isProd && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:'))
    throw new Error('Only https origins are fetched.');
  if (local) return;
  if (u.username || u.password) throw new Error('No credentials in the URL.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length) throw new Error(`${host} does not resolve.`);
  for (const { address } of addrs)
    if (isPrivateIp(address)) throw new Error(`${host} resolves to a private address.`);
}

export async function safeFetch(
  url,
  { headers = {}, maxBytes = config.fetch.maxBytes, timeoutMs = config.fetch.timeoutMs } = {},
) {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(current);
    const res = await fetch(current, {
      headers: {
        accept: 'application/json',
        'user-agent': 'd1sks.com/0.1 (+https://d1sks.com/docs)',
        ...headers,
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`Redirect without a location from ${current}.`);
      current = new URL(loc, current).toString();
      continue;
    }
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > maxBytes) throw new Error(`Body is ${len} bytes; the cap is ${maxBytes}.`);
    const reader = res.body?.getReader();
    const chunks = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw new Error(`Body is over ${maxBytes} bytes.`);
        }
        chunks.push(value);
      }
    }
    const text = new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
    return { status: res.status, headers: res.headers, text, url: current };
  }
  throw new Error('Too many redirects.');
}
