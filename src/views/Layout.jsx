import { config } from '../config.js';

export function Layout({ title, description, path = '/', children }) {
  const fullTitle = title ? `${title} · d1sks` : 'd1sks: the OpenDisk marketplace';
  const desc =
    description ??
    'Every disk that serves /.well-known/opendisk.json, listed by free GiB, price, country and policy. The OpenObject reference store: buckets kept at three replicas on three operators in two countries.';
  const nav = [
    ['/disks', 'Disks'],
    ['/store', 'Store'],
    ['/submit', 'List a disk'],
    ['/docs', 'Docs'],
    ['/api/v1', 'API'],
  ];
  const active = (href) => path === href || (href !== '/' && path.startsWith(`${href}/`));
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>{fullTitle}</title>
        <meta name="description" content={desc} />
        <meta name="color-scheme" content="dark" />
        <meta name="theme-color" content="#0c1116" />
        <link rel="canonical" href={`${config.siteUrl}${path}`} />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="/styles.css" />
        <link rel="llms" href="/llms.txt" />
        <link
          rel="alternate"
          type="application/json"
          href={`${config.siteUrl}/api/v1/disks`}
          title="Disks API"
        />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="d1sks" />
        <meta property="og:title" content={fullTitle} />
        <meta property="og:description" content={desc} />
        <meta property="og:url" content={`${config.siteUrl}${path}`} />
      </head>
      <body>
        <header class="top">
          <a class="brand" href="/" aria-label="d1sks home">
            <img src="/logo.svg" alt="" width="26" height="26" />
            <span>
              d<em>1</em>sks
            </span>
          </a>
          <nav aria-label="Primary">
            {nav.map(([href, label]) => (
              <a href={href} aria-current={active(href) ? 'page' : undefined}>
                {label}
              </a>
            ))}
          </nav>
        </header>
        <main id="main">{children}</main>
        <footer class="foot">
          <p>
            d1sks.com is the reference marketplace for{' '}
            <a href="https://logicsrc.com/opendisk">OpenDisk</a> and the reference store for{' '}
            <a href="https://logicsrc.com/openobject">OpenObject</a>, two LogicSRC specifications.
            Disk from here, compute from <a href="https://c0mpute.com">c0mpute.com</a>, the pair
            from slic3s.com. Source on{' '}
            <a href="https://github.com/profullstack/d1sks.com">GitHub</a>, MIT. By{' '}
            <a href="https://profullstack.com">Profullstack, Inc.</a>
          </p>
          <p class="mono">
            <a href="/llms.txt">llms.txt</a> ·{' '}
            <a href="/.well-known/openobject.json">openobject.json</a> ·{' '}
            <a href="/.well-known/openserver.json">openserver.json</a> ·{' '}
            <a href="/api/disks">pool</a>
          </p>
        </footer>
      </body>
    </html>
  );
}
