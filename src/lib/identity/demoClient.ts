/**
 * In-browser demo verifier: the SAME VerificationService with an in-memory store and a fixed test code.
 * Loaded on demand (it carries the phone-number metadata), and only used when no verification API is configured.
 */
import { ClientError, DEMO_CODE, type CheckParams, type IdentityClient } from "./client";
import { MockOtpProvider } from "./otp";
import { DEFAULT_CONFIG, VerificationService, VerifyError } from "./service";
import { MemoryStore, type CardRow } from "./store";

const CARDS_KEY = "oy.demo.cards";
const PEPPER_KEY = "oy.demo.pepper";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  } catch {
    /* storage unavailable: the demo registry just lasts for this page */
  }
}

export class DemoIdentityClient implements IdentityClient {
  readonly mode = "demo" as const;
  private store = new MemoryStore();
  private svc: VerificationService;

  constructor() {
    this.store.importCards(load<CardRow[]>(CARDS_KEY, []));
    let pepper = "";
    try {
      pepper = window.localStorage.getItem(PEPPER_KEY) ?? "";
    } catch {
      /* ignore */
    }
    if (!pepper) {
      pepper = crypto.randomUUID() + crypto.randomUUID();
      save(PEPPER_KEY, pepper);
    }
    this.svc = new VerificationService({
      store: this.store,
      otp: new MockOtpProvider({ fixedCode: DEMO_CODE }),
      config: { ...DEFAULT_CONFIG, pepper, requireWalletSignature: false },
    });
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof VerifyError) throw new ClientError(e.code, e.message, e.extra.retryAfterSec, e.extra.attemptsLeft);
      throw e;
    }
  }

  async status(owner: string) {
    return (await this.run(() => this.svc.status(owner))).active;
  }
  start(phone: string, owner: string) {
    return this.run(() => this.svc.start({ phone, owner, ip: "demo" }));
  }
  async check(p: CheckParams) {
    const r = await this.run(() => this.svc.check({ ...p, ip: "demo" }));
    save(CARDS_KEY, this.store.exportCards());
    return r;
  }
}
