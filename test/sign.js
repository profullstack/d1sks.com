import { generateKeyPairSync, sign } from 'node:crypto';
import { ANNOUNCE_TYPE, peerIdOfKey } from '../src/announce.js';

/** Sign a listing the way a node does, with a fresh ed25519 key. */
export function makeListing(
  over = {},
  { now = Date.now(), descriptor = {}, keys = generateKeyPairSync('ed25519') } = {},
) {
  const { publicKey, privateKey } = keys;
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
  const key = `ed25519:${raw.toString('hex')}`;
  const peer = peerIdOfKey(raw);
  const payload = {
    type: ANNOUNCE_TYPE,
    marketplace: 'd1sks.pwa.pit.world',
    peer_id: peer,
    key,
    ts: Math.floor(now / 1000),
    expires_in: 1200,
    origin: null,
    descriptor: {
      opendisk: '0.1',
      name: `c0mpute node ${peer.slice(-8)}`,
      capacity: { free_gib: 120, total_gib: 500 },
      price: { currency: 'USD', per_gib_month: 0.004 },
      accepts: { hosting: true, visibility: ['public', 'private'] },
      key,
      c0mpute: {
        peer_id: peer,
        roles: ['storage', 'hosting'],
        version: '0.2.95',
        addrs: ['/ip4/192.168.1.9/tcp/4001'],
        hosting: { price_per_gib_month: 0.004, max_gib: 5 },
      },
      ...descriptor,
    },
    ...over,
  };
  const text = JSON.stringify(payload);
  const signature = sign(null, Buffer.from(text), privateKey).toString('hex');
  return { body: { payload: text, signature }, peer, key, keys };
}
