/**
 * A synchronous single-flight lock for wallet actions. React state (`busy`) only updates after a re-render, so a fast double
 * click or two taps can both pass a `if (busy) return` check; this flips immediately, so the second call is refused before it
 * can open a second wallet prompt or send a duplicate transaction.
 */
export interface TxLock {
  /** True if the caller now holds the lock; false if another action is already in flight. */
  tryAcquire(): boolean;
  release(): void;
  readonly held: boolean;
}

export function createTxLock(): TxLock {
  let held = false;
  return {
    tryAcquire() {
      if (held) return false;
      held = true;
      return true;
    },
    release() {
      held = false;
    },
    get held() {
      return held;
    },
  };
}
