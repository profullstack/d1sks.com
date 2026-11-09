import { config } from '../config.js';
import { Layout } from './Layout.jsx';
import { Pre } from './parts.jsx';

export function Docs() {
  const s = config.siteUrl;
  return (
    <Layout title="Docs" path="/docs">
      <section class="band narrow docs">
        <h1>Docs</h1>
        <p class="lead">
          d1sks.com does three things: lists every disk that serves an OpenDisk descriptor, says
          what it is as an OpenObject store, and gives a requester and an agent the same rows as
          data.
        </p>

        <h2>Listing a disk</h2>
        <p>
          Serve <code>/.well-known/opendisk.json</code> on your own origin, as{' '}
          <code>application/json</code>. The smallest valid file is a name, the free space and a
          price:
        </p>
        <Pre>{`{ "name": "spare drive, Lisbon", "capacity": { "free_gib": 900 }, "price": { "currency": "USD", "per_gib_month": 0.08 } }`}</Pre>
        <p>
          Then tell d1sks the origin, on the <a href="/submit">form</a> or from a terminal:
        </p>
        <Pre>{`curl -X POST ${s}/api/v1/disks -H 'content-type: application/json' -d '{"url":"https://your-disk.example"}'`}</Pre>
        <p>
          d1sks fetches the file (https only, 256 KiB at most, ten seconds), validates it against{' '}
          <a href="https://logicsrc.com/docs/opendisk">OpenDisk 0.1</a>, and lists it. It dedupes on
          the seeder <code>key</code>, or on the origin when there is none. Every hour it fetches
          the file again, skipping one whose ETag has not changed. A file that stops answering three
          times in a row and stays gone for a day is marked <em>gone</em>, never deleted. Fields the
          spec names are read; fields it does not are kept and shown. Absence is reported as
          absence.
        </p>

        <h2>Signed listings (behind NAT too)</h2>
        <p>
          A disk with an ed25519 libp2p identity, such as every{' '}
          <a href="https://c0mpute.com">c0mpute</a> node, does not need a public origin. It pushes
          its descriptor, signed with its own key, and re-sends it as a heartbeat (c0mpute nodes
          every 5 minutes). The listing expires when the heartbeats stop.
        </p>
        <Pre>{`POST ${s}/api/v1/disks/announce
{ "payload": "<JSON text>", "signature": "<hex ed25519 signature over the payload text>" }

payload: { "type": "c0mpute.disk.announce/1", "marketplace": "${new URL(s).host}",
           "peer_id": "12D3KooW...", "key": "ed25519:<64 hex>", "ts": <unix seconds>,
           "expires_in": 1200, "origin": null | "https://...",
           "descriptor": { <OpenDisk 0.1>, "c0mpute": { "addrs": ["/ip4/.../tcp/..."], ... } } }`}</Pre>
        <p>
          d1sks checks that <code>peer_id</code> is the key's own peer id and that the signature
          holds, that <code>ts</code> is within ten minutes and newer than the last one, that the
          listing was signed for this marketplace, and that the numbers are sane. One heartbeat per
          key per minute is accepted, and an address may add a limited number of new keys a day. A
          disk with no https origin and no public address is shown as <em>reachable via c0mpute</em>
          : there is no URL to open, but holders and gateways reach it over libp2p. Opting out on a
          c0mpute node: <code>[storage] list_on_d1sks = false</code> or <code>C0MPUTE_D1SKS=0</code>
          .
        </p>

        <h2>Reading disks</h2>
        <p>
          The page at <a href="/disks">/disks</a> and <code>GET /api/v1/disks</code> take the same
          parameters:
        </p>
        <table class="table">
          <tbody>
            <tr>
              <td class="mono">country</td>
              <td>ISO codes, comma separated; a disk in any of them matches</td>
            </tr>
            <tr>
              <td class="mono">min_gib</td>
              <td>free GiB at least</td>
            </tr>
            <tr>
              <td class="mono">max_price</td>
              <td>per GiB-month at most, in the disk's own currency</td>
            </tr>
            <tr>
              <td class="mono">reachable</td>
              <td>https, direct, c0mpute (behind NAT), or public (https or direct)</td>
            </tr>
            <tr>
              <td class="mono">fresh</td>
              <td>minutes: signed listings heard from within that long (origin listings pass)</td>
            </tr>
            <tr>
              <td class="mono">source</td>
              <td>signed or origin</td>
            </tr>
            <tr>
              <td class="mono">encrypted</td>
              <td>1 for ciphertext-only disks, 0 for the rest</td>
            </tr>
            <tr>
              <td class="mono">visibility</td>
              <td>public, private or personal: what the disk will hold</td>
            </tr>
            <tr>
              <td class="mono">base</td>
              <td>own, licensed, open-license, public-domain or personal</td>
            </tr>
            <tr>
              <td class="mono">min_standing</td>
              <td>hub standing at least, as copied into the descriptor</td>
            </tr>
            <tr>
              <td class="mono">hosting</td>
              <td>1 for c0mpute nodes that hold static sites</td>
            </tr>
            <tr>
              <td class="mono">q</td>
              <td>name or origin contains</td>
            </tr>
            <tr>
              <td class="mono">sort, order</td>
              <td>price, free, standing, updated or name; asc or desc</td>
            </tr>
            <tr>
              <td class="mono">status</td>
              <td>active (default), gone or all</td>
            </tr>
            <tr>
              <td class="mono">limit, offset</td>
              <td>page size up to 200, and the offset</td>
            </tr>
          </tbody>
        </table>
        <Pre>{`curl -s '${s}/api/v1/disks?country=DE,FI&min_gib=500&max_price=0.15&sort=price' -H 'accept: application/json'
curl -s '${s}/api/v1/disks/<id>'                 # one disk, with its OpenServer offer
curl -s '${s}/api/v1/disks/<id>/openserver.json' # the offer alone
curl -s '${s}/api/v1/stats'`}</Pre>
        <p>
          Standing is shown as the disk copied it. A marketplace that ranks on standing reads the
          hub in <code>record.source</code>; d1sks shows the number and links the hub, and will read
          the hub itself once one is running.
        </p>

        <h2>Host a site on these disks</h2>
        <p>
          Every <a href="https://c0mpute.com">c0mpute</a> node with the hosting role lists itself
          here with <code>accepts.hosting: true</code>, its peer id and its hosting price in the{' '}
          <code>c0mpute</code> block of its descriptor. <code>?hosting=1</code> lists only those. To
          pay some of them to keep your static site:
        </p>
        <Pre>{`c0mpute hosting publish ./public --name my-site --disks auto
c0mpute hosting publish ./public --name my-site --disks auto --country DE,FI --max-price 0.01 --copies 3
c0mpute hosting disks --country DE   # what --disks auto would pick`}</Pre>
        <p>
          The publisher asks d1sks once, ranks the hosting disks by price, standing and free space,
          and signs the chosen peer ids and the agreed price into its site record. Everything after
          that is peer to peer: the chosen nodes replicate first, the network still keeps at least
          three copies, the publisher challenges holders with random chunk fetches, and pays the
          ones that pass per GiB-month. d1sks is discovery only; a site keeps being served if d1sks
          is down.
        </p>

        <h2>Validating</h2>
        <Pre>{`curl -s '${s}/api/v1/validate?url=https://your-disk.example'
curl -s -X POST '${s}/api/v1/validate' -H 'content-type: application/json' --data-binary @opendisk.json`}</Pre>
        <p>
          Both answer <code>ok</code>, <code>errors</code> (what makes it invalid),{' '}
          <code>warnings</code> (what a reader will ignore or assume) and the normalised{' '}
          <code>disk</code>.
        </p>

        <h2>The pool and the descriptors</h2>
        <ul class="plain">
          <li>
            <a href="/api/disks" class="mono">
              /api/disks
            </a>
            : every active descriptor as fetched, which is the <code>disks</code> field of the store
            descriptor.
          </li>
          <li>
            <a href="/.well-known/openobject.json" class="mono">
              /.well-known/openobject.json
            </a>
            : d1sks.com as an <a href="https://logicsrc.com/docs/openobject">OpenObject</a> store:
            policies, prices, pool summary.
          </li>
          <li>
            <a href="/.well-known/openserver.json" class="mono">
              /.well-known/openserver.json
            </a>
            : the same as <a href="https://logicsrc.com/docs/openserver">OpenServer</a> offers, one
            per policy.
          </li>
          <li>
            <span class="mono">/openobject/v1</span>: the store API root. Bucket routes answer 501
            until buckets open.
          </li>
        </ul>

        <h2>Limits</h2>
        <p>
          Reads are free and unmetered for now. Submissions are thirty per address per hour. Fetches
          go to https origins on public addresses only, follow three redirects at most, and stop at
          256 KiB.
        </p>

        <h2>Source</h2>
        <p>
          <a href="https://github.com/profullstack/d1sks.com">github.com/profullstack/d1sks.com</a>,
          MIT. Bun, Hono, Postgres, no build step. Run it with a <code>DATABASE_URL</code> and{' '}
          <code>bun start</code>.
        </p>
      </section>
    </Layout>
  );
}
