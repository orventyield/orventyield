import { describe, expect, it, vi } from "vitest";
import { MAX_TAIL_BLOCKS, buildShard, findInShard, lookupIndex, scanTail } from "../../src/lib/etherfi/safeIndex";

const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

describe("index shard (binary search over 40-byte records)", () => {
  const pairs: [string, string][] = Array.from({ length: 500 }, (_, i) => [addr(1000 + i * 3), addr(900000 + i)]);
  const shard = buildShard(pairs);

  it("finds every owner and returns exactly its Safe", () => {
    for (const [o, s] of pairs) expect(findInShard(shard, o)).toEqual([s.toLowerCase()]);
  });
  it("returns nothing for unknown owners, below, between and above the range", () => {
    for (const n of [1, 1001, 1002, 999999]) expect(findInShard(shard, addr(n))).toEqual([]);
    expect(findInShard(new Uint8Array(0), addr(5))).toEqual([]);
  });
  it("returns all Safes of an owner with several, and is case-insensitive", () => {
    const owner = "0xAbCdEf0000000000000000000000000000000001";
    const s = buildShard([[owner, addr(1)], [owner, addr(2)], [owner, addr(3)], [addr(77), addr(9)]]);
    expect(findInShard(s, owner.toLowerCase())).toEqual([addr(1), addr(2), addr(3)]);
    expect(findInShard(s, owner)).toHaveLength(3);
    expect(findInShard(s, addr(77))).toEqual([addr(9)]);
  });
});

describe("lookupIndex", () => {
  const owner = "0xD43D43967dd500373BaDFaefcEEED6664544a9a4";
  const safe = "0xA9FB321EA3A4F957fDEb82B8C76CD2Ea9E08850b";
  const mk = (map: Record<string, Response>) => vi.fn(async (url: string) => map[url] ?? new Response("nope", { status: 404 })) as unknown as typeof fetch;

  it("reads the shard for the owner's first byte", async () => {
    const buf = buildShard([[owner, safe]]);
    const f = mk({
      "/safe-index/meta.json": new Response(JSON.stringify({ headBlock: 158000000 })),
      "/safe-index/d4.bin": new Response(buf as unknown as BodyInit),
    });
    const r = await lookupIndex(owner, "/safe-index", f);
    expect(r).toEqual({ available: true, safes: [safe.toLowerCase()], headBlock: 158000000 });
  });
  it("reports the index as unavailable when files are missing or the network fails", async () => {
    expect(await lookupIndex(owner, "/safe-index", mk({}))).toMatchObject({ available: false, safes: [] });
    const boom = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await lookupIndex(owner, "/safe-index", boom)).toMatchObject({ available: false });
  });
});

describe("scanTail", () => {
  const me = "0x1111111111111111111111111111111111111111";
  const other = "0x2222222222222222222222222222222222222222";
  const log = (safe: string, owners: string[], add: boolean[]) => ({ address: safe, args: { owners, shouldAdd: add } });

  it("collects Safes that added this owner, ignores removals and other owners", async () => {
    const getLogs = vi.fn(async () => [log(addr(1), [me], [true]), log(addr(2), [other], [true]), log(addr(3), [me], [false]), log(addr(4), [other, me], [true, true])]);
    const r = await scanTail({ getLogs } as never, me, 1000n, 5000n);
    expect(r.added.sort()).toEqual([addr(1), addr(4)]);
    expect(r.partial).toBe(false);
  });
  it("scans in 10k-block spans starting right after the index head", async () => {
    const getLogs = vi.fn(async (_args: { fromBlock: bigint; toBlock: bigint }) => []);
    await scanTail({ getLogs } as never, me, 1000n, 26_000n);
    const ranges = getLogs.mock.calls.map((c) => [c[0].fromBlock, c[0].toBlock]);
    expect(ranges).toEqual([[1001n, 10_999n + 1n], [11_001n, 21_000n], [21_001n, 26_000n]]);
  });
  it("caps the scan and flags the result as partial when the index is far behind or missing", async () => {
    const getLogs = vi.fn(async () => []);
    const head = 10_000_000n;
    const r1 = await scanTail({ getLogs } as never, me, null, head);
    expect(r1.partial).toBe(true);
    const scanned = getLogs.mock.calls.length;
    expect(BigInt(scanned) * 10_000n).toBeLessThanOrEqual(MAX_TAIL_BLOCKS + 10_000n);
    const r2 = await scanTail({ getLogs } as never, me, 100n, head);
    expect(r2.partial).toBe(true);
  });
});
