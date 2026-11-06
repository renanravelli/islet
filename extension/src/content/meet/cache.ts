// A small cache whose entries expire a fixed time after they were stored. Reading an entry never
// extends it: the adapter reads many times a second, and an entry renewed on every read would
// never expire. Expiry is checked on read, so no timer runs (Chrome throttles them in a hidden
// tab).

export class TtlCache<K, V> {
  private readonly entries = new Map<K, { value: V; expires: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (this.now() >= entry.expires) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    this.entries.set(key, { value, expires: this.now() + this.ttlMs });
  }

  delete(key: K): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
