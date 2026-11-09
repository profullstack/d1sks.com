import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { isPublicMultiaddr, reachabilityOf, verifyListing } from '../src/announce.js';
import { makeListing } from './sign.js';

// A listing signed by the c0mpute node code itself (Rust, opendisk::signed_listing),
// key seed [7; 32], ts 1_800_000_000, marketplace d1sks.pwa.pit.world.
const RUST = JSON.parse(
  readFileSync(new URL('./fixtures/rust-signed-listing.json', import.meta.url), 'utf8'),
);
const RUST_NOW = 1_800_000_000_000;
const HOSTS = ['d1sks.pwa.pit.world'];

const refusal = (fn) => {
  try {
    fn();
  } catch (err) {
    return { status: err.status, message: err.message };
  }
  return null;
};

describe('signed listings', () => {
  it('verifies a listing signed by the Rust node code', () => {
    const l = verifyListing(RUST, { now: RUST_NOW, hosts: HOSTS });
    expect(l.peerId).toBe('12D3KooWRawPbxPtP1eZaJpumGnyWX2DcUyd3RQnydr3eAto4Az7');
    expect(l.key.startsWith('ed25519:')).toBe(true);
    expect(l.reachable).toBe('direct');
    expect(l.disk.location.countries).toEqual(['DE']);
    expect(l.disk.key).toBe(l.key);
    expect(l.expiresIn).toBe(1200);
  });

  it('derives the libp2p peer id from the key', () => {
    const l = makeListing();
    expect(l.peer.startsWith('12D3KooW')).toBe(true);
  });

  it('refuses tampering, other keys, replays from elsewhere and stale clocks', () => {
    const tampered = {
      ...RUST,
      payload: RUST.payload.replace('"free_gib":100.0', '"free_gib":99'),
    };
    expect(refusal(() => verifyListing(tampered, { now: RUST_NOW, hosts: HOSTS }))?.status).toBe(
      401,
    );
    expect(
      refusal(() => verifyListing(RUST, { now: RUST_NOW, hosts: ['d1sks.example'] }))?.message,
    ).toContain('another marketplace');
    expect(
      refusal(() => verifyListing(RUST, { now: RUST_NOW + 3_600_000, hosts: HOSTS }))?.message,
    ).toContain('too old');
    expect(
      refusal(() => verifyListing(RUST, { now: RUST_NOW - 3_600_000, hosts: HOSTS }))?.message,
    ).toContain('future');

    const other = makeListing();
    const wrongPeer = makeListing({ peer_id: other.peer });
    expect(refusal(() => verifyListing(wrongPeer.body, { hosts: HOSTS }))?.message).toContain(
      'not the peer id',
    );
    expect(refusal(() => verifyListing({ payload: 'x', signature: 'nope' }))?.status).toBe(400);
    expect(refusal(() => verifyListing(null))?.status).toBe(400);
  });

  it('refuses numbers that are not sane and bad addresses', () => {
    const big = makeListing({}, { descriptor: { capacity: { free_gib: 9e9, total_gib: 9e9 } } });
    expect(refusal(() => verifyListing(big.body, { hosts: HOSTS }))?.message).toContain('sane');
    const more = makeListing({}, { descriptor: { capacity: { free_gib: 900, total_gib: 10 } } });
    expect(refusal(() => verifyListing(more.body, { hosts: HOSTS }))?.message).toContain('larger');
    const pricey = makeListing(
      {},
      { descriptor: { price: { currency: 'USD', per_gib_month: 500 } } },
    );
    expect(refusal(() => verifyListing(pricey.body, { hosts: HOSTS }))?.message).toContain('sane');
    const l = makeListing();
    const p = JSON.parse(l.body.payload);
    p.descriptor.c0mpute.addrs = Array.from({ length: 40 }, (_, i) => `/ip4/1.1.1.${i}/tcp/1`);
    expect(
      refusal(() => verifyListing({ ...l.body, payload: JSON.stringify(p) }, { hosts: HOSTS })),
    ).not.toBeNull();
    const http = makeListing({ origin: 'http://insecure.example' });
    expect(refusal(() => verifyListing(http.body, { hosts: HOSTS }))?.message).toContain('https');
  });

  it('says NAT disks are reachable through c0mpute', () => {
    const l = verifyListing(makeListing().body, { hosts: HOSTS });
    expect(l.reachable).toBe('c0mpute');
    const o = verifyListing(makeListing({ origin: 'https://disk.example/x' }).body, {
      hosts: HOSTS,
    });
    expect(o.reachable).toBe('https');
    expect(o.origin).toBe('https://disk.example');
    expect(reachabilityOf(null, ['/ip6/2a01:4f8::1/tcp/1'])).toBe('direct');
    expect(isPublicMultiaddr('/ip4/10.1.2.3/tcp/1')).toBe(false);
    expect(isPublicMultiaddr('/ip4/100.70.0.1/tcp/1')).toBe(false);
    expect(isPublicMultiaddr('/ip6/fd12::1/tcp/1')).toBe(false);
    expect(isPublicMultiaddr('/dns4/node.example.com/tcp/1')).toBe(true);
  });
});
