import { config } from '../config.js';
import { footerHtmlSync } from '@profullstack/footer';

const footerLinks = [
  { label: 'OpenDisk', href: 'https://logicsrc.com/opendisk' },
  { label: 'OpenObject', href: 'https://logicsrc.com/openobject' },
  { label: 'Compute', href: 'https://c0mpute.com' },
  { label: 'Pair', href: 'https://slic3s.com' },
  { label: 'GitHub', href: 'https://github.com/profullstack/d1sks.com' },
  { label: 'Profullstack', href: 'https://profullstack.com' },
  { label: 'llms.txt', href: '/llms.txt' },
  { label: 'openobject.json', href: '/.well-known/openobject.json' },
  { label: 'openserver.json', href: '/.well-known/openserver.json' },
  { label: 'Pool API', href: '/api/disks' },
];
const footerOptions = { site: 'https://d1sks.com/', tagline: 'MIT licensed', links: footerLinks };
const footer = `<div data-profullstack-footer data-site="${footerOptions.site}" data-tagline="${footerOptions.tagline}" data-links='${JSON.stringify(footerLinks)}'>${footerHtmlSync(footerOptions)}</div><script type="module" src="https://cdn.jsdelivr.net/npm/@profullstack/footer@latest/src/embed.js"></script>`;

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
        <div dangerouslySetInnerHTML={{ __html: footer }} />
      </body>
    </html>
  );
}
