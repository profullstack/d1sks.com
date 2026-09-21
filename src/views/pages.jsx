import { config } from '../config.js';
import { POLICIES, STORE_PRICE } from '../store.js';
import { Layout } from './Layout.jsx';
import { ago, DiskRow, fmtGib, fmtPrice, Pre, Stat, Warnings } from './parts.jsx';

const EXAMPLE = `{
  "name": "spare drive, Lisbon",
  "operator": "https://you.example/.well-known/openprofile.md",
  "capacity": { "total_gib": 3726, "free_gib": 2210 },
  "price": { "currency": "USD", "per_gib_month": 0.08, "max_gib": 2000, "max_days": 365 },
  "location": { "countries": ["PT"] },
  "accepts": { "visibility": ["private", "public"], "encrypted_only": false },
  "proof": { "kinds": ["challenge", "probe"], "every_hours_min": 6 }
}`;

export function Home({ stats, cheapest, biggest }) {
  return (
    <Layout path="/">
      <section class="hero">
        <p class="kicker">
          <span class="dot" /> {stats.active} disks · {fmtGib(stats.free_gib)} free ·{' '}
          {stats.countries} {stats.countries === 1 ? 'country' : 'countries'} · refetched{' '}
          {ago(stats.fetched_at)}
        </p>
        <h1>
          Every disk for rent.
          <br />
          <span class="grad">Found, not waited for.</span>
        </h1>
        <p class="lead">
          A disk puts its free space, price, policy and standing at{' '}
          <code>/.well-known/opendisk.json</code>. d1sks reads the file, lists the disk, and reads
          it again every hour. A requester reads the disk before posting an offer, and a peer with a
          spare terabyte is on the market by putting a file at a URL.
        </p>
        <form class="omnibox" action="/submit" method="get">
          <input
            type="text"
            name="url"
            placeholder="your-disk.example"
            aria-label="Domain of a disk to list"
          />
          <button type="submit" class="primary">
            List a disk
          </button>
        </form>
        <p class="muted">
          No descriptor yet? <a href="/serve">Write one in a minute.</a> Already serving one?{' '}
          <a href="/validate">Check it.</a>
        </p>
      </section>

      <section class="band stats">
        <Stat label="disks listed" value={stats.active} />
        <Stat label="free, in total" value={fmtGib(stats.free_gib)} />
        <Stat
          label="cheapest per GiB-month"
          value={stats.cheapest === null ? 'n/a' : fmtPrice(stats.cheapest)}
        />
        <Stat label="operators" value={stats.operators} />
      </section>

      {cheapest.length ? (
        <section class="band">
          <h2>
            Cheapest{' '}
            <a class="more" href="/disks?sort=price">
              all
            </a>
          </h2>
          <div class="rows">
            {cheapest.map((d) => (
              <DiskRow d={d} />
            ))}
          </div>
        </section>
      ) : null}
      {biggest.length ? (
        <section class="band">
          <h2>
            Most room{' '}
            <a class="more" href="/disks?sort=free">
              all
            </a>
          </h2>
          <div class="rows">
            {biggest.map((d) => (
              <DiskRow d={d} />
            ))}
          </div>
        </section>
      ) : null}

      <section class="band three">
        <div class="card">
          <h3>For a disk</h3>
          <p>
            Serve one JSON file. Name, free GiB and a price are the only required keys. Everything
            else, policy, proof cadence, hub standing, is read if stated and reported as unstated if
            not. <a href="/serve">Generate it</a>, then <a href="/submit">list it</a>.
          </p>
        </div>
        <div class="card">
          <h3>For a requester</h3>
          <p>
            Filter by country, free space, price, and what the disk will hold. Read the descriptor,
            check standing at its hub, post a <code>pay2seed</code> offer there. Nothing on the
            swarm side changes. <a href="/disks">Browse.</a>
          </p>
        </div>
        <div class="card">
          <h3>For a bucket</h3>
          <p>
            The <a href="/store">store</a> keeps{' '}
            <a href="https://logicsrc.com/openobject">OpenObject</a> buckets at three replicas on
            three operators in two countries, placed on these disks. The descriptor is live; buckets
            open when the first disks take leases.
          </p>
        </div>
      </section>

      <section class="band agent">
        <h2>For agents</h2>
        <Pre>{`curl -s '${config.siteUrl}/api/v1/disks?country=DE&min_gib=500&sort=price' -H 'accept: application/json'
curl -s -X POST '${config.siteUrl}/api/v1/disks' -H 'content-type: application/json' -d '{"url":"https://your-disk.example"}'
curl -s '${config.siteUrl}/.well-known/openobject.json'`}</Pre>
        <p class="muted">
          <a href="/llms.txt">llms.txt</a> says the rest. Every listed disk is also an{' '}
          <a href="https://logicsrc.com/openserver">OpenServer</a> offer.
        </p>
      </section>
    </Layout>
  );
}

export function Submit({ url = '', error }) {
  return (
    <Layout title="List a disk" path="/submit">
      <section class="band narrow">
        <h1>List a disk</h1>
        <p class="lead">
          Give the origin. d1sks fetches <code>/.well-known/opendisk.json</code> from it, checks it
          against <a href="https://logicsrc.com/docs/opendisk">OpenDisk 0.1</a>, and lists it. One
          seeder key is one disk, whatever URL it was found at.
        </p>
        {error ? <p class="error">{error}</p> : null}
        <form method="post" action="/disks" class="stack">
          <label>
            Origin
            <input
              type="text"
              name="url"
              value={url}
              placeholder="https://your-disk.example"
              required
              autofocus
            />
          </label>
          <button type="submit" class="primary">
            Fetch and list
          </button>
        </form>
        <h2>Before you list</h2>
        <ol class="steps">
          <li>
            <a href="/serve">Write the descriptor</a>, or by hand from the example below.
          </li>
          <li>
            Serve it at <code>https://your-disk.example/.well-known/opendisk.json</code> as{' '}
            <code>application/json</code>, next to <code>robots.txt</code>.
          </li>
          <li>
            <a href="/validate">Check it</a> without listing, if you like.
          </li>
          <li>
            Rewrite it when a lease starts or ends; d1sks refetches every hour and skips an
            unchanged ETag.
          </li>
        </ol>
        <Pre>{EXAMPLE}</Pre>
        <p class="muted">
          Or from a terminal:{' '}
          <code>
            curl -X POST {config.siteUrl}/api/v1/disks -H 'content-type: application/json' -d '{'{'}
            "url":"https://your-disk.example"{'}'}'
          </code>
        </p>
      </section>
    </Layout>
  );
}

export function Validate({ url = '', result }) {
  return (
    <Layout title="Validate a descriptor" path="/validate">
      <section class="band narrow">
        <h1>Check a descriptor</h1>
        <p class="lead">
          Fetches the file and says what a reader will make of it, without listing anything.
        </p>
        <form method="get" action="/validate" class="stack">
          <label>
            Origin
            <input
              type="text"
              name="url"
              value={url}
              placeholder="https://your-disk.example"
              required
              autofocus
            />
          </label>
          <button type="submit" class="primary">
            Check
          </button>
        </form>
        {result ? (
          result.ok ? (
            <div>
              <p class="notice">
                Valid. {result.disk.name}: {fmtGib(result.disk.capacity.free_gib)} free at{' '}
                {fmtPrice(result.disk.price.per_gib_month, result.disk.price.currency)} per
                GiB-month.
              </p>
              <Warnings warnings={result.warnings} />
              <p>
                <a class="button" href={`/submit?url=${encodeURIComponent(url)}`}>
                  List it
                </a>
              </p>
              <Pre>{JSON.stringify(result.disk, null, 2)}</Pre>
            </div>
          ) : (
            <div class="error">
              <strong>Not valid.</strong>
              <ul>
                {result.errors.map((e) => (
                  <li>{e}</li>
                ))}
              </ul>
            </div>
          )
        ) : null}
        <p class="muted">
          To check a file before serving it, POST it to <code>/api/v1/validate</code>.
        </p>
      </section>
    </Layout>
  );
}

const field = (name, label, attrs = {}, fields = {}) => (
  <label>
    {label}
    <input name={name} value={fields[name] ?? ''} {...attrs} />
  </label>
);

export function Serve({ fields = {}, doc, warnings }) {
  const vis = [].concat(fields.visibility ?? []);
  const bases = [].concat(fields.bases ?? []);
  return (
    <Layout title="Serve a disk" path="/serve">
      <section class="band narrow">
        <h1>Write a descriptor</h1>
        <p class="lead">
          Fill in what you know. Only a name, the free space and a price are required; everything
          else is read if stated. The result is the file to put at{' '}
          <code>/.well-known/opendisk.json</code>.
        </p>
        <form method="post" action="/serve" class="grid-form">
          {field('name', 'Name', { placeholder: 'spare drive, Lisbon', required: true }, fields)}
          {field(
            'free_gib',
            'Free GiB',
            { type: 'number', min: 0, step: 1, required: true, placeholder: '900' },
            fields,
          )}
          {field('total_gib', 'Total GiB', { type: 'number', min: 0, step: 1 }, fields)}
          {field(
            'per_gib_month',
            'Price per GiB-month',
            { type: 'number', min: 0, step: 0.001, required: true, placeholder: '0.08' },
            fields,
          )}
          {field('currency', 'Currency', { placeholder: 'USD', maxlength: 3 }, fields)}
          {field(
            'per_gib_transfer',
            'Price per GiB served',
            { type: 'number', min: 0, step: 0.001 },
            fields,
          )}
          {field('max_gib', 'Largest lease, GiB', { type: 'number', min: 0, step: 1 }, fields)}
          {field('max_days', 'Longest lease, days', { type: 'number', min: 1, step: 1 }, fields)}
          {field('country', 'Country (ISO code)', { placeholder: 'PT', maxlength: 2 }, fields)}
          {field('bandwidth_mbps', 'Bandwidth, Mbps', { type: 'number', min: 0 }, fields)}
          <label>
            Drive type
            <select name="storage_type">
              <option value="">unstated</option>
              {['nvme', 'ssd', 'hdd'].map((t) => (
                <option value={t} selected={fields.storage_type === t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          {field('size_gb', 'Drive size, GB', { type: 'number', min: 0 }, fields)}
          {field('web', 'Site', { type: 'url', placeholder: 'https://' }, fields)}
          {field(
            'operator',
            'Operator (OpenProfile.md URL)',
            { type: 'url', placeholder: 'https://you.example/.well-known/openprofile.md' },
            fields,
          )}
          {field('key', 'Seeder key', { placeholder: 'ed25519:…' }, fields)}
          {field(
            'hubs',
            'Hubs (space separated)',
            { placeholder: 'https://bittorrented.com/api/openswarm' },
            fields,
          )}
          {field('max_file_gib', 'Largest single swarm, GiB', { type: 'number', min: 0 }, fields)}
          {field(
            'proof_hours',
            'Shortest proof period, hours',
            { type: 'number', min: 1, placeholder: '6' },
            fields,
          )}
          <fieldset>
            <legend>Holds</legend>
            {['public', 'private', 'personal'].map((v) => (
              <label class="inline">
                <input type="checkbox" name="visibility" value={v} checked={vis.includes(v)} /> {v}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Bases</legend>
            {['own', 'licensed', 'open-license', 'public-domain', 'personal'].map((v) => (
              <label class="inline">
                <input type="checkbox" name="bases" value={v} checked={bases.includes(v)} /> {v}
              </label>
            ))}
          </fieldset>
          <label class="inline">
            <input type="checkbox" name="encrypted_only" checked={fields.encrypted_only === 'on'} />{' '}
            ciphertext only
          </label>
          <button type="submit" class="primary wide">
            Generate
          </button>
        </form>
        {doc ? (
          <div>
            <h2>Your descriptor</h2>
            <Warnings warnings={warnings} />
            <Pre>{JSON.stringify(doc, null, 2)}</Pre>
            <p>
              Save it as <code>/.well-known/opendisk.json</code> in your web root, served as{' '}
              <code>application/json</code>, then <a href="/submit">list it</a>.
            </p>
          </div>
        ) : null}
      </section>
    </Layout>
  );
}

export function Store({ stats }) {
  return (
    <Layout
      title="The store"
      path="/store"
      description="d1sks.com as an OpenObject store: buckets kept at three replicas on three operators in two countries, placed on listed disks."
    >
      <section class="band narrow">
        <p class="kicker">OpenObject reference store</p>
        <h1>A bucket you can mount, kept on these disks</h1>
        <p class="lead">
          <a href="https://logicsrc.com/openobject">OpenObject</a> is keyed objects, encrypted by
          their owner, placed on paid disks at a stated redundancy, verified every period, repaired
          when a disk fails, and read back by path. d1sks.com is the reference store, and the disks
          listed here are its pool.
        </p>
        <h2>Policies</h2>
        <table class="table">
          <thead>
            <tr>
              <th>Policy</th>
              <th>Means</th>
              <th>Floors</th>
              <th>Per GiB-month</th>
            </tr>
          </thead>
          <tbody>
            {POLICIES.map((p) => (
              <tr>
                <td class="mono">
                  {p.id}
                  {p.default ? ' (default)' : ''}
                </td>
                <td>
                  {p.mode === 'replicas'
                    ? `${p.replicas} holders, each with the whole object`
                    : `${p.k} data + ${p.parity} parity shards, any ${p.k} rebuild it`}
                </td>
                <td>
                  {p.min_operators} operators
                  {p.min_countries ? `, ${p.min_countries} countries` : ''}
                </td>
                <td>{fmtPrice(STORE_PRICE.per_gib_month[p.id])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p class="muted">
          Plus {fmtPrice(STORE_PRICE.per_gib_transfer)} per GiB served and{' '}
          {fmtPrice(STORE_PRICE.per_10k_ops)} per ten thousand index operations. A 3x price already
          covers three disks.
        </p>
        <h2>Status</h2>
        <p>
          The descriptor at{' '}
          <a href="/.well-known/openobject.json" class="mono">
            /.well-known/openobject.json
          </a>{' '}
          is live and the pool at{' '}
          <a href="/api/disks" class="mono">
            /api/disks
          </a>{' '}
          is every listed disk ({stats.active} today, {fmtGib(stats.free_gib)} free).{' '}
          <strong>Buckets are not open yet.</strong> The store API at <code>/openobject/v1</code>{' '}
          answers 501 on bucket routes until the first listed disks take <code>pay2seed</code>{' '}
          leases through this store; the spec is published so a client can be written against it
          now.
        </p>
        <h2>What a bucket is</h2>
        <ul class="plain">
          <li>An Ed25519 bucket key; the bucket is whoever holds the private half.</li>
          <li>
            An index that is an <code>ipdb</code> feed: one entry per revision, <code>seq</code> is
            the clock.
          </li>
          <li>
            One record per object: key as path, SHA-256 of the plaintext as ETag, holders with the
            last proof.
          </li>
          <li>
            Placement as one <code>pay2seed</code> offer per object onto distinct disks, operators
            and countries.
          </li>
          <li>
            Repair within 24 hours of a failed proof, from any healthy holder, on the bucket's
            escrow.
          </li>
          <li>
            A mount: keys are paths, the index is metadata, the swarm is data, close-to-open by{' '}
            <code>seq</code>.
          </li>
        </ul>
        <p class="muted">
          Full text: <a href="https://logicsrc.com/docs/openobject">logicsrc.com/docs/openobject</a>
          . The container that mounts a bucket:{' '}
          <a href="https://logicsrc.com/openslice">OpenSlice</a>.
        </p>
      </section>
    </Layout>
  );
}

export function ErrorPage({ status, message }) {
  return (
    <Layout title={String(status)} path="/">
      <section class="band narrow">
        <h1>{status}</h1>
        <p class="lead">{message}</p>
        <p>
          <a href="/">Home</a> · <a href="/disks">Disks</a>
        </p>
      </section>
    </Layout>
  );
}
