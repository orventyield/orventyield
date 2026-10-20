/**
 * READ-ONLY smoke test against the real Arbitrum One RPC (no transactions, no keys). Run it by hand:
 *   MAINNET_READ=1 npx vitest run tests/integration/mainnet-read.test.ts
 * It proves the addresses and ABIs in src/lib/contracts/arbitrum.ts still behave on mainnet, which the fork tests cannot.
 */
import { createPublicClient, erc20Abi, getAddress, http } from "viem";
import { arbitrum } from "viem/chains";
import { describe, expect, it } from "vitest";
import { findSafeCreationBlock, readReserve } from "../../src/lib/aave/account";
import { rayToApy } from "../../src/lib/aave/position";
import { ARBITRUM } from "../../src/lib/contracts/arbitrum";
import { predictSafeAddress, readCreationCode } from "../../src/lib/safe/safe";

const d = describe.skipIf(process.env.MAINNET_READ !== "1");
const client = createPublicClient({ chain: arbitrum, transport: http(process.env.RPC ?? "https://arb1.arbitrum.io/rpc") });
const SOMEONE = getAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");

d("Arbitrum One mainnet (read-only)", () => {
  it("every contract we use has code", async () => {
    for (const [name, addr] of Object.entries(ARBITRUM)) expect(await client.getCode({ address: addr }), name).toBeDefined();
  });
  it("USDC is the 6-decimal Circle USDC", async () => {
    expect(await client.readContract({ address: ARBITRUM.usdc, abi: erc20Abi, functionName: "decimals" })).toBe(6);
    expect(await client.readContract({ address: ARBITRUM.usdc, abi: erc20Abi, functionName: "symbol" })).toBe("USDC");
  });
  it("Aave reserve data reads, with a sane APY and an aToken", async () => {
    const r = await readReserve(client);
    expect(r.aToken).toMatch(/^0x[0-9a-fA-F]{40}$/);
    const apy = rayToApy(r.liquidityRate);
    expect(apy).toBeGreaterThanOrEqual(0);
    expect(apy).toBeLessThan(0.5); // under 50%
    expect(await client.readContract({ address: r.aToken, abi: erc20Abi, functionName: "symbol" })).toMatch(/aArbUSDCn|aUSDC/i);
  });
  it("predicts a Safe address with no side effects, and it is not deployed for an unrelated wallet", async () => {
    const safe = predictSafeAddress(SOMEONE, await readCreationCode(client));
    expect(safe).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(await client.getCode({ address: safe })).toBeUndefined();
    expect(await client.getBlockNumber()).toBeGreaterThan(0n);
  });
  it("the Safe factory's ProxyCreation event can be queried over the public RPC's range limit", async () => {
    // A never-deployed address finds nothing, but the scan itself must complete without an RPC range error.
    const safe = predictSafeAddress(SOMEONE, await readCreationCode(client));
    const head = await client.getBlockNumber();
    expect(await findSafeCreationBlock(client, safe, head - 20_000_000n)).toBeNull();
  }, 60_000);
});
