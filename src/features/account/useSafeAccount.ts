"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { erc20Abi, getAddress, type Address, type Hex } from "viem";
import { useAccount, useBalance, useChainId, usePublicClient, useConfig, useSendTransaction, useSwitchChain } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  approveData, findSafeCreationBlock, readAccount, supplyData, transferData, withdrawPrincipalData, withdrawYieldData,
} from "@/lib/aave/account";
import { maxPrincipalWithdrawal, maxYieldWithdrawal, rayToApy, yieldPerSecond } from "@/lib/aave/position";
import { ARBITRUM, ARBITRUM_CHAIN_ID } from "@/lib/contracts/arbitrum";
import { execCalldata, predictSafeAddress, readCreationCode, safeCall, safeFactoryAbi, safeSetup, withGasBuffer } from "@/lib/safe/safe";
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

export const blockKey = (chainId: number, safe: string) => `oy.safeblock.${chainId}.${safe.toLowerCase()}`;
export const readCache = (k: string): string | null => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
export const writeCache = (k: string, v: string) => {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    /* storage unavailable: the block is re-derived next time */
  }
};

/** The user's own Safe + Aave v3 position on Arbitrum One (or the local Anvil fork in development). */
/** `active: false` pauses every read (used when the other yield engine is the selected one). */
export function useSafeAccount({ active = true }: { active?: boolean } = {}) {
  const { address: owner, isConnected } = useAccount();
  const walletChainId = useChainId();
  const onFork = LOCAL_FORK_ENABLED && walletChainId === LOCAL_FORK_CHAIN_ID;
  const chainId = onFork ? LOCAL_FORK_CHAIN_ID : ARBITRUM_CHAIN_ID;
  const wrongChain = isConnected && walletChainId !== ARBITRUM_CHAIN_ID && !onFork;
  const client = usePublicClient({ chainId });
  const qc = useQueryClient();
  const { switchChain, switchChainAsync } = useSwitchChain();
  const wagmiConfig = useConfig();
  const walletChainName = wagmiConfig.chains.find((c) => c.id === walletChainId)?.name;
  const { sendTransactionAsync } = useSendTransaction();

  const enabled = active && !!owner && !!client;

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
      if (!owner || !client || busy) return false;
      const active = plan.filter((p) => !p.skip);
      const my = ++runId.current;
      setBusy(true);
      setError(null);
      setLastDone(null);
      setSteps(active.map((p) => ({ id: p.id, label: p.label, detail: p.detail, status: "todo" })));
      const mark = (id: string, patch: Partial<TxStep>) => setSteps((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
      try {
        // Reads work from any network; only an Arbitrum write needs the wallet on Arbitrum. Switch right here, on demand.
        if (wrongChain) {
          mark(active[0]!.id, { status: "wallet" });
          await switchChainAsync({ chainId: ARBITRUM_CHAIN_ID });
        }
        for (const step of active) {
          mark(step.id, { status: "wallet" });
          await client.call({ account: owner, to: step.to, data: step.data }); // simulate: throws with the revert reason
          // Safe transactions get gas headroom (see withGasBuffer); plain wallet transactions keep the wallet's own estimate.
          const gas = step.to.toLowerCase() === safe?.toLowerCase() ? withGasBuffer(await client.estimateGas({ account: owner, to: step.to, data: step.data })) : undefined;
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
      }
    },
    [owner, client, busy, sendTransactionAsync, chainId, refetchAll, safe, wrongChain, switchChainAsync],
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

  /**
   * Pay a third party (e.g. a voucher invoice) from earned yield only, in ONE Safe transaction: the Safe withdraws exactly
   * `amount` of yield from Aave and sends exactly that to `to`. Resolves true once the transaction is confirmed.
   */
  const payFromYield = useCallback(
    async (amount: bigint, to: Address, label: string): Promise<boolean> => {
      if (!owner || !safe || !snap || amount <= 0n) return false;
      if (amount > maxYieldWithdrawal(snap)) {
        setError("That is more than the yield you have earned. Your principal stays locked.");
        return false;
      }
      const calls = [
        { to: ARBITRUM.aavePool, data: withdrawYieldData(amount, safe) },
        { to: ARBITRUM.usdc, data: transferData(to, amount) },
      ];
      return run(
        [safeStep("pay-yield", `Pay ${label}`, `Your Safe withdraws ${fmtUsdc(amount)} USDC of earned yield from Aave and sends exactly that to ${to.slice(0, 6)}…${to.slice(-4)}. Principal is untouched.`, calls)],
        `Paid ${fmtUsdc(amount)} USDC from your yield.`,
      );
    },
    [owner, safe, snap, run, safeStep],
  );

  /**
   * Pay a third party from the PRINCIPAL, in ONE Safe transaction: the Safe withdraws exactly `amount` from Aave straight to
   * `to`. Only for an explicit, user-chosen spend of principal (adding money to the card). The remaining balance keeps earning yield, and
   * the principal figure drops by exactly `amount` (a Withdraw event whose recipient is not the Safe).
   */
  const payFromPrincipal = useCallback(
    async (amount: bigint, to: Address, label: string): Promise<boolean> => {
      if (!owner || !safe || !snap || amount <= 0n) return false;
      if (amount > maxPrincipalWithdrawal(snap)) {
        setError("That is more than your deposited principal.");
        return false;
      }
      return run(
        [safeStep("pay-principal", `Pay ${label} from principal`, `Your Safe withdraws exactly ${fmtUsdc(amount)} USDC of your deposited principal from Aave and sends it to ${to.slice(0, 6)}…${to.slice(-4)}. The rest keeps earning yield.`, [{ to: ARBITRUM.aavePool, data: withdrawPrincipalData(amount, to) }])],
        `Paid ${fmtUsdc(amount)} USDC from your principal.`,
      );
    },
    [owner, safe, snap, run, safeStep],
  );

  /** Run arbitrary, already-validated calls from the Safe in one transaction (e.g. take money back from the card issuer). */
  const execFromSafe = useCallback(
    async (calls: Parameters<typeof safeCall>[0], label: string, detail: string): Promise<boolean> => {
      if (!owner || !safe || calls.length === 0) return false;
      return run([safeStep("safe-exec", label, detail, calls)], `${label} done.`);
    },
    [owner, safe, run, safeStep],
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

  /**
   * Supply USDC that is already in the Safe (e.g. just bridged in) to Aave, in ONE Safe transaction: approve exactly
   * `amount` to the Pool, then supply for the Safe. Creates the Safe first if the bridge landed before it existed.
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
            detail: `Safe v1.4.1 factory deploys your personal smart account ${safe.slice(0, 6)}…${safe.slice(-4)}. You are its only owner.`,
            to: ARBITRUM.safeProxyFactory,
            data: encodeFunctionData({ abi: safeFactoryAbi, functionName: "createProxyWithNonce", args: [ARBITRUM.safeL2Singleton, initializer, saltNonce] }),
            skip: deployed,
            onDone: (b) => writeCache(blockKey(chainId, safe), b.toString()),
          },
          safeStep(
            "supply-idle",
            "Deposit into Aave",
            `Your Safe supplies the ${fmtUsdc(amount)} USDC it holds to the Aave v3 Pool (exact-amount approval), where it earns yield.`,
            [
              { to: ARBITRUM.usdc, data: approveData(amount) },
              { to: ARBITRUM.aavePool, data: supplyData(amount, safe) },
            ],
          ),
        ],
        `Deposited ${fmtUsdc(amount)} USDC. It is now earning yield in your Safe.`,
      );
    },
    [owner, safe, deployed, run, chainId, safeStep],
  );

  const status = !isConnected ? "disconnected" : safeQ.isError || accountQ.isError || walletQ.isError ? "error" : safeQ.isLoading || deployedQ.isLoading || walletQ.isLoading || (deployed && accountQ.isLoading) ? "loading" : "ready";

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
    payFromYield,
    payFromPrincipal,
    execFromSafe,
    withdrawPrincipal,
    supplyIdle,
    /** The wallet is connected on another supported network (reads and bridging still work; Arbitrum writes switch on demand). */
    wrongChain,
    walletChainName,
    switchToArbitrum: () => switchChain({ chainId: ARBITRUM_CHAIN_ID }),
    retry: () => {
      void qc.invalidateQueries();
    },
  };
}
