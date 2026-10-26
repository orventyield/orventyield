import { encodeFunctionData, erc20Abi, type Address, type Hex, type PublicClient } from "viem";
import { ARBITRUM } from "../contracts/arbitrum";
import { safeFactoryAbi } from "../safe/safe";
import { poolAbi, RESERVE_ATOKEN, RESERVE_LIQUIDITY_RATE } from "./abi";
import { positionOf, type PoolEvent, type Position } from "./position";

/** Public Arbitrum RPCs cap eth_getLogs at 10M blocks, while commercial providers (Alchemy, Infura) cap at 10k-50k. */
export const LOG_SPAN = 9_000_000n;
/** How many of the newest pool events get a block timestamp for the ledger. */
const LEDGER_EVENTS = 50;

type Client = Pick<PublicClient, "readContract" | "getLogs" | "getBlockNumber" | "getBlock">;

/** Every transaction the Aave flow sends goes to the Safe factory, USDC, Aave pool, or user's Safe. */
export function assertArbitrumTarget(to: string, safe: string | undefined): void {
  const t = to.toLowerCase();
  const ok = [ARBITRUM.safeProxyFactory, ARBITRUM.usdc, ARBITRUM.aavePool, ...(safe ? [safe] : [])].some((a) => a.toLowerCase() === t);
  if (!ok) throw new Error("Blocked: that contract is not one OrventYield may call.");
}

/** Exact-amount approval for the Aave Pool (never unlimited). */
export const approveData = (amount: bigint): Hex =>
  encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ARBITRUM.aavePool, amount] });

/** Supply on behalf of the Safe: the aTokens (principal + yield) belong to the Safe, not the wallet. */
export const supplyData = (amount: bigint, safe: Address): Hex =>
  encodeFunctionData({ abi: poolAbi, functionName: "supply", args: [ARBITRUM.usdc, amount, safe, 0] });

/** Yield withdrawals land in the Safe itself (this is what marks them as yield, see position.ts). */
export const withdrawYieldData = (amount: bigint, safe: Address): Hex =>
  encodeFunctionData({ abi: poolAbi, functionName: "withdraw", args: [ARBITRUM.usdc, amount, safe] });

/** Principal exits go straight to the owner's wallet. */
export const withdrawPrincipalData = (amount: bigint, owner: Address): Hex =>
  encodeFunctionData({ abi: poolAbi, functionName: "withdraw", args: [ARBITRUM.usdc, amount, owner] });

export const transferData = (to: Address, amount: bigint): Hex =>
  encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] });

/** Adaptively splits block range if commercial providers (Alchemy/Infura) return range or limit errors. */
async function adaptiveFetch<T>(a: bigint, b: bigint, fetch: (start: bigint, end: bigint) => Promise<T[]>): Promise<T[]> {
  try {
    return await fetch(a, b);
  } catch (err: unknown) {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    const isRangeError = msg.includes("range") || msg.includes("limit") || msg.includes("10000") || msg.includes("400") || msg.includes("exceed");
    if (isRangeError && b > a) {
      const mid = a + (b - a) / 2n;
      const left = await adaptiveFetch(a, mid, fetch);
      const right = await adaptiveFetch(mid + 1n, b, fetch);
      return [...left, ...right];
    }
    throw err;
  }
}

export async function chunked<T>(from: bigint, to: bigint, fetch: (a: bigint, b: bigint) => Promise<T[]>): Promise<T[]> {
  if (from > to) return [];
  const out: T[] = [];
  for (let a = from; a <= to; a += LOG_SPAN + 1n) {
    const b = a + LOG_SPAN > to ? to : a + LOG_SPAN;
    out.push(...(await adaptiveFetch(a, b, fetch)));
  }
  return out;
}

/** Block at which the Safe was created, found by scanning the factory's ProxyCreation events (callers cache it). */
export async function findSafeCreationBlock(client: Client, safe: Address, earliest = 0n, factory: Address = ARBITRUM.safeProxyFactory): Promise<bigint | null> {
  const head = await client.getBlockNumber();
  // Newest first: Safes are usually recent, and the public RPC allows ~10M blocks per query.
  for (let b = head; b >= earliest; b = b > LOG_SPAN ? b - LOG_SPAN - 1n : 0n) {
    const from = b > LOG_SPAN ? b - LOG_SPAN : 0n;
    const start = from < earliest ? earliest : from;
    try {
      const logs = await adaptiveFetch(start, b, (s, e) =>
        client.getLogs({
          address: factory,
          event: safeFactoryAbi[2],
          args: { proxy: safe },
          fromBlock: s,
          toBlock: e,
        })
      );
      if (logs.length) return logs[0]!.blockNumber;
    } catch {
      /* continue backward search */
    }
    if (from === 0n) break;
  }
  return null;
}

export async function readPoolEvents(client: Client, safe: Address, fromBlock: bigint): Promise<PoolEvent[]> {
  const head = await client.getBlockNumber();
  const supplies = await chunked(fromBlock, head, (a, b) =>
    client.getLogs({ address: ARBITRUM.aavePool, event: poolAbi[3], args: { reserve: ARBITRUM.usdc, onBehalfOf: safe }, fromBlock: a, toBlock: b }),
  );
  const withdrawals = await chunked(fromBlock, head, (a, b) =>
    client.getLogs({ address: ARBITRUM.aavePool, event: poolAbi[4], args: { reserve: ARBITRUM.usdc, user: safe }, fromBlock: a, toBlock: b }),
  );
  const all = [
    ...supplies.map((l) => ({ kind: "supply" as const, amount: l.args.amount!, counterparty: l.args.onBehalfOf!, block: l.blockNumber, idx: l.logIndex, txHash: l.transactionHash })),
    ...withdrawals.map((l) => ({ kind: "withdraw" as const, amount: l.args.amount!, counterparty: l.args.to!, block: l.blockNumber, idx: l.logIndex, txHash: l.transactionHash })),
  ].sort((x, y) => Number(x.block - y.block) || x.idx - y.idx);

  // Block times for the most recent events only (the ledger shows recent activity); failures just leave the time unknown.
  const recent = all.slice(-LEDGER_EVENTS);
  const times = new Map<bigint, number>();
  await Promise.all(
    [...new Set(recent.map((e) => e.block))].map(async (b) => {
      try {
        times.set(b, Number((await client.getBlock({ blockNumber: b })).timestamp) * 1000);
      } catch {
        /* time unknown */
      }
    }),
  );
  return all.map(({ kind, amount, counterparty, block, txHash }) => ({ kind, amount, counterparty, txHash, timestamp: times.get(block) }));
}

export interface ReserveInfo {
  aToken: Address;
  liquidityRate: bigint;
}

export async function readReserve(client: Pick<PublicClient, "readContract">): Promise<ReserveInfo> {
  const r = (await client.readContract({ address: ARBITRUM.aavePool, abi: poolAbi, functionName: "getReserveData", args: [ARBITRUM.usdc] })) as readonly unknown[];
  return { aToken: r[RESERVE_ATOKEN] as Address, liquidityRate: BigInt(r[RESERVE_LIQUIDITY_RATE] as bigint) };
}

export interface AccountSnapshot extends Position {
  aToken: Address;
  liquidityRate: bigint;
  events: PoolEvent[];
}

export async function readAccount(client: Client, safe: Address, creationBlock: bigint): Promise<AccountSnapshot> {
  const reserve = await readReserve(client);
  const [aBalance, events] = await Promise.all([
    client.readContract({ address: reserve.aToken, abi: erc20Abi, functionName: "balanceOf", args: [safe] }),
    readPoolEvents(client, safe, creationBlock),
  ]);
  return { ...reserve, events, ...positionOf(events, safe, aBalance) };
}
