/**
 * Runs the app's own Morpho libraries against an Anvil fork of Robinhood Chain. Needs:
 *   anvil --fork-url https://rpc.mainnet.chain.robinhood.com --chain-id 31337 --port 8546
 *   FORK_RH=1 npx vitest run tests/integration/safe-morpho-fork.test.ts
 * Nothing touches a real network; the key below is Anvil's public dev key #0. USDG is funded by impersonating Morpho Blue
 * (which holds it) on the fork only.
 */
import { createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, getAddress, http, parseUnits, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { morphoVaultV2Abi } from "../../src/lib/contracts/abis/MorphoVaultV2";
import { ROBINHOOD } from "../../src/lib/contracts/robinhood";
import { approveData, depositData, readMorphoAccount, simulateWithdrawal, withdrawToData, withdrawYieldData } from "../../src/lib/morpho/account";
import { checkMorphoRequest, morphoLimits } from "../../src/lib/morpho/position";
import { transferData } from "../../src/lib/aave/account";
import { execCalldata, predictSafeAddress, readCreationCode, safeAbi, safeCall, safeFactoryAbi, safeSetup, withGasBuffer } from "../../src/lib/safe/safe";

const RPC = process.env.FORK_RPC_RH ?? "http://127.0.0.1:8546";
const chain = { id: 31337, name: "RH fork", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;
const owner = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account: owner, chain, transport: http(RPC) });
const RECIPIENT: Address = "0x00000000000000000000000000000000000b0b0b";
const USDG = ROBINHOOD.usdg;
const VAULT = ROBINHOOD.steakhouseUsdgVault;

const d = describe.skipIf(process.env.FORK_RH !== "1");
const rpcCall = (method: string, params: unknown[]) => pub.request({ method, params } as never);

const send = async (to: Address, data: `0x${string}`) => {
  await pub.call({ account: owner.address, to, data }); // simulate first: surfaces revert reasons before sending
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
const usdgOf = (a: Address) => pub.readContract({ address: USDG, abi: erc20Abi, functionName: "balanceOf", args: [a] });

d("Safe + Morpho Steakhouse USDG on the Robinhood Chain fork (app libraries)", () => {
  it("deposit, accrue, spend yield only, spend principal, all without a revert", async () => {
    const snap = (await rpcCall("evm_snapshot", [])) as string;
    try {
      expect(await pub.getChainId()).toBe(31337);
      // Fund: gas for the owner, and USDG from Morpho Blue (a real holder on this chain)
      await rpcCall("anvil_setBalance", [owner.address, "0x56BC75E2D63100000"]);
      await rpcCall("anvil_setBalance", [ROBINHOOD.morphoBlue, "0x56BC75E2D63100000"]);
      await rpcCall("anvil_impersonateAccount", [ROBINHOOD.morphoBlue]);
      const fund = await pub.request({ method: "eth_sendTransaction", params: [{ from: ROBINHOOD.morphoBlue, to: USDG, data: transferData(owner.address, parseUnits("5000", 6)) }] } as never);
      await pub.waitForTransactionReceipt({ hash: fund as `0x${string}` });
      expect(await usdgOf(owner.address)).toBeGreaterThanOrEqual(parseUnits("5000", 6));

      // 1. The Safe is created by the same helpers as on Arbitrum, and lands on the predicted address
      const predicted = predictSafeAddress(owner.address, await readCreationCode(pub));
      expect(await pub.getCode({ address: predicted })).toBeUndefined();
      const { initializer, saltNonce } = safeSetup(owner.address);
      await send(ROBINHOOD.safeProxyFactory, encodeFunctionData({ abi: safeFactoryAbi, functionName: "createProxyWithNonce", args: [ROBINHOOD.safeL2Singleton, initializer, saltNonce] }));
      const safe = getAddress(predicted);
      expect(await pub.getCode({ address: safe })).toBeDefined();
      expect(await pub.readContract({ address: safe, abi: safeAbi, functionName: "getOwners" })).toEqual([owner.address]);
      const creationBlock = await pub.getBlockNumber();

      // 2. Deposit 1,000 USDG for the Safe: exact approval, then deposit(assets, safe)
      await send(USDG, approveData(parseUnits("1000", 6)));
      await send(VAULT, depositData(parseUnits("1000", 6), safe));
      expect(await pub.readContract({ address: VAULT, abi: erc20Abi, functionName: "allowance", args: [owner.address, VAULT] })).toBe(0n);
      let a = await readMorphoAccount(pub, safe, creationBlock);
      expect(a.principal).toBe(parseUnits("1000", 6)); // principal is exactly what was deposited
      expect(a.shares).toBeGreaterThan(0n);
      expect(a.aBalance).toBeGreaterThanOrEqual(parseUnits("999.99", 6)); // rounding can cost a base unit or two
      expect(a.events.map((e) => e.kind)).toEqual(["deposit"]);

      // 3. 30 days pass on the fork
      await rpcCall("evm_increaseTime", [30 * 24 * 3600]);
      await rpcCall("evm_mine", []);
      a = await readMorphoAccount(pub, safe, creationBlock);
      console.log(`after 30 days: assets=${a.aBalance} principal=${a.principal} yield=${a.yieldAvailable} idle=${a.idleAssets}`);
      expect(a.principal).toBe(parseUnits("1000", 6));
      expect(a.yieldAvailable).toBeGreaterThan(0n); // 30 days of the vault's rate
      // VaultV2 reports 0 from maxWithdraw even with funds present: that is why liquidity is checked by simulation instead
      expect(await pub.readContract({ address: VAULT, abi: morphoVaultV2Abi, functionName: "maxWithdraw", args: [safe] })).toBe(0n);

      // 4. Pay from YIELD (only when some was earned): Safe withdraws exactly that and sends it on, in ONE Safe transaction
      const lim = morphoLimits(a);
      if (lim.yield > 0n) {
        const y = lim.yield;
        expect(checkMorphoRequest("yield", y, a).ok).toBe(true);
        expect(checkMorphoRequest("yield", y + 2n, a).ok).toBe(false);
        expect((await simulateWithdrawal(pub, safe, withdrawYieldData(y, safe))).ok).toBe(true);
        const before = await usdgOf(RECIPIENT);
        await safeExec(safe, [{ to: VAULT, data: withdrawYieldData(y, safe) }, { to: USDG, data: transferData(RECIPIENT, y) }]);
        expect((await usdgOf(RECIPIENT)) - before).toBe(y);
        expect(await usdgOf(safe)).toBe(0n); // nothing stranded in the Safe
        a = await readMorphoAccount(pub, safe, creationBlock);
        expect(a.principal).toBe(parseUnits("1000", 6)); // yield spend never touches principal
      } else {
        console.log("no yield accrued on the fork after 30 days: yield-spend path skipped (see report)");
      }

      // 5. Pay from PRINCIPAL: Safe withdraws exactly 100 USDG straight to the recipient
      const before = await usdgOf(RECIPIENT);
      expect(checkMorphoRequest("principal", parseUnits("100", 6), a).ok).toBe(true);
      expect(checkMorphoRequest("principal", parseUnits("1000.000001", 6), a).ok).toBe(false);
      expect((await simulateWithdrawal(pub, safe, withdrawToData(parseUnits("100", 6), RECIPIENT, safe))).ok).toBe(true);
      // more than the Safe holds: the vault itself refuses, and the simulation says so before anything is sent
      const tooMuch = await simulateWithdrawal(pub, safe, withdrawToData(parseUnits("5000", 6), RECIPIENT, safe));
      expect(tooMuch.ok).toBe(false);
      await safeExec(safe, [{ to: VAULT, data: withdrawToData(parseUnits("100", 6), RECIPIENT, safe) }]);
      expect((await usdgOf(RECIPIENT)) - before).toBe(parseUnits("100", 6));
      expect(await usdgOf(safe)).toBe(0n);
      a = await readMorphoAccount(pub, safe, creationBlock);
      expect(a.principal).toBe(parseUnits("900", 6)); // principal fell by exactly what was spent from it
      expect(a.events.map((e) => e.kind)).toContain("withdraw");

    } finally {
      await rpcCall("evm_revert", [snap]);
    }
  }, 180_000);
});
