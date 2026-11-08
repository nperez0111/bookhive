const MAX_CACHE_TTL_MS = 10 * 60 * 1000;
const MIN_CACHE_TTL_MS = 10_000;
const TOKEN_EXPIRY_BUFFER_MS = 60_000;
const SESSION_SAVE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** In-memory clients only: eviction must never delete durable OAuth grants. */
export class SessionCache<T> {
  private readonly entries = new Map<
    string,
    { client: T; expiresAt: number; lastSaveAt: number }
  >();
  private expired = 0;
  private evicted = 0;

  constructor(
    private readonly capacity = 1_000,
    private readonly now = Date.now,
  ) {}

  get(key: string): { client: T; needsSave: boolean } | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (this.now() >= entry.expiresAt) {
      this.entries.delete(key);
      this.expired++;
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return {
      client: entry.client,
      needsSave: this.now() - entry.lastSaveAt > SESSION_SAVE_INTERVAL_MS,
    };
  }

  set(key: string, client: T, tokenExpiresAt: number | undefined): void {
    const now = this.now();
    this.prune();
    const ttl = tokenExpiresAt
      ? Math.max(
          MIN_CACHE_TTL_MS,
          Math.min(tokenExpiresAt - now - TOKEN_EXPIRY_BUFFER_MS, MAX_CACHE_TTL_MS),
        )
      : MAX_CACHE_TTL_MS;
    this.entries.delete(key);
    this.entries.set(key, { client, expiresAt: now + ttl, lastSaveAt: now });
    while (this.entries.size > this.capacity) {
      this.entries.delete(this.entries.keys().next().value!);
      this.evicted++;
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  markSaved(key: string): void {
    const entry = this.entries.get(key);
    if (entry) entry.lastSaveAt = this.now();
  }

  prune(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (now >= entry.expiresAt) {
        this.entries.delete(key);
        this.expired++;
      }
    }
  }

  stats() {
    return {
      entries: this.entries.size,
      capacity: this.capacity,
      expired: this.expired,
      evicted: this.evicted,
    };
  }
}
