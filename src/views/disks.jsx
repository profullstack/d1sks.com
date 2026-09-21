import { config } from '../config.js';
import { Layout } from './Layout.jsx';
import { ago, DiskRow, flag, fmtGib, fmtPrice, Pre, Warnings } from './parts.jsx';

const SORTS = [
  ['price', 'Cheapest'],
  ['free', 'Most free'],
  ['standing', 'Best standing'],
  ['updated', 'Recently updated'],
  ['name', 'Name'],
];

export function Disks({ result, page, params }) {
  const qs = (extra) => {
    const u = new URLSearchParams({ ...params, ...extra });
    for (const [k, v] of [...u]) if (v === '' || v === undefined) u.delete(k);
    return `/disks?${u}`;
  };
  const pages = Math.max(1, Math.ceil(result.total / result.limit));
  const json = `${config.siteUrl}/api/v1/disks?${new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([k, v]) => v && k !== 'page')),
  )}`;
  return (
    <Layout title="Disks" path="/disks">
      <section class="band">
        <h1>Disks</h1>
        <p class="lead">
          {result.total} {result.total === 1 ? 'disk' : 'disks'} listed. Each one serves its own{' '}
          <code>/.well-known/opendisk.json</code>; this page is what those files say, refetched
          hourly.
        </p>
        <form class="filters" method="get" action="/disks">
          <label>
            Country
            <select name="country">
              <option value="">any</option>
              {result.facets.countries.map((c) => (
                <option value={c.country} selected={params.country === c.country}>
                  {flag(c.country)} {c.country} ({c.n})
                </option>
              ))}
            </select>
          </label>
          <label>
            At least
            <input
              type="number"
              name="min_gib"
              min="0"
              step="1"
              placeholder="GiB free"
              value={params.min_gib ?? ''}
            />
          </label>
          <label>
            Up to
            <input
              type="number"
              name="max_price"
              min="0"
              step="0.001"
              placeholder="per GiB-month"
              value={params.max_price ?? ''}
            />
          </label>
          <label>
            Holds
            <select name="visibility">
              <option value="">anything</option>
              {['public', 'private', 'personal'].map((v) => (
                <option value={v} selected={params.visibility === v}>
                  {v} swarms
                </option>
              ))}
            </select>
          </label>
          <label>
            Ciphertext
            <select name="encrypted">
              <option value="">either</option>
              <option value="1" selected={params.encrypted === '1'}>
                only
              </option>
              <option value="0" selected={params.encrypted === '0'}>
                not required
              </option>
            </select>
          </label>
          <label>
            Sort
            <select name="sort">
              {SORTS.map(([v, l]) => (
                <option value={v} selected={result.sort === v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Show
            <select name="status">
              <option value="">active</option>
              <option value="gone" selected={params.status === 'gone'}>
                gone
              </option>
              <option value="all" selected={params.status === 'all'}>
                all
              </option>
            </select>
          </label>
          <button type="submit">Filter</button>
        </form>
      </section>
      <section class="band">
        {result.disks.length ? (
          <div class="rows">
            {result.disks.map((d) => (
              <DiskRow d={d} />
            ))}
          </div>
        ) : (
          <div class="empty">
            <p>
              No disk matches.{' '}
              {result.total === 0 && !Object.keys(params).length
                ? 'Nobody has listed one yet.'
                : ''}
            </p>
            <p>
              Have a spare drive? <a href="/serve">Write its descriptor</a>, put it at{' '}
              <code>/.well-known/opendisk.json</code>, then <a href="/submit">list it</a>.
            </p>
          </div>
        )}
        {pages > 1 ? (
          <nav class="pager" aria-label="Pages">
            {page > 1 ? <a href={qs({ page: page - 1 })}>Previous</a> : <span />}
            <span>
              Page {page} of {pages}
            </span>
            {page < pages ? <a href={qs({ page: page + 1 })}>Next</a> : <span />}
          </nav>
        ) : null}
      </section>
      <section class="band agent">
        <h2>As data</h2>
        <Pre>{`curl -s '${json}' -H 'accept: application/json'`}</Pre>
        <p class="muted">
          Same rows, same parameters. The <a href="/api/disks">pool</a> is every descriptor as
          fetched.
        </p>
      </section>
    </Layout>
  );
}

export function Disk({ disk: d, offer, notice }) {
  const raw = d.data;
  const host = new URL(d.origin).host;
  return (
    <Layout
      title={d.name}
      path={`/disks/${encodeURIComponent(d.id)}`}
      description={`${d.name}: ${fmtGib(d.free_gib)} free at ${fmtPrice(d.per_gib_month, d.currency)} per GiB-month.`}
    >
      {notice === 'listed' ? (
        <p class="notice">
          Listed. This page is what the descriptor says; it is refetched every hour.
        </p>
      ) : null}
      <section class="band">
        <p class="kicker">
          <span class="mono">{host}</span>
          {d.status === 'gone' ? (
            <span class="badge gone">gone since {ago(d.gone_since)}</span>
          ) : (
            <span class="badge ok">active</span>
          )}
        </p>
        <h1>{d.name}</h1>
        <div class="stats">
          <div class="stat">
            <strong>{fmtGib(d.free_gib)}</strong>
            <span>free{d.total_gib ? ` of ${fmtGib(d.total_gib)}` : ''}</span>
          </div>
          <div class="stat">
            <strong>
              {fmtPrice(d.per_gib_month, d.currency)}
              <small>/GiB·mo</small>
            </strong>
            <span>
              {raw.price?.per_gib_transfer
                ? `+ ${fmtPrice(raw.price.per_gib_transfer, d.currency)}/GiB served`
                : 'serving included'}
            </span>
          </div>
          <div class="stat">
            <strong>
              {d.countries.length
                ? d.countries.map((c) => `${flag(c)} ${c}`).join(' ')
                : 'unstated'}
            </strong>
            <span>{d.regions.length ? d.regions.join(', ') : 'location'}</span>
          </div>
          <div class="stat">
            <strong>{d.standing === null ? 'unstated' : d.standing}</strong>
            <span>hub standing{d.data.record?.source ? ' (as copied)' : ''}</span>
          </div>
        </div>
        <Warnings warnings={d.warnings} />
      </section>

      <section class="band two">
        <div>
          <h2>Policy</h2>
          <dl class="kv">
            <dt>Holds</dt>
            <dd>{d.visibility.length ? d.visibility.join(', ') : 'unstated'}</dd>
            <dt>Bases</dt>
            <dd>{d.bases.length ? d.bases.join(', ') : 'unstated'}</dd>
            <dt>Ciphertext only</dt>
            <dd>{d.encrypted_only === null ? 'unstated' : d.encrypted_only ? 'yes' : 'no'}</dd>
            <dt>Max file</dt>
            <dd>{raw.accepts?.max_file_gib ? fmtGib(raw.accepts.max_file_gib) : 'unstated'}</dd>
            <dt>Lease</dt>
            <dd>
              {raw.price?.min_gib ?? '?'} to {raw.price?.max_gib ?? '?'} GiB,{' '}
              {raw.price?.min_days ?? '?'} to {raw.price?.max_days ?? '?'} days
            </dd>
            <dt>Proof</dt>
            <dd>
              {raw.proof?.kinds?.length ? raw.proof.kinds.join(' + ') : 'unstated'}
              {d.proof_hours ? `, every ${d.proof_hours} h at least` : ''}
            </dd>
          </dl>
        </div>
        <div>
          <h2>Identity</h2>
          <dl class="kv">
            <dt>Seeder key</dt>
            <dd class="mono">{d.key ?? 'none (deduped on origin)'}</dd>
            <dt>Operator</dt>
            <dd>{d.operator ? <a href={d.operator}>{d.operator}</a> : 'unstated'}</dd>
            <dt>Site</dt>
            <dd>{d.web ? <a href={d.web}>{d.web}</a> : 'none beyond the descriptor'}</dd>
            <dt>Hubs</dt>
            <dd>
              {d.hubs.length
                ? d.hubs.map((h) => <div class="mono">{h}</div>)
                : 'none; rented some other way'}
            </dd>
            <dt>Record</dt>
            <dd>
              {raw.record?.source ? (
                <a href={raw.record.source} class="mono">
                  {raw.record.source}
                </a>
              ) : (
                'no hub record'
              )}
            </dd>
            <dt>Holding</dt>
            <dd>
              {typeof raw.holding === 'string' ? (
                <a href={raw.holding} class="mono">
                  {raw.holding}
                </a>
              ) : raw.holding ? (
                'inline'
              ) : (
                'unstated'
              )}
            </dd>
            <dt>Descriptor</dt>
            <dd>
              <a href={d.url} class="mono">
                {d.url}
              </a>
              <div class="muted">
                fetched {ago(d.fetched_at)}
                {d.descriptor_updated_at
                  ? `, updated by the disk ${ago(d.descriptor_updated_at)}`
                  : ''}
                {d.last_error ? `; last error: ${d.last_error}` : ''}
              </div>
            </dd>
          </dl>
        </div>
      </section>

      <section class="band">
        <h2>Renting it</h2>
        <ol class="steps">
          <li>
            Check the policy above against what you want kept, and the hub record for standing.
          </li>
          <li>
            Make the attestation <a href="https://logicsrc.com/docs/openswarm">pay2seed</a>{' '}
            requires.
          </li>
          <li>
            Post a <code>pay2seed.offer</code> at one of the disk's hubs, at or above{' '}
            {fmtPrice(d.per_gib_month, d.currency)} per GiB-month, with the budget escrowed.
          </li>
          <li>
            The seeder takes the lease on its next poll; proofs, receipts and payout are paid2seed,
            unchanged.
          </li>
        </ol>
        <p class="muted">
          d1sks.com does not run a hub yet, so the offer is posted at the disk's own hub. When
          buckets open here, the <a href="/store">store</a> does these four steps for you.
        </p>
      </section>

      <section class="band two">
        <div>
          <h2>The descriptor</h2>
          <Pre>{JSON.stringify(raw, null, 2)}</Pre>
        </div>
        <div>
          <h2>As an OpenServer offer</h2>
          <Pre>{JSON.stringify(offer, null, 2)}</Pre>
          <p class="muted">
            <a href={`/disks/${encodeURIComponent(d.id)}/openserver.json`} class="mono">
              openserver.json
            </a>{' '}
            ·{' '}
            <a href={`/api/v1/disks/${encodeURIComponent(d.id)}`} class="mono">
              api
            </a>
          </p>
        </div>
      </section>
    </Layout>
  );
}
