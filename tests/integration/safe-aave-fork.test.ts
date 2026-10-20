/**
 * Runs the app's own libraries against the Anvil Arbitrum fork. Needs: `npm run fork` then `FORK=1 npm test`.
 * Nothing touches a real network; the key below is Anvil's public dev key #0.
 */
import { createPublicClient, createWalletClient, erc20Abi, getAddress, http, parseUnits, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";
import { describe, expect, it } from "vitest";
import { approveData, readAccount, supplyData, transferData, withdrawPrincipalData, withdrawYieldData } from "../../src/lib/aave/account";
import { maxYieldWithdrawal } from "../../src/lib/aave/position";
import { ARBITRUM } from "../../src/lib/contracts/arbitrum";
import { execCalldata, predictSafeAddress, readCreationCode, safeAbi, safeCall, safeFactoryAbi, safeSetup, withGasBuffer } from "../../src/lib/safe/safe";

const RPC = process.env.FORK_RPC ?? "http://127.0.0.1:8545";
const chain = { ...arbitrum, id: 31337, rpcUrls: { default: { http: [RPC] } } };
const owner = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account: owner, chain, transport: http(RPC) });

const d = describe.skipIf(process.env.FORK !== "1");

const send = async (to: Address, data: `0x${string}`) => {
  await pub.call({ account: owner.address, to, data }); // simulate first: surfaces reverts before sending
  // Same rule as the app: Safe transactions are sent with gas headroom
  const gas = withGasBuffer(await pub.estimateGas({ account: owner.address, to, data }));
  const hash = await wallet.sendTransaction({ to, data, gas });
  const r = await pub.waitForTransactionReceipt({ hash });
  expect(r.status).toBe("success");
  return r;
};
const safeExec = (safe: Address, calls: Parameters<typeof safeCall>[0]) => {
  const c = safeCall(calls);
  return send(safe, execCalldata(owner.address, c.to, c.data, c.operation));
};
const usdcOf = (a: Address) => pub.readContract({ address: ARBITRUM.usdc, abi: erc20Abi, functionName: "balanceOf", args: [a] });

d("Safe + Aave on the Arbitrum fork (app libraries)", () => {
  it("full lifecycle: predict, deploy, deposit, accrue, spend yield only, exit principal", async () => {
    // Fresh owner per run is impossible (one key), so snapshot/revert keeps the fork clean for reruns.
    const snap = (await pub.request({ method: "evm_snapshot" } as never)) as string;
    try {
      // 1. predicted address matches the deployed one
      const creation = await readCreationCode(pub);
      const predicted = predictSafeAddress(owner.address, creation);
      expect(await pub.getCode({ address: predicted })).toBeUndefined();
      const { initializer, saltNonce } = safeSetup(owner.address);
      const dep = await send(ARBITRUM.safeProxyFactory, (await import("viem")).encodeFunctionData({ abi: safeFactoryAbi, functionName: "createProxyWithNonce", args: [ARBITRUM.safeL2Singleton, initializer, saltNonce] }));
      expect(await pub.getCode({ address: predicted })).toBeDefined();
      const safe = getAddress(predicted);
      expect(await pub.readContract({ address: safe, abi: safeAbi, functionName: "getOwners" })).toEqual([owner.address]);

      // 2. deposit: exact approve + supply on behalf of the Safe (two plain wallet txs, no Safe tx needed)
      const amount = parseUnits("1000", 6);
      const walletBefore = await usdcOf(owner.address);
      await send(ARBITRUM.usdc, approveData(amount));
      expect(await pub.readContract({ address: ARBITRUM.usdc, abi: erc20Abi, functionName: "allowance", args: [owner.address, ARBITRUM.aavePool] })).toBe(amount);
      await send(ARBITRUM.aavePool, supplyData(amount, safe));
      expect(await pub.readContract({ address: ARBITRUM.usdc, abi: erc20Abi, functionName: "allowance", args: [owner.address, ARBITRUM.aavePool] })).toBe(0n); // allowance fully consumed
      expect(walletBefore - (await usdcOf(owner.address))).toBe(amount);

      let acc = await readAccount(pub, safe, dep.blockNumber);
      expect(acc.principal).toBeGreaterThanOrEqual(amount - 1n);
      expect(acc.yieldAvailable).toBeLessThanOrEqual(2n);

      // 3. 30 days of yield
      await pub.request({ method: "evm_increaseTime", params: [30 * 24 * 3600] } as never);
      await pub.request({ method: "evm_mine", params: [] } as never);
      acc = await readAccount(pub, safe, dep.blockNumber);
      expect(acc.yieldAvailable).toBeGreaterThan(1_000_000n); // > 1 USDC on 1000 over 30 days
      expect(acc.liquidityRate).toBeGreaterThan(0n);

      // 4. spend yield only: withdraw to the Safe, then send onward to the wallet in one batched Safe tx
      const y = maxYieldWithdrawal(acc);
      const walletBeforeYield = await usdcOf(owner.address);
      await safeExec(safe, [
        { to: ARBITRUM.aavePool, data: withdrawYieldData(y, safe) },
        { to: ARBITRUM.usdc, data: transferData(owner.address, y) },
      ]);
      expect((await usdcOf(owner.address)) - walletBeforeYield).toBe(y);
      acc = await readAccount(pub, safe, dep.blockNumber);
      expect(acc.principal).toBeGreaterThanOrEqual(amount - 1n); // principal untouched by a yield withdrawal
      expect(acc.principal).toBeLessThanOrEqual(amount);
      expect(acc.yieldAvailable).toBeLessThan(y / 10n); // what remains is only the few seconds accrued since

      // 5. over-asking is rejected on-chain (the Safe cannot be tricked into breaching principal by the UI math alone)
      const tooMuch = acc.aBalance + 1_000_000n;
      await expect(pub.call({ account: owner.address, to: safe, data: execCalldata(owner.address, ARBITRUM.aavePool, withdrawYieldData(tooMuch, safe)) })).rejects.toThrow();

      // 6. principal exit goes to the wallet and reduces principal
      const half = amount / 2n;
      await safeExec(safe, [{ to: ARBITRUM.aavePool, data: withdrawPrincipalData(half, owner.address) }]);
      acc = await readAccount(pub, safe, dep.blockNumber);
      expect(acc.principal).toBeLessThanOrEqual(amount - half);
      expect(acc.principal).toBeGreaterThanOrEqual(amount - half - 1n);
    } finally {
      await pub.request({ method: "evm_revert", params: [snap] } as never);
    }
  }, 180_000);
});
