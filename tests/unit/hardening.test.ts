import { describe, expect, it } from "vitest";
import { rpcUrlList } from "../../src/lib/rpc";
import { createTxLock } from "../../src/lib/txLock";
import { gasWarning } from "../../src/lib/yieldEngine";

describe("rpcUrlList: primary, secondary, then public, deduplicated", () => {
  const PUB = "https://rpc.mainnet.chain.robinhood.com";
  it("orders providers first and keeps the public endpoint as the last resort", () => {
    expect(rpcUrlList("https://a.example/v2/key", "https://b.example/v2/key", PUB)).toEqual(["https://a.example/v2/key", "https://b.example/v2/key", PUB]);
  });
  it("falls back to the public endpoint alone when nothing is configured", () => {
    expect(rpcUrlList(undefined, undefined, PUB)).toEqual([PUB]);
    expect(rpcUrlList("", "  ", PUB)).toEqual([PUB]);
  });
  it("drops duplicates and anything that is not https (no plain-http provider in production)", () => {
    expect(rpcUrlList(PUB, PUB, PUB)).toEqual([PUB]);
    expect(rpcUrlList("http://insecure.example", "ftp://x", PUB)).toEqual([PUB]);
  });
});

describe("createTxLock: a double click cannot start two transactions", () => {
  it("the second tryAcquire is refused until release", () => {
    const l = createTxLock();
    expect(l.tryAcquire()).toBe(true);
    expect(l.tryAcquire()).toBe(false); // the double click
    expect(l.tryAcquire()).toBe(false);
    expect(l.held).toBe(true);
    l.release();
    expect(l.held).toBe(false);
    expect(l.tryAcquire()).toBe(true); // usable again after a rejection or a failure
  });
  it("two independent locks do not block each other", () => {
    const a = createTxLock();
    const b = createTxLock();
    expect(a.tryAcquire()).toBe(true);
    expect(b.tryAcquire()).toBe(true);
  });
  it("releasing without holding is harmless", () => {
    const l = createTxLock();
    l.release();
    expect(l.held).toBe(false);
  });
});

describe("gasWarning: ETH for gas, per chain", () => {
  it("warns at exactly zero, names the chain", () => {
    expect(gasWarning("morpho", 0n)).toBe("Insufficient ETH for gas on Robinhood Chain. Add a little ETH to your wallet to continue.");
    expect(gasWarning("aave", 0n)).toContain("Arbitrum One");
  });
  it("no warning with any balance, even dust (1 wei), and none while still loading", () => {
    expect(gasWarning("morpho", 1n)).toBeNull();
    expect(gasWarning("morpho", 10n ** 18n)).toBeNull();
    expect(gasWarning("morpho", undefined)).toBeNull();
  });
});
