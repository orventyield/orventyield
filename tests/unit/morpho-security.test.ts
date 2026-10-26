import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { decodeFunctionData, erc20Abi } from "viem";
import { describe, expect, it } from "vitest";
import { morphoVaultV2Abi } from "../../src/lib/contracts/abis/MorphoVaultV2";
import { ROBINHOOD } from "../../src/lib/contracts/robinhood";
import { approveData, assertMorphoInnerCalls, assertMorphoTarget, depositData, withdrawToData, withdrawYieldData } from "../../src/lib/morpho/account";

const SAFE = "0x1111111111111111111111111111111111111111" as const;
const OTHER_VAULT = "0x37788ff0c1d4e45A7FE06BC7e71e0cc00121d0A8"; // a real, permissionless vault on the same chain: must stay unreachable
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));

describe("only the allowlisted Steakhouse USDG vault can ever receive a deposit", () => {
  it("the vault address literal exists in exactly one source file: the constants", () => {
    const hits = walk("src").filter((f) => /\.(ts|tsx)$/.test(f) && readFileSync(f, "utf8").toLowerCase().includes(ROBINHOOD.steakhouseUsdgVault.toLowerCase()));
    expect(hits).toEqual([join("src", "lib", "contracts", "robinhood.ts")]);
  });
  it("no raw address literal in the Morpho engine, its hook or the Robinhood screens: addresses only come from the constants", () => {
    const files = [...walk(join("src", "lib", "morpho")), join("src", "features", "account", "useMorphoAccount.ts"), ...walk(join("src", "components", "dashboard", "robinhood"))];
    for (const f of files) expect(readFileSync(f, "utf8").match(/0x[0-9a-fA-F]{40}\b/g), f).toBeNull();
  });
  it("targets outside the allowlist are refused: another vault, Morpho Blue itself, USDC, a random address", () => {
    for (const bad of [OTHER_VAULT, ROBINHOOD.morphoBlue, "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", "0x2222222222222222222222222222222222222222"]) {
      expect(() => assertMorphoTarget(bad, SAFE), bad).toThrow(/not one OrventYield may call/);
    }
  });
  it("allowed targets pass: Safe factory, USDG, the vault (any case) and the user's own Safe", () => {
    for (const ok of [ROBINHOOD.safeProxyFactory, ROBINHOOD.usdg, ROBINHOOD.steakhouseUsdgVault, ROBINHOOD.steakhouseUsdgVault.toLowerCase(), SAFE]) expect(() => assertMorphoTarget(ok, SAFE)).not.toThrow();
  });
  it("before the Safe is known, the user's Safe is not implicitly allowed", () => {
    expect(() => assertMorphoTarget(SAFE, undefined)).toThrow();
  });
  it("calls the Safe makes for the user may only touch the vault and USDG", () => {
    expect(() => assertMorphoInnerCalls([{ to: ROBINHOOD.steakhouseUsdgVault }, { to: ROBINHOOD.usdg }])).not.toThrow();
    expect(() => assertMorphoInnerCalls([{ to: OTHER_VAULT }])).toThrow(/allowlisted vault and USDG/);
    expect(() => assertMorphoInnerCalls([{ to: ROBINHOOD.usdg }, { to: ROBINHOOD.morphoBlue }])).toThrow();
  });
  it("calldata semantics: deposits credit the Safe, approvals name the vault and the exact amount, no unlimited allowance", () => {
    const d = decodeFunctionData({ abi: morphoVaultV2Abi, data: depositData(123n, SAFE) });
    expect(d.functionName).toBe("deposit");
    expect(d.args).toEqual([123n, SAFE]);
    const a = decodeFunctionData({ abi: erc20Abi, data: approveData(456n) });
    expect(a.functionName).toBe("approve");
    expect(a.args).toEqual([ROBINHOOD.steakhouseUsdgVault, 456n]);
    const y = decodeFunctionData({ abi: morphoVaultV2Abi, data: withdrawYieldData(7n, SAFE) });
    expect(y.args).toEqual([7n, SAFE, SAFE]); // yield stays in the Safe, owner is the Safe
    const p = decodeFunctionData({ abi: morphoVaultV2Abi, data: withdrawToData(7n, "0x2222222222222222222222222222222222222222", SAFE) });
    expect(p.args?.[2]).toBe(SAFE); // the owner of the shares is always the Safe, never someone else's position
  });
});

describe("zero state leak between the two engines", () => {
  const read = (f: string) => readFileSync(f, "utf8");
  const MORPHO = join("src", "features", "account", "useMorphoAccount.ts");
  const AAVE = join("src", "features", "account", "useSafeAccount.ts");
  /** Literal query keys: queryKey: ["name", chainId, ...]. */
  const literalKeys = (f: string) => [...read(f).matchAll(/queryKey:\s*\[("[^"]+"[^\]]*)\]/g)].map((m) => m[1]!.trim());
  /** The names the hook invalidates after a write: ["a", "b"].map((k) => ... queryKey: [k, chainId]). */
  const invalidated = (f: string) => [...read(f).matchAll(/\[((?:"[^"]+",?\s*)+)\]\.map\(\(k\)/g)].flatMap((m) => [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!));
  const name = (k: string) => k.split(",")[0]!.trim().replace(/"/g, "");

  it("every Morpho query key is namespaced (mo-) and carries the chain, so Aave data can never be read as Morpho data", () => {
    const keys = literalKeys(MORPHO);
    expect(keys.length).toBeGreaterThanOrEqual(4);
    for (const k of keys) {
      expect(name(k).startsWith("mo-"), k).toBe(true);
      expect(k, k).toContain("chainId");
    }
  });
  it("no Aave query key uses the Morpho namespace, and every key carries the chain", () => {
    const keys = literalKeys(AAVE);
    expect(keys.length).toBeGreaterThanOrEqual(4);
    for (const k of keys) {
      expect(name(k).startsWith("mo-"), k).toBe(false);
      expect(k, k).toContain("chainId");
    }
  });
  it("the two engines share no cache key, and each only invalidates its own", () => {
    const aave = new Set(literalKeys(AAVE).map(name));
    for (const k of literalKeys(MORPHO)) expect(aave.has(name(k)), k).toBe(false);
    const mo = invalidated(MORPHO);
    expect(mo.length).toBeGreaterThanOrEqual(3);
    for (const n of mo) expect(n.startsWith("mo-"), n).toBe(true);
    const av = invalidated(AAVE);
    expect(av.length).toBeGreaterThanOrEqual(3);
    for (const n of av) expect(n.startsWith("mo-"), n).toBe(false);
  });
  it("each dashboard is its own component with its own hook (no shared balance state to mix up)", () => {
    const rh = read(join("src", "components", "dashboard", "robinhood", "RobinhoodDashboard.tsx"));
    expect(rh).toContain("useMorphoAccount");
    expect(rh).not.toContain("useSafeAccount");
    expect(read(join("src", "components", "dashboard", "MainnetDashboard.tsx"))).not.toContain("useMorphoAccount");
  });
});
