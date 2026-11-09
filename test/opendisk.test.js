import { describe, expect, it } from 'bun:test';
import {
  c0mputeOf,
  descriptorUrl,
  diskId,
  generate,
  isC0mputeHosting,
  toOpenServerOffer,
  validate,
  wantsHosting,
} from '../src/opendisk.js';

const FULL = {
  name: 'seeder-a41e, Falkenstein',
  web: 'https://seeder-a41e.example',
  operator: 'https://seeder-a41e.example/.well-known/openprofile.md',
  key: 'ed25519:a41e7f0c2d9b8e5a6f3c1d4e7b0a9f8c5d2e1b4a7c0f3e6d9b2a5c8e1f4d7b0a',
  hubs: ['https://bittorrented.com/api/openswarm'],
  updated: '2026-09-13T06:00:00Z',
  capacity: { total_gib: 3726, free_gib: 2210, reserved_gib: 200 },
  price: {
    currency: 'USD',
    per_gib_month: 0.12,
    per_gib_transfer: 0.004,
    min_gib: 1,
    max_gib: 2000,
    min_days: 7,
    max_days: 365,
  },
  location: { regions: ['fsn1'], countries: ['de'] },
  network: { bandwidth_mbps: 1000, transfer_gb: 20000, ipv4: 1, ipv6: true },
  storage: [{ type: 'hdd', size_gb: 4000 }],
  accepts: {
    visibility: ['private', 'public'],
    bases: ['own'],
    encrypted_only: false,
    max_file_gib: 500,
    feeds: true,
  },
  proof: { kinds: ['challenge', 'probe'], every_hours_min: 6 },
  record: { source: 'https://bittorrented.com/api/openswarm/pay2seed/seeders/x', standing: 412 },
  payout: { payee: 'ed25519:a41e', network: 'eip155:8453' },
  extra: { anything: true },
};

const PEER = '12D3KooWSFxwveBjrGy4n1Djg3vpQD5aHPCXYCQHZWruffig7P4J';

/** What a c0mpute node with the hosting role serves (node/crates/c0mpute-core/src/opendisk.rs). */
const c0mputeDoc = (over = {}) => ({
  opendisk: '0.1',
  name: 'c0mpute node ffig7P4J',
  capacity: { free_gib: 900, total_gib: 1000 },
  price: { currency: 'USD', per_gib_month: 0.004 },
  accepts: { visibility: ['public', 'private'], encrypted_only: false, hosting: true },
  c0mpute: {
    peer_id: PEER,
    version: '0.2.79',
    roles: ['storage', 'gateway', 'hosting'],
    hosting: { price_per_gib_month: 0.003, max_gib: 5 },
  },
  ...over,
});

describe('c0mpute hosting disks', () => {
  it('reads the c0mpute block of a hosting node', () => {
    const c = c0mputeOf(c0mputeDoc());
    expect(c.peer_id).toBe(PEER);
    expect(c.hosting).toBe(true);
    expect(c.hosting_price).toBe(0.003);
    expect(c.hosting_max_gib).toBe(5);
    expect(isC0mputeHosting(c0mputeDoc())).toBe(true);
    const v = validate(c0mputeDoc());
    expect(v.ok).toBe(true);
    expect(v.disk.accepts.hosting).toBe(true);
    expect(v.disk.c0mpute.peer_id).toBe(PEER);
  });

  it('counts the hosting role or accepts.hosting, either one', () => {
    const roleOnly = c0mputeDoc({ accepts: {} });
    expect(isC0mputeHosting(roleOnly)).toBe(true);
    const flagOnly = c0mputeDoc();
    flagOnly.c0mpute = { ...flagOnly.c0mpute, roles: ['storage'] };
    expect(isC0mputeHosting(flagOnly)).toBe(true);
  });

  it('is not a hosting disk without the role, a c0mpute block or a real peer id', () => {
    const storageOnly = c0mputeDoc({ accepts: { hosting: false } });
    storageOnly.c0mpute = { peer_id: PEER, roles: ['storage'] };
    expect(isC0mputeHosting(storageOnly)).toBe(false);
    expect(c0mputeOf(storageOnly).hosting_price).toBe(null);
    expect(isC0mputeHosting({ name: 'x', accepts: { hosting: true } })).toBe(false);
    const badPeer = c0mputeDoc();
    badPeer.c0mpute = { ...badPeer.c0mpute, peer_id: 'not a peer id' };
    expect(c0mputeOf(badPeer)).toBe(null);
    expect(isC0mputeHosting(null)).toBe(false);
    expect(
      validate({ name: 'x', capacity: { free_gib: 1 }, price: { per_gib_month: 1 } }).disk.c0mpute,
    ).toBe(null);
  });

  it('parses the hosting listing parameter', () => {
    for (const v of ['1', 'true', 'c0mpute']) expect(wantsHosting(v)).toBe(true);
    for (const v of [undefined, '', '0', 'false', 'yes']) expect(wantsHosting(v)).toBe(false);
  });
});

describe('descriptorUrl', () => {
  it('normalises a host, an origin and the file itself to the well-known path', () => {
    expect(descriptorUrl('example.com')).toBe('https://example.com/.well-known/opendisk.json');
    expect(descriptorUrl('https://example.com/')).toBe(
      'https://example.com/.well-known/opendisk.json',
    );
    expect(descriptorUrl('https://example.com:8443/.well-known/opendisk.json')).toBe(
      'https://example.com:8443/.well-known/opendisk.json',
    );
  });
  it('refuses any other path and credentials', () => {
    expect(() => descriptorUrl('https://example.com/disk.json')).toThrow(/well-known/);
    expect(() => descriptorUrl('https://u:p@example.com/')).toThrow(/credentials/);
    expect(() => descriptorUrl('')).toThrow();
  });
});

describe('validate', () => {
  it('accepts the smallest valid descriptor and assumes USD with a warning', () => {
    const v = validate({
      name: 'spare',
      capacity: { free_gib: 900 },
      price: { per_gib_month: 0.08 },
    });
    expect(v.ok).toBe(true);
    expect(v.disk.price.currency).toBe('USD');
    expect(v.warnings.join(' ')).toMatch(/currency/);
    expect(v.disk.location.countries).toEqual([]);
  });
  it('rejects a descriptor missing a required key, naming it', () => {
    const v = validate({ name: 'x', capacity: {}, price: { per_gib_month: 1 } });
    expect(v.ok).toBe(false);
    expect(v.errors[0]).toMatch(/free_gib/);
    expect(validate('nope').ok).toBe(false);
    expect(
      validate({ name: 'x', capacity: { free_gib: -1 }, price: { per_gib_month: 1 } }).ok,
    ).toBe(false);
  });
  it('normalises the full example and keeps its facts', () => {
    const v = validate(FULL);
    expect(v.ok).toBe(true);
    expect(v.warnings).toEqual([]);
    expect(v.disk.location.countries).toEqual(['DE']);
    expect(v.disk.key).toBe(FULL.key);
    expect(v.disk.accepts.encrypted_only).toBe(false);
    expect(v.disk.proof.every_hours_min).toBe(6);
    expect(v.disk.record.standing).toBe(412);
    expect(v.disk.storage).toEqual([{ type: 'hdd', size_gb: 4000 }]);
  });
  it('warns about what it ignores rather than failing', () => {
    const v = validate({
      ...FULL,
      key: 'not-a-key',
      accepts: { visibility: ['loud'] },
      location: { countries: ['Germany'] },
      proof: { every_hours_min: -3 },
    });
    expect(v.ok).toBe(true);
    expect(v.disk.key).toBe(null);
    expect(v.warnings.some((w) => w.includes('key'))).toBe(true);
    expect(v.warnings.some((w) => w.includes('visibility'))).toBe(true);
    expect(v.warnings.some((w) => w.includes('countries'))).toBe(true);
    expect(v.disk.proof.every_hours_min).toBe(null);
  });
});

describe('diskId', () => {
  it('is the key when there is one, else the origin host', () => {
    expect(diskId(validate(FULL).disk, 'https://seeder-a41e.example')).toBe(
      `ed25519-${FULL.key.slice(8)}`,
    );
    const v = validate({ name: 'x', capacity: { free_gib: 1 }, price: { per_gib_month: 1 } });
    expect(diskId(v.disk, 'https://box.example:8443')).toBe('box.example-8443');
  });
});

describe('toOpenServerOffer', () => {
  it('maps onto a storage offer with the spec units', () => {
    const disk = { ...validate(FULL).disk, data: FULL };
    const o = toOpenServerOffer(disk, {
      url: 'https://seeder-a41e.example/.well-known/opendisk.json',
      origin: 'https://seeder-a41e.example',
    });
    expect(o.kind).toBe('storage');
    expect(o.model).toBe('p2p');
    expect(o.price).toEqual({ amount: 0.12, currency: 'USD', interval: 'month', unit: 'gib' });
    expect(o.stock).toBe('in_stock');
    expect(o.location.countries).toEqual(['DE']);
    expect(o.network.bandwidth_mbps).toBe(1000);
  });
  it('is out of stock when free space is under the minimum lease', () => {
    const v = validate({
      name: 'x',
      capacity: { free_gib: 0.5 },
      price: { currency: 'USD', per_gib_month: 1, min_gib: 1 },
    });
    expect(toOpenServerOffer({ ...v.disk, data: {} }, { url: 'u', origin: 'o' }).stock).toBe(
      'out_of_stock',
    );
  });
});

describe('generate', () => {
  it('produces a descriptor that validates', () => {
    const doc = generate({
      name: 'closet',
      free_gib: '900',
      per_gib_month: '0.08',
      currency: 'usd',
      country: 'pt',
      visibility: ['public', 'private'],
      encrypted_only: 'on',
      storage_type: 'hdd',
      size_gb: '4000',
      proof_hours: '6',
    });
    const v = validate(doc);
    expect(v.ok).toBe(true);
    expect(v.warnings).toEqual([]);
    expect(doc.location.countries).toEqual(['PT']);
    expect(doc.accepts.encrypted_only).toBe(true);
    expect(doc.storage).toEqual([{ type: 'hdd', size_gb: 4000 }]);
  });
});
