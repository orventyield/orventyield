/** Persistence contract for the verification service, with an in-memory implementation (tests and the Playground). */
export interface SessionRow {
  nonce: string;
  phoneHash: string;
  owner: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  used: boolean;
}

export interface CardRow {
  phoneHash: string;
  owner: string;
  activatedAt: number;
}

export type InsertCardResult = "ok" | "phone_taken" | "owner_taken";
export type EventKind = "start_ip" | "start_phone" | "check_phone" | "sms_global";

export interface VerifyStore {
  getCardByOwner(owner: string): Promise<CardRow | null>;
  getCardByPhone(phoneHash: string): Promise<CardRow | null>;
  /** Must be atomic: two concurrent claims of the same phone (or owner) cannot both succeed. */
  insertCard(row: CardRow): Promise<InsertCardResult>;
  createSession(row: SessionRow): Promise<void>;
  getSession(nonce: string): Promise<SessionRow | null>;
  /** Returns the new attempt count. */
  incrementAttempts(nonce: string): Promise<number>;
  markSessionUsed(nonce: string): Promise<void>;
  recordEvent(kind: EventKind, key: string, at: number): Promise<void>;
  countEvents(kind: EventKind, key: string, since: number): Promise<number>;
  /** Timestamps of events in the window, oldest first (to compute Retry-After). */
  eventsSince(kind: EventKind, key: string, since: number): Promise<number[]>;
  prune(before: number): Promise<void>;
}

export class MemoryStore implements VerifyStore {
  private cardsByPhone = new Map<string, CardRow>();
  private cardsByOwner = new Map<string, CardRow>();
  private sessions = new Map<string, SessionRow>();
  private events: { kind: EventKind; key: string; at: number }[] = [];

  async getCardByOwner(owner: string) {
    return this.cardsByOwner.get(owner) ?? null;
  }
  async getCardByPhone(phoneHash: string) {
    return this.cardsByPhone.get(phoneHash) ?? null;
  }
  async insertCard(row: CardRow): Promise<InsertCardResult> {
    if (this.cardsByPhone.has(row.phoneHash)) return "phone_taken";
    if (this.cardsByOwner.has(row.owner)) return "owner_taken";
    this.cardsByPhone.set(row.phoneHash, row);
    this.cardsByOwner.set(row.owner, row);
    return "ok";
  }
  async createSession(row: SessionRow) {
    this.sessions.set(row.nonce, { ...row });
  }
  async getSession(nonce: string) {
    const s = this.sessions.get(nonce);
    return s ? { ...s } : null;
  }
  async incrementAttempts(nonce: string) {
    const s = this.sessions.get(nonce);
    if (!s) return 0;
    s.attempts += 1;
    return s.attempts;
  }
  async markSessionUsed(nonce: string) {
    const s = this.sessions.get(nonce);
    if (s) s.used = true;
  }
  async recordEvent(kind: EventKind, key: string, at: number) {
    this.events.push({ kind, key, at });
  }
  async countEvents(kind: EventKind, key: string, since: number) {
    return this.events.filter((e) => e.kind === kind && e.key === key && e.at >= since).length;
  }
  async eventsSince(kind: EventKind, key: string, since: number) {
    return this.events.filter((e) => e.kind === kind && e.key === key && e.at >= since).map((e) => e.at).sort((a, b) => a - b);
  }
  async prune(before: number) {
    this.events = this.events.filter((e) => e.at >= before);
    for (const [k, s] of this.sessions) if (s.expiresAt < before) this.sessions.delete(k);
  }
  /** Snapshot for persisting the Playground registry. */
  exportCards(): CardRow[] {
    return [...this.cardsByPhone.values()];
  }
  importCards(rows: CardRow[]) {
    for (const r of rows) void this.insertCard(r);
  }
}
