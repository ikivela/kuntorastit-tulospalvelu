// In-memory brute-force protection for password checks (login and password
// change): too many failures from one client IP within the window blocks
// further attempts until the oldest failure expires. Single API instance, so
// process memory is enough.

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACKED_CLIENTS = 10_000;

export class LoginRateLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Milliseconds until the client may try again, or 0 if allowed. */
  retryAfterMs(client: string): number {
    const recent = this.recent(client);
    return recent.length >= MAX_FAILURES ? recent[0] + WINDOW_MS - this.now() : 0;
  }

  recordFailure(client: string) {
    if (this.failures.size >= MAX_TRACKED_CLIENTS) this.prune();
    this.failures.set(client, [...this.recent(client), this.now()]);
  }

  recordSuccess(client: string) {
    this.failures.delete(client);
  }

  private recent(client: string): number[] {
    const cutoff = this.now() - WINDOW_MS;
    return (this.failures.get(client) ?? []).filter((time) => time > cutoff);
  }

  private prune() {
    for (const client of this.failures.keys()) {
      if (this.recent(client).length === 0) this.failures.delete(client);
    }
    // Still full (e.g. a spray from many addresses): drop the oldest entries.
    for (const client of this.failures.keys()) {
      if (this.failures.size < MAX_TRACKED_CLIENTS) break;
      this.failures.delete(client);
    }
  }
}
