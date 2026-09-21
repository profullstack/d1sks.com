import { config } from './config.js';
import * as disks from './disks.js';

/**
 * The marketplace rule: fetch on a schedule because free_gib moves, skip a
 * descriptor whose ETag has not changed, mark a disk gone (never deleted) when
 * it has stopped answering for a day.
 */
export async function pollOnce({ log = console.log } = {}) {
  const batch = await disks.due();
  let ok = 0;
  let same = 0;
  let bad = 0;
  for (const d of batch) {
    try {
      const r = await disks.fetchAndStore(d.url, d.origin, { etag: d.etag });
      if (r.notModified) {
        await disks.touch(d.id);
        same++;
      } else ok++;
    } catch (err) {
      bad++;
      await disks.failed(d.id, err?.message ?? String(err));
    }
  }
  if (batch.length)
    log(`[poll] ${batch.length} due: ${ok} refreshed, ${same} unchanged, ${bad} failed`);
  return { due: batch.length, ok, same, bad };
}

export function startPoller({ log = console.log } = {}) {
  let timer = null;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await pollOnce({ log });
    } catch (err) {
      log(`[poll] pass failed: ${err?.message ?? err}`);
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, config.poll.minutes * 60_000);
  setTimeout(tick, 5_000);
  return {
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
