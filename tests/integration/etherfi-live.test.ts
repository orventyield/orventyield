/**
 * Live checks against the real chains. Run with `npm run test:live` (needs network).
 * They prove the registry is correct on-chain, not just in a JSON file: bytecode exists, contracts reference each
 * other, token risk parameters match, and our ABIs decode real responses.
 */
import { createPublicClient, http, keccak256, parseAbi, toHex, type Address } from "viem";
import { arbitrum, optimism } from "viem/chains";
import { describe, expect, it } from "vitest";
import {
  BIN_SPONSOR,
  cashLensAbi,
  cashModuleAbi,
  dataProviderAbi,
  debtManagerAbi,
  priceProviderAbi,
  safeFactoryAbi,
} from "../../src/lib/etherfi/abi";
import { parseSafeCashData } from "../../src/lib/etherfi/snapshot";
import { ETHERFI_REGISTRY, OPTIMISM_COLLATERAL, getContract, type ContractName } from "../../src/lib/contracts/etherfi";

const live = process.env.LIVE === "1";
const d = describe.skipIf(!live);

const op = createPublicClient({ chain: optimism, transport: http(ETHERFI_REGISTRY[10]!.rpc), batch: { multicall: true } });
const arb = createPublicClient({ chain: arbitrum, transport: http(ETHERFI_REGISTRY[42161]!.rpc) });
const addr = (name: ContractName): Address => getContract(10, name)!.address;
const erc20 = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)"]);
const eq = (a: string, b: string) => expect(a.toLowerCase()).toBe(b.toLowerCase());

d("registry matches the chains", () => {
  it("every registry entry has code on its chain", async () => {
    for (const [chainId, chain] of Object.entries(ETHERFI_REGISTRY)) {
      const client = createPublicClient({ transport: http(chain.rpc) });
      for (const [name, c] of Object.entries(chain.contracts)) {
        const code = await client.getCode({ address: c.address });
        expect(!!code && code !== "0x", `${chain.name} ${name} ${c.address} (chain ${chainId})`).toBe(c.status !== "no-code");
      }
    }
  }, 120_000);

  it("Optimism core contracts reference each other (identity proof)", async () => {
    eq(await op.readContract({ address: addr("CashModule"), abi: cashModuleAbi, functionName: "getDebtManager" }), addr("DebtManager"));
    eq(await op.readContract({ address: addr("CashModule"), abi: cashModuleAbi, functionName: "etherFiDataProvider" }), addr("EtherFiDataProvider"));
    eq(await op.readContract({ address: addr("CashModule"), abi: cashModuleAbi, functionName: "getLendGateway" }), addr("LendGateway"));
    eq(await op.readContract({ address: addr("EtherFiDataProvider"), abi: dataProviderAbi, functionName: "getCashModule" }), addr("CashModule"));
    eq(await op.readContract({ address: addr("EtherFiDataProvider"), abi: dataProviderAbi, functionName: "getEtherFiSafeFactory" }), addr("EtherFiSafeFactory"));
    eq(await op.readContract({ address: addr("EtherFiDataProvider"), abi: dataProviderAbi, functionName: "getPriceProvider" }), addr("PriceProvider"));
  }, 60_000);

  it("settlement dispatchers are the ones CashModule routes to", async () => {
    const pairs: [number, ContractName][] = [
      [BIN_SPONSOR.Reap, "SettlementDispatcherReap"],
      [BIN_SPONSOR.Rain, "SettlementDispatcherRain"],
      [BIN_SPONSOR.PIX, "SettlementDispatcherPix"],
      [BIN_SPONSOR.CardOrder, "SettlementDispatcherCardOrder"],
    ];
    for (const [sponsor, name] of pairs) {
      eq(await op.readContract({ address: addr("CashModule"), abi: cashModuleAbi, functionName: "getSettlementDispatcher", args: [sponsor] }), addr(name));
    }
  }, 60_000);

  it("token registry: symbol, decimals and risk parameters match DebtManager", async () => {
    const onChain = await op.readContract({ address: addr("DebtManager"), abi: debtManagerAbi, functionName: "getCollateralTokens" });
    expect(new Set(onChain.map((a) => a.toLowerCase()))).toEqual(new Set(OPTIMISM_COLLATERAL.map((t) => t.address.toLowerCase())));
    for (const t of OPTIMISM_COLLATERAL) {
      const cfg = await op.readContract({ address: addr("DebtManager"), abi: debtManagerAbi, functionName: "collateralTokenConfig", args: [t.address] });
      // DebtManager stores percentages with 18 decimals (90e18 = 90%).
      expect(Number(cfg.ltv / 10n ** 16n), `${t.symbol} ltv`).toBe(t.ltvBps);
      expect(Number(cfg.liquidationThreshold / 10n ** 16n), `${t.symbol} liq`).toBe(t.liqBps);
      expect(await op.readContract({ address: t.address, abi: erc20, functionName: "decimals" }), `${t.symbol} decimals`).toBe(t.decimals);
    }
  }, 180_000);

  it("weETH and USDC are what the registry says on Optimism and Arbitrum", async () => {
    for (const [client, chainId] of [[op, 10], [arb, 42161]] as const) {
      for (const [name, sym, dec] of [["weETH", "weETH", 18], ["USDC", "USDC", 6]] as const) {
        const a = getContract(chainId, name)!.address;
        expect(await client.readContract({ address: a, abi: erc20, functionName: "symbol" })).toBe(sym);
        expect(await client.readContract({ address: a, abi: erc20, functionName: "decimals" })).toBe(dec);
      }
    }
  }, 60_000);

  it("the price provider quotes weETH above WETH and USDC near $1 (6-decimal USD)", async () => {
    const price = (t: Address) => op.readContract({ address: addr("PriceProvider"), abi: priceProviderAbi, functionName: "price", args: [t] });
    const weeth = Number(await price(addr("weETH"))) / 1e6;
    const usdc = Number(await price(addr("USDC"))) / 1e6;
    expect(usdc).toBeGreaterThan(0.98);
    expect(usdc).toBeLessThan(1.02);
    expect(weeth).toBeGreaterThan(500);
  }, 60_000);
});

d("ABIs decode real Safes", () => {
  it("enumerates Safes from the factory and decodes getSafeCashData for each", async () => {
    const safes = await op.readContract({ address: addr("EtherFiSafeFactory"), abi: safeFactoryAbi, functionName: "getDeployedAddresses", args: [0n, 25n] });
    expect(safes.length).toBeGreaterThan(0);
    for (const s of safes) {
      expect(await op.readContract({ address: addr("EtherFiSafeFactory"), abi: safeFactoryAbi, functionName: "isEtherFiSafe", args: [s] })).toBe(true);
      const raw = await op.readContract({ address: addr("CashLens"), abi: cashLensAbi, functionName: "getSafeCashData", args: [s, []] });
      const liq = await op.readContract({ address: addr("DebtManager"), abi: debtManagerAbi, functionName: "getMaxBorrowAmount", args: [s, false] });
      const parsedSafe = parseSafeCashData(s, raw, liq);
      expect(parsedSafe.totalCollateralUsd).toBeGreaterThanOrEqual(0);
      const sum = parsedSafe.collateral.reduce((a, t) => a + t.valueUsd, 0);
      expect(Math.abs(sum - parsedSafe.totalCollateralUsd)).toBeLessThanOrEqual(Math.max(0.1, parsedSafe.totalCollateralUsd * 0.01));
    }
  }, 180_000);

  it("a random address is not an EtherFiSafe", async () => {
    expect(await op.readContract({ address: addr("EtherFiSafeFactory"), abi: safeFactoryAbi, functionName: "isEtherFiSafe", args: ["0x000000000000000000000000000000000000dEaD"] })).toBe(false);
  }, 30_000);

  it("canSpendSingleToken returns a verdict and a reason", async () => {
    const [safe] = await op.readContract({ address: addr("EtherFiSafeFactory"), abi: safeFactoryAbi, functionName: "getDeployedAddresses", args: [0n, 1n] });
    const usdc = addr("USDC");
    const r = await op.readContract({
      address: addr("CashLens"),
      abi: cashLensAbi,
      functionName: "canSpendSingleToken",
      args: [safe!, keccak256(toHex("orventyield-live-test")), [usdc], [usdc], 1_000_000n],
    });
    expect(typeof r[2]).toBe("boolean");
    expect(typeof r[3]).toBe("string");
  }, 30_000);
});
