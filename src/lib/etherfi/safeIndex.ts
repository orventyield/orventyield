/**
 * Finds the Ether.fi Safe(s) owned by a wallet, with no user input.
 *
 * A Safe cannot be looked up from an owner on-chain (owners are not indexed). Instead:
 *  1. a prebuilt static index (scripts/build-safe-index.mjs) maps owner -> Safes up to some block;
 *  2. a short scan of the newest blocks adds Safes created or re-owned since then;
 *  3. every candidate is verified on-chain (isEtherFiSafe + getOwners), so a stale or wrong index can only
 *     cause a miss, never a wrong account.
 */
import { getAddress, parseAbiItem, type Address, type PublicClient } from "viem";
import { verifiedAddress } from "../contracts/etherfi";
import { etherFiSafeAbi, safeFactoryAbi } from "./abi";

const OWNERS_CONFIGURED = parseAbiItem("event OwnersConfigured(address[] owners, bool[] shouldAdd)");
const RECORD = 40;
const SPAN = 10_000n;
/** Newest blocks scanned at runtime beyond the index (6 calls of 10k blocks is about 33 hours). */
export const MAX_TAIL_BLOCKS = 60_000n;

export interface IndexMeta {
  version: number;
  headBlock: number;
  safes: number;
  owners: number;
  generatedAt: string;
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const toBytes = (addr: string) => Uint8Array.from(addr.replace(/^0x/, "").match(/../g)!.map((h) => parseInt(h, 16)));

function cmp(buf: Uint8Array, offset: number, key: Uint8Array): number {
  for (let i = 0; i < 20; i++) {
    const d = buf[offset + i]! - key[i]!;
    if (d !== 0) return d;
  }
  return 0;
}

/** All Safes recorded for `owner` in one shard (sorted 40-byte records: owner + safe). */
export function findInShard(shard: Uint8Array, owner: string): Address[] {
  const key = toBytes(owner.toLowerCase());
  const n = Math.floor(shard.length / RECORD);
  let lo = 0;
  let hi = n - 1;
  let at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = cmp(shard, mid * RECORD, key);
    if (c === 0) {
      at = mid;
      break;
    }
    if (c < 0) lo = mid + 1;
    else hi = mid - 1;
  }
  if (at < 0) return [];
  let start = at;
  while (start > 0 && cmp(shard, (start - 1) * RECORD, key) === 0) start--;
  const out: Address[] = [];
  for (let i = start; i < n && cmp(shard, i * RECORD, key) === 0; i++) out.push(`0x${hex(shard.subarray(i * RECORD + 20, i * RECORD + 40))}` as Address);
  return out;
}

/** Build a shard from (owner, safe) pairs. Used by tests and mirrors the indexer's file format. */
export function buildShard(pairs: [string, string][]): Uint8Array {
  const sorted = [...pairs].map(([o, s]) => [o.toLowerCase(), s.toLowerCase()] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  const buf = new Uint8Array(sorted.length * RECORD);
  sorted.forEach(([o, s], i) => {
    buf.set(toBytes(o), i * RECORD);
    buf.set(toBytes(s), i * RECORD + 20);
  });
  return buf;
}

export interface IndexLookup {
  /** False when the index files are not deployed: the result is then incomplete. */
  available: boolean;
  safes: Address[];
  headBlock: number | null;
}

export async function lookupIndex(owner: string, base = "/safe-index", fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<IndexLookup> {
  try {
    const [metaRes, shardRes] = await Promise.all([fetchImpl(`${base}/meta.json`), fetchImpl(`${base}/${owner.toLowerCase().slice(2, 4)}.bin`)]);
    if (!metaRes.ok || !shardRes.ok) return { available: false, safes: [], headBlock: null };
    const meta = (await metaRes.json()) as IndexMeta;
    return { available: true, safes: findInShard(new Uint8Array(await shardRes.arrayBuffer()), owner), headBlock: meta.headBlock };
  } catch {
    return { available: false, safes: [], headBlock: null };
  }
}

export interface TailResult {
  added: Address[];
  /** True when the gap since the index was larger than we are willing to scan. */
  partial: boolean;
}

/** Safes that gained `owner` in the newest blocks, found from the Safes' own OwnersConfigured events. */
export async function scanTail(client: PublicClient, owner: string, fromBlock: bigint | null, toBlock: bigint): Promise<TailResult> {
  const floor = toBlock > MAX_TAIL_BLOCKS ? toBlock - MAX_TAIL_BLOCKS : 0n;
  const start = fromBlock !== null && fromBlock + 1n > floor ? fromBlock + 1n : floor;
  const partial = fromBlock === null || fromBlock + 1n < floor;
  const ranges: [bigint, bigint][] = [];
  for (let b = start; b <= toBlock; b += SPAN) ranges.push([b, b + SPAN - 1n > toBlock ? toBlock : b + SPAN - 1n]);
  const me = owner.toLowerCase();
  const added = new Set<string>();
  // Three ranges at a time keeps public RPCs happy.
  for (let i = 0; i < ranges.length; i += 3) {
    const batch = await Promise.all(ranges.slice(i, i + 3).map(([a, b]) => client.getLogs({ event: OWNERS_CONFIGURED, fromBlock: a, toBlock: b })));
    for (const logs of batch) {
      for (const l of logs) {
        const owners = l.args.owners ?? [];
        const idx = owners.findIndex((o) => o.toLowerCase() === me);
        if (idx > -1 && l.args.shouldAdd?.[idx]) added.add(l.address.toLowerCase());
      }
    }
  }
  return { added: [...added] as Address[], partial };
}

export interface Resolution {
  safes: Address[];
  indexAvailable: boolean;
  partial: boolean;
}

/** Keep only real Ether.fi Safes that this wallet currently owns. */
export async function verifyOwned(client: PublicClient, owner: string, candidates: Address[]): Promise<Address[]> {
  const factory = verifiedAddress(10, "EtherFiSafeFactory");
  if (!factory || candidates.length === 0) return [];
  const checks = await client.multicall({
    allowFailure: true,
    contracts: candidates.flatMap((c) => [
      { address: factory, abi: safeFactoryAbi, functionName: "isEtherFiSafe", args: [c] },
      { address: c, abi: etherFiSafeAbi, functionName: "getOwners" },
    ] as const),
  });
  const me = owner.toLowerCase();
  return candidates.filter((_, i) => {
    const isSafe = checks[i * 2];
    const owners = checks[i * 2 + 1];
    return isSafe?.status === "success" && isSafe.result === true && owners?.status === "success" && (owners.result as readonly Address[]).some((o) => o.toLowerCase() === me);
  });
}

export async function resolveSafes(client: PublicClient, owner: string, opts: { base?: string; fetchImpl?: typeof fetch } = {}): Promise<Resolution> {
  const [idx, head] = await Promise.all([lookupIndex(owner, opts.base, opts.fetchImpl), client.getBlockNumber()]);
  const tail = await scanTail(client, owner, idx.headBlock === null ? null : BigInt(idx.headBlock), head);
  const candidates = [...new Set([...idx.safes, ...tail.added].map((a) => a.toLowerCase()))] as Address[];
  // Show standard checksummed addresses (the index and logs are lowercase).
  const safes = (await verifyOwned(client, owner, candidates)).map((a) => getAddress(a));
  return { safes, indexAvailable: idx.available, partial: tail.partial };
}
