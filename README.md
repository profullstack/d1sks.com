# d1sks.com

**The OpenDisk marketplace, and the OpenObject reference store.** Every disk that serves `/.well-known/opendisk.json` (free GiB, price per GiB-month, country, policy, proof cadence, hub standing) is listed here, refetched hourly, marked gone rather than deleted. The store descriptor says how [OpenObject](https://logicsrc.com/openobject) buckets are kept at three replicas on three operators in two countries, placed on the disks listed.

Disk from here, compute from [c0mpute.com](https://c0mpute.com), the pair from slic3s.com.

```
curl -s 'https://d1sks.com/api/v1/disks?country=DE&min_gib=500&sort=price' -H 'accept: application/json'
curl -s -X POST https://d1sks.com/api/v1/disks -H 'content-type: application/json' -d '{"url":"https://your-disk.example"}'
curl -s https://d1sks.com/.well-known/openobject.json
```

## What is in the box

| Surface | Where |
| --- | --- |
| Web, mobile first, no client JavaScript | `src/views` (Bun + Hono JSX, no build step) |
| JSON API | `/api/v1/*`, documented at `/docs` and `/llms.txt` |
| OpenDisk marketplace | `/disks`, `/submit`, `/validate`, `/serve` (descriptor generator) |
| OpenObject store descriptor | `/.well-known/openobject.json`, pool at `/api/disks`, API root at `/openobject/v1` (buckets answer 501 until they open) |
| OpenServer descriptor | `/.well-known/openserver.json`, and every disk at `/disks/<id>/openserver.json` |

## Run it

```
cp .env.example .env           # DATABASE_URL, SITE_URL
bun install
bun run dev                    # http://localhost:3000, migrates on boot
bun test                       # needs DATABASE_URL; the api test serves its own descriptor on localhost
```

`ROLES=web,worker` runs both the site and the poller in one process; split them across two services with `ROLES=web` and `ROLES=worker`.

## How a disk is read

1. `POST /api/v1/disks {"url": "https://origin"}` or the form: the origin's `/.well-known/opendisk.json` is fetched (https only, public addresses only, 256 KiB, ten seconds, three redirects).
2. Validated against [OpenDisk 0.1](https://logicsrc.com/docs/opendisk): `name`, `capacity.free_gib` and `price.per_gib_month` are required; everything else is read if stated, warned about if malformed, kept if unknown.
3. Deduped on the seeder `key`, or the origin when there is none. Stored with the raw document beside the columns the list filters on.
4. Refetched every hour by the worker with `If-None-Match`; three failures start a clock, a day on the clock marks the disk `gone`. The row is never deleted.

## Specs

- [OpenDisk](https://logicsrc.com/docs/opendisk): the descriptor this site reads.
- [OpenObject](https://logicsrc.com/docs/openobject): the store this site is the reference for.
- [OpenServer](https://logicsrc.com/docs/openserver): the offer every disk maps onto.
- [OpenSwarm](https://logicsrc.com/openswarm): `pay2seed` and `paid2seed`, the offer and the lease a requester posts at the disk's hub.

MIT. Profullstack, Inc.
