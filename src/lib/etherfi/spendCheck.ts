/**
 * Card-spend pre-check against the live Ether.fi contracts, with a fallback to our spend engine.
 *
 * Ether.fi authorizes a card spend by calling `CashLens`-style checks (spending limits, mode, borrowing power).
 * `canSpendSingleToken` exposes that exact verdict as a view call, so we ask the contract first. If the RPC is
 * unreachable or slow, the verified engine decides from the last live snapshot and the result says so.
 */
import { keccak256, toHex, type Address, type PublicClient } from "viem";
import { authorizeCardSpend, type AccountState, type DeclineCode, type Funding } from "@/utils/engine";
import { verifiedAddress } from "../contracts/etherfi";
import { CASH_MODE, cashLensAbi } from "./abi";

export const CASH_CHAIN = 10;
export const ON_CHAIN_TIMEOUT_MS = 4000;

export type VerdictSource = "on-chain" | "engine-fallback";

export interface SpendVerdict {
  ok: boolean;
  /** Terminal text on decline, e.g. "DAILY AVAILABLE SPENDING LIMIT LESS THAN AMOUNT REQUESTED". */
  reason: string;
  source: VerdictSource;
  mode: "credit" | "debit" | null;
  latencyMs: number;
  /** Spend funding when the engine produced the verdict. */
  funding?: Funding;
  code?: DeclineCode;
}

const usd6 = (usd: number) => BigInt(Math.round(usd * 1e6));

/** Resolve with the on-chain verdict, or reject on error/timeout. */
async function askContract(client: PublicClient, safe: Address, amountUsd: number, txSeed: string) {
  const lens = verifiedAddress(CASH_CHAIN, "CashLens");
  const usdc = verifiedAddress(CASH_CHAIN, "USDC");
  if (!lens || !usdc) throw new Error("Ether.fi registry entries missing");
  const call = client.readContract({
    address: lens,
    abi: cashLensAbi,
    functionName: "canSpendSingleToken",
    // Credit mode borrows USDC; debit mode may draw on USDC first (the contract checks balances itself).
    args: [safe, keccak256(toHex(txSeed)), [usdc], [usdc], usd6(amountUsd)],
  });
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error("on-chain check timed out")), ON_CHAIN_TIMEOUT_MS);
  });
  try {
    return await Promise.race([call, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export async function checkSpend(opts: {
  client: PublicClient | undefined;
  safe: Address;
  amountUsd: number;
  /** Used when the contract cannot be reached. */
  fallbackAccount: AccountState;
  txSeed: string;
}): Promise<SpendVerdict> {
  const t0 = performance.now();
  if (opts.client) {
    try {
      const [mode, , ok, reason] = await askContract(opts.client, opts.safe, opts.amountUsd, opts.txSeed);
      return {
        ok,
        reason: ok ? "" : (reason || "DECLINED").toUpperCase(),
        source: "on-chain",
        mode: mode === CASH_MODE.Credit ? "credit" : "debit",
        latencyMs: performance.now() - t0,
      };
    } catch {
      /* fall through to the engine */
    }
  }
  const d = authorizeCardSpend(opts.fallbackAccount, opts.amountUsd);
  return d.ok
    ? { ok: true, reason: "", source: "engine-fallback", mode: null, latencyMs: performance.now() - t0, funding: d.funding }
    : { ok: false, reason: d.message, source: "engine-fallback", mode: null, latencyMs: performance.now() - t0, code: d.code };
}
