/**
 * Pure math for the Morpho (ERC-4626) yield engine. Money is bigint.
 *
 * Same model as the Aave engine (src/lib/aave/position.ts), so the rest of the app reasons about both the same way:
 *   principal = every deposit made for the Safe, minus withdrawals that left to anyone but the Safe (principal exits);
 *   yield     = max(0, current assets - principal), where current assets = vault.convertToAssets(Safe's shares).
 * The vault share price can fall (bad debt), so yield is clamped at zero and never shown negative.
 */
import { maxPrincipalWithdrawal, maxYieldWithdrawal, positionOf, type PoolEvent, type Position } from "../aave/position";

export interface VaultEvent {
  kind: "deposit" | "withdraw";
  /** Assets (USDG base units) moved, as reported by the event. */
  assets: bigint;
  /** Deposit: the owner that received the shares. Withdraw: the receiver of the assets. Lower-case compare. */
  counterparty: string;
  txHash?: string;
  timestamp?: number;
}

/** Morpho VaultV2 offsets shares by 10^(18 - assetDecimals) virtual shares and 1 virtual asset. */
export const virtualShares = (assetDecimals: number): bigint => 10n ** BigInt(Math.max(0, 18 - assetDecimals));

/** ERC-4626 convertToAssets, rounded down. Verified equal to the live vault's answer for several share sizes. */
export function sharesToAssets(shares: bigint, totalAssets: bigint, totalSupply: bigint, assetDecimals = 6): bigint {
  if (shares <= 0n) return 0n;
  return (shares * (totalAssets + 1n)) / (totalSupply + virtualShares(assetDecimals));
}

/** ERC-4626 convertToShares, rounded down. */
export function assetsToShares(assets: bigint, totalAssets: bigint, totalSupply: bigint, assetDecimals = 6): bigint {
  if (assets <= 0n) return 0n;
  return (assets * (totalSupply + virtualShares(assetDecimals))) / (totalAssets + 1n);
}

/** Vault events as the engine-neutral events the shared principal math understands. */
export function toPoolEvents(events: VaultEvent[]): PoolEvent[] {
  return events.map((e) => ({ kind: e.kind === "deposit" ? "supply" : "withdraw", amount: e.assets, counterparty: e.counterparty, txHash: e.txHash, timestamp: e.timestamp }));
}

/** Position from events and the Safe's current assets. `aBalance` holds the current assets (name kept for the shared type). */
export function morphoPosition(events: VaultEvent[], safe: string, currentAssets: bigint): Position {
  return positionOf(toPoolEvents(events), safe, currentAssets);
}

export interface MorphoLimits {
  /** Most yield that can be withdrawn right now (position limit; the vault's liquidity is checked by simulation, see account.ts). */
  yield: bigint;
  /** Most principal that can be withdrawn right now. */
  principal: bigint;
}

/**
 * What the position allows. NOTE: Morpho VaultV2 returns 0 from maxWithdraw/maxRedeem/maxDeposit by design (verified on
 * the live vault for a real holder), so the vault's liquidity cannot be read from them. Liquidity is checked by simulating
 * the exact withdrawal before it is sent (simulateWithdrawal in account.ts).
 */
export function morphoLimits(p: Position): MorphoLimits {
  return { yield: maxYieldWithdrawal(p), principal: maxPrincipalWithdrawal(p) };
}

export type MorphoRequestCheck = { ok: true } | { ok: false; reason: string };

/** Refuse (never shrink) a request the chosen source cannot cover. */
export function checkMorphoRequest(source: "yield" | "principal", amount: bigint, p: Position): MorphoRequestCheck {
  if (amount <= 0n) return { ok: false, reason: "Enter an amount greater than zero." };
  if (amount > morphoLimits(p)[source]) {
    return { ok: false, reason: source === "yield" ? "That is more than the yield you have earned. Your principal stays locked." : "That is more than your deposited principal." };
  }
  return { ok: true };
}

/** A friendly message for a withdrawal the vault would not honour right now. */
export const NO_LIQUIDITY_MESSAGE = "The vault does not have that much liquidity available right now. Try a smaller amount or try again later.";
