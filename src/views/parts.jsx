export const flag = (code) =>
  /^[A-Z]{2}$/.test(code)
    ? String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
    : '';

export const fmtGib = (n) => {
  if (n === null || n === undefined) return 'n/a';
  if (n >= 1024) return `${(n / 1024).toFixed(n >= 10240 ? 0 : 1)} TiB`;
  return `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 })} GiB`;
};

export const fmtPrice = (amount, currency = 'USD') => {
  if (amount === null || amount === undefined) return 'n/a';
  const sym =
    currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : `${currency} `;
  return `${sym}${Number(amount).toFixed(amount < 0.1 ? 3 : 2)}`;
};

export const ago = (t) => {
  if (!t) return 'never';
  const s = (Date.now() - new Date(t).getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};

export function Stat({ label, value }) {
  return (
    <div class="stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export function DiskRow({ d }) {
  return (
    <a class="row" href={`/disks/${encodeURIComponent(d.id)}`}>
      <div class="row-main">
        <strong>{d.name}</strong>
        <span class="muted mono">{new URL(d.origin).host}</span>
        {d.status === 'gone' ? <span class="badge gone">gone</span> : null}
      </div>
      <div class="row-meta">
        <span title="Free">{fmtGib(d.free_gib)} free</span>
        <span title="Price per GiB-month">
          {fmtPrice(d.per_gib_month, d.currency)}
          <small>/GiB·mo</small>
        </span>
        <span title="Country">
          {d.countries.length ? d.countries.map((c) => `${flag(c)} ${c}`).join(' ') : 'unstated'}
        </span>
        <span title="Policy">
          {d.encrypted_only
            ? 'ciphertext only'
            : d.visibility.length
              ? d.visibility.join(', ')
              : 'policy unstated'}
        </span>
        <span title="Hub standing">
          {d.standing === null ? 'standing unstated' : `standing ${d.standing}`}
        </span>
      </div>
    </a>
  );
}

export function Pre({ children }) {
  return <pre class="code">{children}</pre>;
}

export function Warnings({ warnings }) {
  if (!warnings?.length) return null;
  return (
    <div class="warn">
      <strong>Read, with reservations:</strong>
      <ul>
        {warnings.map((w) => (
          <li>{w}</li>
        ))}
      </ul>
    </div>
  );
}
