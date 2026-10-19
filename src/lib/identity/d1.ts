import type { CardRow, EventKind, InsertCardResult, SessionRow, VerifyStore } from "./store";

/** The subset of Cloudflare D1's API we use, so the same SQL also runs against SQLite in tests. */
export interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
      first<T = Record<string, unknown>>(): Promise<T | null>;
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
    };
  };
}

/** SQL store. UNIQUE constraints on cards(phone_hash) and cards(owner) make 1U1C atomic. See worker/migrations. */
export class D1Store implements VerifyStore {
  constructor(private db: D1Like) {}

  async getCardByOwner(owner: string): Promise<CardRow | null> {
    const r = await this.db.prepare("SELECT phone_hash, owner, activated_at FROM cards WHERE owner = ?").bind(owner).first<{ phone_hash: string; owner: string; activated_at: number }>();
    return r ? { phoneHash: r.phone_hash, owner: r.owner, activatedAt: r.activated_at } : null;
  }

  async getCardByPhone(phoneHash: string): Promise<CardRow | null> {
    const r = await this.db.prepare("SELECT phone_hash, owner, activated_at FROM cards WHERE phone_hash = ?").bind(phoneHash).first<{ phone_hash: string; owner: string; activated_at: number }>();
    return r ? { phoneHash: r.phone_hash, owner: r.owner, activatedAt: r.activated_at } : null;
  }

  async insertCard(row: CardRow): Promise<InsertCardResult> {
    try {
      await this.db.prepare("INSERT INTO cards (phone_hash, owner, activated_at) VALUES (?, ?, ?)").bind(row.phoneHash, row.owner, row.activatedAt).run();
      return "ok";
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (/UNIQUE|constraint/i.test(msg)) return /cards\.owner/i.test(msg) ? "owner_taken" : "phone_taken";
      throw e;
    }
  }

  async createSession(r: SessionRow) {
    await this.db
      .prepare("INSERT INTO otp_sessions (nonce, phone_hash, owner, created_at, expires_at, attempts, used) VALUES (?, ?, ?, ?, ?, 0, 0)")
      .bind(r.nonce, r.phoneHash, r.owner, r.createdAt, r.expiresAt)
      .run();
  }

  async getSession(nonce: string): Promise<SessionRow | null> {
    const r = await this.db
      .prepare("SELECT nonce, phone_hash, owner, created_at, expires_at, attempts, used FROM otp_sessions WHERE nonce = ?")
      .bind(nonce)
      .first<{ nonce: string; phone_hash: string; owner: string; created_at: number; expires_at: number; attempts: number; used: number }>();
    return r ? { nonce: r.nonce, phoneHash: r.phone_hash, owner: r.owner, createdAt: r.created_at, expiresAt: r.expires_at, attempts: r.attempts, used: r.used === 1 } : null;
  }

  async incrementAttempts(nonce: string) {
    await this.db.prepare("UPDATE otp_sessions SET attempts = attempts + 1 WHERE nonce = ?").bind(nonce).run();
    const r = await this.db.prepare("SELECT attempts FROM otp_sessions WHERE nonce = ?").bind(nonce).first<{ attempts: number }>();
    return r?.attempts ?? 0;
  }

  async markSessionUsed(nonce: string) {
    await this.db.prepare("UPDATE otp_sessions SET used = 1 WHERE nonce = ?").bind(nonce).run();
  }

  async recordEvent(kind: EventKind, key: string, at: number) {
    await this.db.prepare("INSERT INTO events (kind, key, at) VALUES (?, ?, ?)").bind(kind, key, at).run();
  }

  async countEvents(kind: EventKind, key: string, since: number) {
    const r = await this.db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = ? AND key = ? AND at >= ?").bind(kind, key, since).first<{ n: number }>();
    return r?.n ?? 0;
  }

  async eventsSince(kind: EventKind, key: string, since: number) {
    const r = await this.db.prepare("SELECT at FROM events WHERE kind = ? AND key = ? AND at >= ? ORDER BY at ASC").bind(kind, key, since).all<{ at: number }>();
    return r.results.map((x) => x.at);
  }

  async prune(before: number) {
    await this.db.prepare("DELETE FROM events WHERE at < ?").bind(before).run();
    await this.db.prepare("DELETE FROM otp_sessions WHERE expires_at < ?").bind(before).run();
  }
}
