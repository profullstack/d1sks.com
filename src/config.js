/**
 * Every environment variable the deployment reads, read once, with the
 * defaults the code relies on. Nothing else in the tree touches process.env.
 */
const env = process.env;
const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== '' ? n : d;
};
const list = (v) =>
  String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const siteUrl = (env.SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const isTest = env.NODE_ENV === 'test' || Boolean(env.BUN_TEST);

export const config = Object.freeze({
  isProd: env.NODE_ENV === 'production',
  isTest,
  siteUrl,
  siteName: env.SITE_NAME ?? 'd1sks',
  siteHost: new URL(siteUrl).host,
  port: num(env.PORT, 3000),
  roles: list(env.ROLES ?? 'web,worker'),
  databaseUrl: env.DATABASE_URL ?? (isTest ? 'postgres://d1sks:d1sks@localhost:5443/d1sks' : ''),
  poll: {
    minutes: num(env.POLL_MINUTES, 15),
    staleMinutes: num(env.POLL_STALE_MINUTES, 60),
    goneAfterHours: num(env.POLL_GONE_AFTER_HOURS, 24),
    batch: num(env.POLL_BATCH, 50),
  },
  fetch: {
    timeoutMs: num(env.FETCH_TIMEOUT_MS, 10_000),
    maxBytes: num(env.FETCH_MAX_BYTES, 256 * 1024),
  },
  submit: { perIpPerHour: num(env.SUBMIT_PER_IP_PER_HOUR, 30) },
  announce: {
    // Signed heartbeats: at most one accepted per key per minSecs, this many
    // per address per hour, and this many distinct new keys per address a day.
    minSecs: num(env.ANNOUNCE_MIN_SECS, 60),
    perIpPerHour: num(env.ANNOUNCE_PER_IP_PER_HOUR, 600),
    newKeysPerIpPerDay: num(env.ANNOUNCE_NEW_KEYS_PER_IP_PER_DAY, 50),
    // The hostnames a listing may be signed for (this site answers to all).
    hosts: [
      ...new Set([
        new URL(siteUrl).host.toLowerCase(),
        ...list(env.ANNOUNCE_HOSTS ?? 'd1sks.com,www.d1sks.com,d1sks.pwa.pit.world'),
      ]),
    ],
  },
  operator: env.OPERATOR_URL ?? 'https://profullstack.com/.well-known/openprofile.md',
});
