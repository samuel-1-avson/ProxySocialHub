export type Loaded = { status: number; body: unknown; ttlMs: number };
export type Served = { status: number; body: unknown; source: "hit" | "miss" | "shared" };

/**
 * A small in-process cache for upstream answers, keyed by the validated upstream path.
 * Visitors share one API caller, so concurrent requests for the same record are joined into
 * one upstream call, and a fresh answer is reused for its ttl. A ttl of 0 is never stored.
 * Entries are bounded; the oldest is dropped first.
 */
export function createPublicCache(maxEntries = 500, now: () => number = Date.now) {
  const entries = new Map<string, Loaded & { expires: number }>();
  const inflight = new Map<string, Promise<Loaded>>();
  const remember = (key: string, loaded: Loaded) => {
    entries.delete(key);
    entries.set(key, { ...loaded, expires: now() + loaded.ttlMs });
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      entries.delete(oldest.value);
    }
  };
  return async function serve(
    key: string,
    load: () => Promise<Loaded>,
  ): Promise<Served> {
    const hit = entries.get(key);
    if (hit) {
      if (hit.expires > now())
        return { status: hit.status, body: hit.body, source: "hit" };
      entries.delete(key);
    }
    const pending = inflight.get(key);
    if (pending) {
      const shared = await pending;
      return { status: shared.status, body: shared.body, source: "shared" };
    }
    const run = (async () => {
      try {
        const loaded = await load();
        if (loaded.ttlMs > 0) remember(key, loaded);
        return loaded;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, run);
    const loaded = await run;
    return { status: loaded.status, body: loaded.body, source: "miss" };
  };
}
