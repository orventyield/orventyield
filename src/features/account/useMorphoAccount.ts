"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { encodeFunctionData, erc20Abi, getAddress, type Address, type Hex } from "viem";
import { useAccount, useBalance, useChainId, useConfig, usePublicClient, useSendTransaction, useSwitchChain } from "wagmi";
import { findSafeCreationBlock, transferData } from "@/lib/aave/account";
import { fmtUsdc } from "@/lib/aave/format";
import { ROBINHOOD, ROBINHOOD_CHAIN_ID } from "@/lib/contracts/robinhood";
import { approveData, assertMorphoInnerCalls, assertMorphoTarget, depositData, readMorphoAccount, simulateWithdrawal, withdrawToData, withdrawYieldData } from "@/lib/morpho/account";
import { checkMorphoRequest, morphoLimits } from "@/lib/morpho/position";
import { execCalldata, predictSafeAddress, readCreationCode, safeCall, safeFactoryAbi, safeSetup, withGasBuffer } from "@/lib/safe/safe";
import { ARBITRUM_CHAIN_ID } from "@/lib/contracts/arbitrum";
import { switchOrAddChain } from "@/lib/chainSwitch";
import { LOCAL_FORK_CHAIN_ID, LOCAL_FORK_ENABLED } from "@/lib/wagmi";
import { friendlyTxError } from "./errors";
import { createTxLock } from "@/lib/txLock";
import { gasWarning } from "@/lib/yieldEngine";
import { blockKey, readCache, writeCache, type TxStep } from "./useSafeAccount";

interface PlanStep {
  id: string;
  label: string;
  detail: string;
  to: Address;
  data: Hex;
  skip?: boolean;
  /** The calls a Safe step makes on the user's behalf; checked against the allowlist before the wallet is asked to sign. */
  inner?: readonly { to: string }[];
  onDone?: (blockNumber: bigint) => void;
}

/**
 * The user's own Safe + Morpho Steakhouse USDG position on Robinhood Chain (or the local Anvil fork in development).
 * Same shape and rules as useSafeAccount (the Aave engine): reads come from the public RPC from any wallet network, writes are
 * simulate -> send -> receipt -> refetch, and the wallet is switched to Robinhood Chain only when a write needs it.
 * Money is USDG (6 decimals), bigint end to end. `active: false` pauses every read.
 */
export function useMorphoAccount({ active = true }: { active?: boolean } = {}) {
  const { address: owner, isConnected } = useAccount();
  const walletChainId = useChainId();
  const onFork = LOCAL_FORK_ENABLED && walletChainId === LOCAL_FORK_CHAIN_ID;
  const chainId = onFork ? LOCAL_FORK_CHAIN_ID : ROBINHOOD_CHAIN_ID;
  const wrongChain = isConnected && walletChainId !== ROBINHOOD_CHAIN_ID && !onFork;
  const client = usePublicClient({ chainId });
  const qc = useQueryClient();
  const { switchChain, switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const wagmiConfig = useConfig();
  const walletChainName = wagmiConfig.chains.find((c) => c.id === walletChainId)?.name;
  const enabled = active && !!owner && !!client;

  const safeQ = useQuery({
    queryKey: ["mo-safe-address", chainId, owner],
    enabled,
    staleTime: Infinity,
    queryFn: async () => predictSafeAddress(owner!, await readCreationCode(client!)),
  });
  const safe = safeQ.data;

  const deployedQ = useQuery({
    queryKey: ["mo-safe-deployed", chainId, safe],
    enabled: enabled && !!safe,
    refetchInterval: (q) => (q.state.data ? false : 15_000),
    queryFn: async () => (await client!.getCode({ address: safe! })) !== undefined,
  });
  const deployed = deployedQ.data === true;

  const walletQ = useQuery({
    queryKey: ["mo-wallet-usdg", chainId, owner, safe],
    enabled,
    refetchInterval: 20_000,
    queryFn: async () => ({
      usdg: await client!.readContract({ address: ROBINHOOD.usdg, abi: erc20Abi, functionName: "balanceOf", args: [owner!] }),
      allowance: await client!.readContract({ address: ROBINHOOD.usdg, abi: erc20Abi, functionName: "allowance", args: [owner!, ROBINHOOD.steakhouseUsdgVault] }),
      safeUsdg: safe ? await client!.readContract({ address: ROBINHOOD.usdg, abi: erc20Abi, functionName: "balanceOf", args: [safe] }) : 0n,
    }),
  });
  const eth = useBalance({ address: owner, chainId, query: { enabled, refetchInterval: 30_000 } });

  const accountQ = useQuery({
    queryKey: ["mo-account", chainId, safe],
    enabled: enabled && !!safe && deployed,
    refetchInterval: 30_000,
    queryFn: async () => {
      const key = blockKey(chainId, safe!);
      let from = readCache(key) ? BigInt(readCache(key)!) : null;
      const head = await client!.getBlockNumber();
      if (from !== null && from > head) {
        from = null; // Stale or corrupt future block in localStorage
      }
      if (from === null) {
        from = await findSafeCreationBlock(client!, safe!, 0n, ROBINHOOD.safeProxyFactory);
        if (from === null) throw new Error("Could not locate your Safe's creation block.");
        writeCache(key, from.toString());
      }
      return readMorphoAccount(client!, safe!, from);
    },
  });
  const snap = accountQ.data;

  // ---- writes: simulate -> send -> receipt -> refetch ----
  const [steps, setSteps] = useState<TxStep[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDone, setLastDone] = useState<string | null>(null);
  const runId = useRef(0);
  const lock = useRef(createTxLock());

  // A different account (or a disconnect) must never inherit the previous one's progress or a stale completion message.
  useEffect(() => {
    runId.current++;
    setSteps([]);
    setError(null);
    setLastDone(null);
  }, [owner]);

  const refetchAll = useCallback(async () => {
    await Promise.all(["mo-safe-deployed", "mo-wallet-usdg", "mo-account"].map((k) => qc.invalidateQueries({ queryKey: [k, chainId] })));
    await eth.refetch();
  }, [qc, chainId, eth]);

  const run = useCallback(
    async (plan: PlanStep[], doneMessage: string) => {
      if (!owner || !client || busy) return false;
      // A fast double click or a second tap is refused here, before a second wallet prompt can open.
      if (!lock.current.tryAcquire()) return false;
      const todo = plan.filter((p) => !p.skip);
      const my = ++runId.current;
      setBusy(true);
      setError(null);
      setLastDone(null);
      setSteps(todo.map((p) => ({ id: p.id, label: p.label, detail: p.detail, status: "todo" })));
      const mark = (id: string, patch: Partial<TxStep>) => setSteps((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
      try {
        // Reads work from any network; a Robinhood write needs the wallet on Robinhood Chain. Automatically add and switch if needed.
        if (wrongChain) {
          mark(todo[0]!.id, { status: "wallet" });
          await switchOrAddChain(wagmiConfig, ROBINHOOD_CHAIN_ID);
        }
        for (const step of todo) {
          assertMorphoTarget(step.to, safe); // refuse any target outside the allowlist before the wallet is asked to sign
          if (step.inner) assertMorphoInnerCalls(step.inner);
          mark(step.id, { status: "wallet" });
          await client.call({ account: owner, to: step.to, data: step.data }); // simulate: throws with the revert reason
          let gas: bigint | undefined;
          try {
            gas = withGasBuffer(await client.estimateGas({ account: owner, to: step.to, data: step.data }));
          } catch {
            gas = undefined;
          }
          const hash = await sendTransactionAsync({ to: step.to, data: step.data, chainId, gas });
          mark(step.id, { status: "pending", hash });
          const receipt = await client.waitForTransactionReceipt({ hash });
          if (receipt.status !== "success") throw new Error("execution reverted");
          step.onDone?.(receipt.blockNumber);
          mark(step.id, { status: "done" });
        }
        await refetchAll();
        if (runId.current === my) setLastDone(doneMessage);
        return true;
      } catch (e) {
        setSteps((s) => s.map((x) => (x.status === "wallet" || x.status === "pending" ? { ...x, status: "failed" } : x)));
        setError(friendlyTxError(e));
        await refetchAll();
        return false;
      } finally {
        setBusy(false);
        lock.current.release();
      }
    },
    [owner, client, busy, sendTransactionAsync, chainId, refetchAll, safe, wrongChain, switchChainAsync, eth.data?.value],
  );

  const safeStep = useCallback(
    (id: string, label: string, detail: string, calls: Parameters<typeof safeCall>[0]): PlanStep => {
      const c = safeCall(calls);
      return { id, label, detail, to: safe!, data: execCalldata(owner!, c.to, c.data, c.operation), inner: calls };
    },
    [safe, owner],
  );

  /** Refuse an amount the source cannot cover, then ask the vault itself (simulated as the Safe) whether it will pay it out now. */
  const guardWithdrawal = useCallback(
    async (source: "yield" | "principal", amount: bigint, data: Hex): Promise<boolean> => {
      if (!owner || !safe || !snap || !client) return false;
      const ok = checkMorphoRequest(source, amount, snap);
      if (!ok.ok) {
        setError(ok.reason);
        return false;
      }
      const sim = await simulateWithdrawal(client, safe, data);
      if (!sim.ok) {
        setError(sim.reason);
        return false;
      }
      return true;
    },
    [owner, safe, snap, client],
  );

  const deposit = useCallback(
    (amount: bigint) => {
      if (!owner || !safe || amount <= 0n) return;
      const { initializer, saltNonce } = safeSetup(owner);
      const allowance = walletQ.data?.allowance ?? 0n;
      return run(
        [
          {
            id: "deploy",
            label: "Create your Safe",
            detail: `Safe v1.4.1 factory deploys your personal smart account ${safe.slice(0, 6)}…${safe.slice(-4)} on Robinhood Chain. You are its only owner.`,
            to: ROBINHOOD.safeProxyFactory,
            data: encodeFunctionData({ abi: safeFactoryAbi, functionName: "createProxyWithNonce", args: [ROBINHOOD.safeL2Singleton, initializer, saltNonce] }),
            skip: deployed,
            onDone: (b) => writeCache(blockKey(chainId, safe), b.toString()),
          },
          {
            id: "approve",
            label: "Approve USDG",
            detail: `Lets the Steakhouse USDG vault take exactly ${fmtUsdc(amount)} USDG from your wallet, nothing more.`,
            to: ROBINHOOD.usdg,
            data: approveData(amount),
            skip: allowance >= amount,
          },
          {
            id: "deposit",
            label: "Deposit into the vault",
            detail: `Deposits ${fmtUsdc(amount)} USDG into the Morpho Steakhouse USDG vault. The position belongs to your Safe and earns yield.`,
            to: ROBINHOOD.steakhouseUsdgVault,
            data: depositData(amount, safe),
          },
        ],
        `Deposited ${fmtUsdc(amount)} USDG. It is now earning yield in your Safe.`,
      );
    },
    [owner, safe, deployed, walletQ.data, run, chainId],
  );

  /** Withdraw accrued yield only. Defaults to sending it on to the connected wallet in the same Safe transaction. */
  const withdrawYield = useCallback(
    async (amount: bigint, toWallet = true) => {
      if (!owner || !safe) return;
      if (!(await guardWithdrawal("yield", amount, withdrawYieldData(amount, safe)))) return;
      const calls = [{ to: ROBINHOOD.steakhouseUsdgVault, data: withdrawYieldData(amount, safe) }, ...(toWallet ? [{ to: ROBINHOOD.usdg, data: transferData(owner, amount) }] : [])];
      return run(
        [safeStep("withdraw-yield", "Withdraw yield", `Your Safe withdraws ${fmtUsdc(amount)} USDG of earned yield from the vault and sends it to your wallet.`, calls)],
        `Withdrew ${fmtUsdc(amount)} USDG of yield.`,
      );
    },
    [owner, safe, guardWithdrawal, run, safeStep],
  );

  /** Transfer any idle USDG sitting inside the Safe directly to the owner's wallet. */
  const withdrawSafeUsdg = useCallback(
    async (amount: bigint) => {
      if (!owner || !safe || amount <= 0n) return;
      return run(
        [safeStep("withdraw-safe-usdg", "Transfer USDG to wallet", `Your Safe transfers ${fmtUsdc(amount)} USDG to your wallet.`, [{ to: ROBINHOOD.usdg, data: transferData(owner, amount) }])],
        `Transferred ${fmtUsdc(amount)} USDG from your Safe to your wallet.`,
      );
    },
    [owner, safe, run, safeStep],
  );

  /**
   * Supply USDG that is already in the Safe (e.g. just bridged in) to the Morpho vault, in ONE Safe transaction: approve
   * exactly `amount` to the vault, then deposit for the Safe. Creates the Safe first if the bridge landed before it existed.
   */
  const supplyIdle = useCallback(
    (amount: bigint) => {
      if (!owner || !safe || amount <= 0n) return;
      const { initializer, saltNonce } = safeSetup(owner);
      return run(
        [
          {
            id: "deploy",
            label: "Create your Safe",
            detail: `Safe v1.4.1 factory deploys your personal smart account ${safe.slice(0, 6)}…${safe.slice(-4)} on Robinhood Chain. You are its only owner.`,
            to: ROBINHOOD.safeProxyFactory,
            data: encodeFunctionData({ abi: safeFactoryAbi, functionName: "createProxyWithNonce", args: [ROBINHOOD.safeL2Singleton, initializer, saltNonce] }),
            skip: deployed,
            onDone: (b) => writeCache(blockKey(chainId, safe), b.toString()),
          },
          safeStep(
            "supply-idle",
            "Deposit into Morpho Vault",
            `Your Safe supplies the ${fmtUsdc(amount)} USDG it holds to the Morpho Steakhouse USDG vault (exact-amount approval), where it earns yield.`,
            [
              { to: ROBINHOOD.usdg, data: approveData(amount) },
              { to: ROBINHOOD.steakhouseUsdgVault, data: depositData(amount, safe) },
            ],
          ),
        ],
        `Deposited ${fmtUsdc(amount)} USDG. It is now earning yield in your Safe.`,
      );
    },
    [owner, safe, deployed, run, chainId, safeStep],
  );

  /** Principal exit straight to the connected wallet. */
  const withdrawPrincipal = useCallback(
    async (amount: bigint) => {
      if (!owner || !safe) return;
      const data = withdrawToData(amount, owner, safe);
      if (!(await guardWithdrawal("principal", amount, data))) return;
      return run([safeStep("withdraw-principal", "Withdraw principal", `Your Safe withdraws ${fmtUsdc(amount)} USDG of principal from the vault straight to your wallet.`, [{ to: ROBINHOOD.steakhouseUsdgVault, data }])], `Withdrew ${fmtUsdc(amount)} USDG of principal to your wallet.`);
    },
    [owner, safe, guardWithdrawal, run, safeStep],
  );

  /** Pay a third party from earned yield only, in ONE Safe transaction: withdraw exactly `amount` to the Safe, send exactly that on. */
  const payFromYield = useCallback(
    async (amount: bigint, to: Address, label: string): Promise<boolean> => {
      if (!owner || !safe) return false;
      if (!(await guardWithdrawal("yield", amount, withdrawYieldData(amount, safe)))) return false;
      return run(
        [safeStep("pay-yield", `Pay ${label}`, `Your Safe withdraws ${fmtUsdc(amount)} USDG of earned yield from the vault and sends exactly that to ${to.slice(0, 6)}…${to.slice(-4)}. Principal is untouched.`, [{ to: ROBINHOOD.steakhouseUsdgVault, data: withdrawYieldData(amount, safe) }, { to: ROBINHOOD.usdg, data: transferData(to, amount) }])],
        `Paid ${fmtUsdc(amount)} USDG from your yield.`,
      );
    },
    [owner, safe, guardWithdrawal, run, safeStep],
  );

  /** Pay a third party from the PRINCIPAL, in ONE Safe transaction: the vault pays `amount` straight to `to`. An explicit choice. */
  const payFromPrincipal = useCallback(
    async (amount: bigint, to: Address, label: string): Promise<boolean> => {
      if (!owner || !safe) return false;
      const data = withdrawToData(amount, to, safe);
      if (!(await guardWithdrawal("principal", amount, data))) return false;
      return run(
        [safeStep("pay-principal", `Pay ${label} from principal`, `Your Safe withdraws exactly ${fmtUsdc(amount)} USDG of your deposited principal from the vault and sends it to ${to.slice(0, 6)}…${to.slice(-4)}. The rest keeps earning yield.`, [{ to: ROBINHOOD.steakhouseUsdgVault, data }])],
        `Paid ${fmtUsdc(amount)} USDG from your principal.`,
      );
    },
    [owner, safe, guardWithdrawal, run, safeStep],
  );

  const execFromSafe = useCallback(
    async (calls: Parameters<typeof safeCall>[0], label: string, detail: string): Promise<boolean> => {
      if (!owner || !safe || calls.length === 0) return false;
      return run([safeStep("safe-exec", label, detail, calls)], `${label} done.`);
    },
    [owner, safe, run, safeStep],
  );

  const status = !isConnected ? "disconnected" : safeQ.isError || accountQ.isError || walletQ.isError ? "error" : safeQ.isLoading || deployedQ.isLoading || walletQ.isLoading || (deployed && accountQ.isLoading) ? "loading" : "ready";
  const limits = useMemo(() => (snap ? morphoLimits(snap) : { yield: 0n, principal: 0n }), [snap]);

  return {
    status,
    owner: owner as Address | undefined,
    safe: safe ? (getAddress(safe) as Address) : undefined,
    deployed,
    /** USDG in the connected wallet (6 decimals). */
    walletUsdg: walletQ.data?.usdg ?? 0n,
    /** USDG sitting idle in the Safe (6 decimals). */
    safeUsdg: walletQ.data?.safeUsdg ?? 0n,
    walletEth: eth.data?.value ?? 0n,
    snapshot: snap,
    limits,
    steps,
    busy,
    error,
    lastDone,
    clearMessages: () => {
      setError(null);
      setLastDone(null);
      setSteps([]);
    },
    deposit,
    supplyIdle,
    withdrawYield,
    withdrawPrincipal,
    withdrawSafeUsdg,
    payFromYield,
    payFromPrincipal,
    execFromSafe,
    /** Upfront warning to show above the action buttons: no ETH for gas on Robinhood Chain. Null when fine or still loading. */
    gasWarning: gasWarning("morpho", enabled ? eth.data?.value : undefined),
    onFork,
    wrongChain,
    walletChainName,
    switchToRobinhood: () => void switchOrAddChain(wagmiConfig, ROBINHOOD_CHAIN_ID),
    switchToArbitrum: () => void switchOrAddChain(wagmiConfig, ARBITRUM_CHAIN_ID),
    /** When the position was last read (ms), for the display-only ticking yield. */
    fetchedAt: accountQ.dataUpdatedAt,
  };
}
