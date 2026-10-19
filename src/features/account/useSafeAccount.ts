"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { erc20Abi, getAddress, type Address, type Hex } from "viem";
import { useAccount, useBalance, useChainId, usePublicClient, useSendTransaction, useSwitchChain } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  approveData, findSafeCreationBlock, readAccount, supplyData, transferData, withdrawPrincipalData, withdrawYieldData,
} from "@/lib/aave/account";
import { maxPrincipalWithdrawal, maxYieldWithdrawal, rayToApy, yieldPerSecond } from "@/lib/aave/position";
import { ARBITRUM, ARBITRUM_CHAIN_ID } from "@/lib/contracts/arbitrum";
import { execCalldata, predictSafeAddress, readCreationCode, safeCall, safeFactoryAbi, safeSetup } from "@/lib/safe/safe";
import { LOCAL_FORK_CHAIN_ID, LOCAL_FORK_ENABLED } from "@/lib/wagmi";
import { encodeFunctionData } from "viem";
import { fmtUsdc } from "@/lib/aave/format";
import { friendlyTxError } from "./errors";

export type StepStatus = "todo" | "wallet" | "pending" | "done" | "failed";
export interface TxStep {
  id: string;
  label: string;
  /** What the user is about to sign, in plain words (frontend rule 4: what, which contract, amount). */
  detail: string;
  status: StepStatus;
  hash?: Hex;
}

const blockKey = (chainId: number, safe: string) => `oy.safeblock.${chainId}.${safe.toLowerCase()}`;
const readCache = (k: string): string | null => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeCache = (k: string, v: string) => {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    /* storage unavailable: the block is re-derived next time */
  }
};

/** The user's own Safe + Aave v3 position on Arbitrum One (or the local Anvil fork in development). */
export function useSafeAccount() {
  const { address: owner, isConnected } = useAccount();
  const walletChainId = useChainId();
  const onFork = LOCAL_FORK_ENABLED && walletChainId === LOCAL_FORK_CHAIN_ID;
  const chainId = onFork ? LOCAL_FORK_CHAIN_ID : ARBITRUM_CHAIN_ID;
  const wrongChain = isConnected && walletChainId !== ARBITRUM_CHAIN_ID && !onFork;
  const client = usePublicClient({ chainId });
  const qc = useQueryClient();
  const { switchChain } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();

  const enabled = !!owner && !!client;

  const safeQ = useQuery({
    queryKey: ["safe-address", chainId, owner],
    enabled,
    staleTime: Infinity,
    queryFn: async () => predictSafeAddress(owner!, await readCreationCode(client!)),
  });
  const safe = safeQ.data;

  const deployedQ = useQuery({
    queryKey: ["safe-deployed", chainId, safe],
    enabled: enabled && !!safe,
    refetchInterval: (q) => (q.state.data ? false : 15_000),
    queryFn: async () => (await client!.getCode({ address: safe! })) !== undefined,
  });
  const deployed = deployedQ.data === true;

  const walletQ = useQuery({
    queryKey: ["wallet-usdc", chainId, owner],
    enabled,
    refetchInterval: 20_000,
    queryFn: async () => ({
      usdc: await client!.readContract({ address: ARBITRUM.usdc, abi: erc20Abi, functionName: "balanceOf", args: [owner!] }),
      allowance: await client!.readContract({ address: ARBITRUM.usdc, abi: erc20Abi, functionName: "allowance", args: [owner!, ARBITRUM.aavePool] }),
    }),
  });
  const eth = useBalance({ address: owner, chainId, query: { enabled, refetchInterval: 30_000 } });

  const [fetchedAt, setFetchedAt] = useState(() => Date.now());
  const accountQ = useQuery({
    queryKey: ["safe-account", chainId, safe],
    enabled: enabled && !!safe && deployed,
    refetchInterval: 30_000,
    queryFn: async () => {
      const key = blockKey(chainId, safe!);
      let from = readCache(key) ? BigInt(readCache(key)!) : null;
      if (from === null) {
        from = await findSafeCreationBlock(client!, safe!);
        if (from === null) throw new Error("Could not locate your Safe's creation block.");
        writeCache(key, from.toString());
      }
      const snap = await readAccount(client!, safe!, from);
      setFetchedAt(Date.now());
      return snap;
    },
  });
  const snap = accountQ.data;

  // Ticking display only; the authoritative number is always the on-chain balance.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const tickingYield = useMemo(() => {
    if (!snap) return 0n;
    const extra = yieldPerSecond(snap.aBalance, snap.liquidityRate) * Math.max(0, (now - fetchedAt) / 1000);
    return snap.yieldAvailable + BigInt(Math.floor(extra));
  }, [snap, now, fetchedAt]);

  // ---- writes: simulate -> send -> receipt -> refetch ----
  const [steps, setSteps] = useState<TxStep[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDone, setLastDone] = useState<string | null>(null);
  const runId = useRef(0);

  const refetchAll = useCallback(async () => {
    await Promise.all(
      ["safe-deployed", "wallet-usdc", "safe-account"].map((k) => qc.invalidateQueries({ queryKey: [k, chainId] })),
    );
    await eth.refetch();
  }, [qc, chainId, eth]);

  const run = useCallback(
    async (plan: { id: string; label: string; detail: string; to: Address; data: Hex; skip?: boolean; onDone?: (blockNumber: bigint) => void }[], doneMessage: string) => {
      if (!owner || !client || busy) return;
      const active = plan.filter((p) => !p.skip);
      const my = ++runId.current;
      setBusy(true);
      setError(null);
      setLastDone(null);
      setSteps(active.map((p) => ({ id: p.id, label: p.label, detail: p.detail, status: "todo" })));
      const mark = (id: string, patch: Partial<TxStep>) => setSteps((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
      try {
        for (const step of active) {
          mark(step.id, { status: "wallet" });
          await client.call({ account: owner, to: step.to, data: step.data }); // simulate: throws with the revert reason
          const hash = await sendTransactionAsync({ to: step.to, data: step.data, chainId });
          mark(step.id, { status: "pending", hash });
          const receipt = await client.waitForTransactionReceipt({ hash });
          if (receipt.status !== "success") throw new Error("execution reverted");
          step.onDone?.(receipt.blockNumber);
          mark(step.id, { status: "done" });
        }
        await refetchAll();
        if (runId.current === my) setLastDone(doneMessage);
      } catch (e) {
        setSteps((s) => s.map((x) => (x.status === "wallet" || x.status === "pending" ? { ...x, status: "failed" } : x)));
        setError(friendlyTxError(e));
        await refetchAll();
      } finally {
        setBusy(false);
      }
    },
    [owner, client, busy, sendTransactionAsync, chainId, refetchAll],
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
            detail: `Safe v1.4.1 factory deploys your personal smart account ${safe.slice(0, 6)}…${safe.slice(-4)}. You are its only owner.`,
            to: ARBITRUM.safeProxyFactory,
            data: encodeFunctionData({ abi: safeFactoryAbi, functionName: "createProxyWithNonce", args: [ARBITRUM.safeL2Singleton, initializer, saltNonce] }),
            skip: deployed,
            onDone: (b) => writeCache(blockKey(chainId, safe), b.toString()),
          },
          {
            id: "approve",
            label: "Approve USDC",
            detail: `Lets the Aave Pool take exactly ${fmtUsdc(amount)} USDC from your wallet, nothing more.`,
            to: ARBITRUM.usdc,
            data: approveData(amount),
            skip: allowance >= amount,
          },
          {
            id: "supply",
            label: "Deposit into Aave",
            detail: `Supplies ${fmtUsdc(amount)} USDC to the Aave v3 Pool. The position belongs to your Safe and earns yield.`,
            to: ARBITRUM.aavePool,
            data: supplyData(amount, safe),
          },
        ],
        `Deposited ${fmtUsdc(amount)} USDC. It is now earning yield in your Safe.`,
      );
    },
    [owner, safe, deployed, walletQ.data, run, chainId],
  );

  const safeStep = useCallback(
    (id: string, label: string, detail: string, calls: Parameters<typeof safeCall>[0]) => {
      const c = safeCall(calls);
      return { id, label, detail, to: safe!, data: execCalldata(owner!, c.to, c.data, c.operation) };
    },
    [safe, owner],
  );

  /** Withdraw accrued yield only. `toWallet` also sends it on to the connected wallet in the same Safe transaction. */
  const withdrawYield = useCallback(
    (amount: bigint, toWallet: boolean) => {
      if (!owner || !safe || !snap || amount <= 0n) return;
      if (amount > maxYieldWithdrawal(snap)) {
        setError("That is more than the yield you have earned. Your principal stays locked.");
        return;
      }
      const calls = [{ to: ARBITRUM.aavePool, data: withdrawYieldData(amount, safe) }, ...(toWallet ? [{ to: ARBITRUM.usdc, data: transferData(owner, amount) }] : [])];
      return run(
        [safeStep("withdraw-yield", "Withdraw yield", `Your Safe withdraws ${fmtUsdc(amount)} USDC of earned yield from Aave${toWallet ? " and sends it to your wallet" : " and keeps it in the Safe"}.`, calls)],
        `Withdrew ${fmtUsdc(amount)} USDC of yield.`,
      );
    },
    [owner, safe, snap, run, safeStep],
  );

  const withdrawPrincipal = useCallback(
    (amount: bigint) => {
      if (!owner || !safe || !snap || amount <= 0n) return;
      if (amount > maxPrincipalWithdrawal(snap)) {
        setError("That is more than your principal.");
        return;
      }
      return run(
        [safeStep("withdraw-principal", "Withdraw principal", `Your Safe withdraws ${fmtUsdc(amount)} USDC of principal from Aave straight to your wallet.`, [{ to: ARBITRUM.aavePool, data: withdrawPrincipalData(amount, owner) }])],
        `Withdrew ${fmtUsdc(amount)} USDC of principal to your wallet.`,
      );
    },
    [owner, safe, snap, run, safeStep],
  );

  const status = !isConnected ? "disconnected" : wrongChain ? "wrong-chain" : safeQ.isError || accountQ.isError || walletQ.isError ? "error" : safeQ.isLoading || deployedQ.isLoading || walletQ.isLoading || (deployed && accountQ.isLoading) ? "loading" : "ready";

  return {
    status,
    owner: owner as Address | undefined,
    onFork,
    safe: safe ? (getAddress(safe) as Address) : undefined,
    deployed,
    walletUsdc: walletQ.data?.usdc ?? 0n,
    walletEth: eth.data?.value ?? 0n,
    snapshot: snap,
    tickingYield,
    apy: snap ? rayToApy(snap.liquidityRate) : null,
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
    withdrawYield,
    withdrawPrincipal,
    switchToArbitrum: () => switchChain({ chainId: ARBITRUM_CHAIN_ID }),
    retry: () => {
      void qc.invalidateQueries();
    },
  };
}
