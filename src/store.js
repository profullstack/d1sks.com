import { config } from './config.js';

/**
 * What d1sks.com says about itself as an OpenObject store and as an
 * OpenServer provider. The pool numbers come from the database; the policies
 * and prices are the reference store's, as the OpenObject spec prints them.
 */
export const POLICIES = [
  {
    id: '3x',
    mode: 'replicas',
    replicas: 3,
    min_operators: 3,
    min_countries: 2,
    default: true,
  },
  { id: '2x', mode: 'replicas', replicas: 2, min_operators: 2 },
  { id: 'rs-10-4', mode: 'erasure', k: 10, parity: 4, min_operators: 14 },
];

export const STORE_PRICE = {
  currency: 'USD',
  per_gib_month: { '3x': 0.036, '2x': 0.024, 'rs-10-4': 0.017 },
  per_gib_transfer: 0.005,
  per_10k_ops: 0.004,
  min_gib: 0,
  max_object_gib: 500,
};

const countriesOf = (pool) => [...new Set(pool.flatMap((d) => d.countries ?? []))].sort();

export function openobjectDescriptor({ stats, pool }) {
  return {
    name: config.siteName === 'd1sks' ? 'd1sks.com' : config.siteName,
    web: config.siteUrl,
    operator: config.operator,
    api: `${config.siteUrl}/openobject/v1`,
    disks: `${config.siteUrl}/api/disks`,
    developer: {
      api_docs: `${config.siteUrl}/docs`,
      github: 'https://github.com/profullstack/d1sks.com',
    },
    updated: new Date().toISOString(),
    policies: POLICIES,
    price: STORE_PRICE,
    location: { countries: countriesOf(pool) },
    capacity: { free_gib: Math.round(stats.free_gib), disks: stats.active },
    accepts: {
      encryption: ['owner', 'store'],
      versioning: true,
      public_reads: true,
      mounts: ['fuse', 's3'],
    },
    proof: { every_hours: 6, repair_within_hours: 24 },
    record: { buckets: 0, objects: 0, lost: 0, since: '2026-09-21T00:00:00Z' },
    buckets: {
      open: false,
      why: 'Buckets open when the first listed disks take pay2seed leases through this store. This store indexes disks and places nothing yet.',
    },
  };
}

export function openserverDescriptor({ stats }) {
  const updated = new Date().toISOString();
  const offers = POLICIES.map((p) => ({
    id: `openobject-${p.id}`,
    name: `d1sks.com OpenObject, ${p.id}`,
    url: `${config.siteUrl}/store`,
    kind: 'storage',
    premises: 'off-prem',
    management: 'managed',
    tenancy: 'shared',
    model: 'p2p',
    price: {
      amount: STORE_PRICE.per_gib_month[p.id],
      currency: STORE_PRICE.currency,
      interval: 'month',
      unit: 'gib',
    },
    stock: 'preorder',
    updated,
  }));
  return {
    openserver: '0.2',
    provider: {
      name: 'd1sks.com',
      web: config.siteUrl,
      operator: config.operator,
      country: 'US',
      developer: {
        api_docs: `${config.siteUrl}/docs`,
        github: 'https://github.com/profullstack/d1sks.com',
      },
    },
    updated,
    offers,
    pool: {
      disks: stats.active,
      free_gib: Math.round(stats.free_gib),
      url: `${config.siteUrl}/api/disks`,
    },
  };
}
