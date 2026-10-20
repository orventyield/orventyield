"use client";

import { useWidgetEvents, WidgetEvent } from "@lifi/widget";
import { useEffect, useState } from "react";
import { erc20Abi, isAddress, parseUnits, zeroAddress, type Address } from "viem";
import { useAccount, useBalance, useConfig, useReadContracts } from "wagmi";
import { checkSourceFunds, gasHint, type SourceFundsCheck } from "./sourceFunds";

interface Form {
  chainId?: number;
  token?: string;
  amount?: string;
}

/**
 * Watches what the user picks inside the LI.FI widget (source chain, token, amount) and checks their wallet balances, so we
 * can say plainly "Insufficient gas on Base" instead of leaving a disabled button with no reason. Must live in the lazy
 * widget chunk: it imports @lifi/widget.
 */
export function useSourceFunds(): { check: SourceFundsCheck; hint: string } {
  const events = useWidgetEvents();
  const { address } = useAccount();
  const wagmi = useConfig();
  const [form, setForm] = useState<Form>({});

  useEffect(() => {
    const onChange = (e?: { fieldName: string; newValue?: unknown }) => {
      if (!e) return;
      setForm((f) => {
        if (e.fieldName === "fromChain") return { ...f, chainId: typeof e.newValue === "number" ? e.newValue : undefined };
        if (e.fieldName === "fromToken") return { ...f, token: typeof e.newValue === "string" ? e.newValue : undefined };
        if (e.fieldName === "fromAmount") return { ...f, amount: typeof e.newValue === "string" ? e.newValue : undefined };
        return f;
      });
    };
    events.on(WidgetEvent.FormFieldChanged, onChange);
    return () => void events.off(WidgetEvent.FormFieldChanged, onChange);
  }, [events]);

  const chain = wagmi.chains.find((c) => c.id === form.chainId);
  const native = !form.token || form.token.toLowerCase() === zeroAddress;
  const tokenAddress = !native && form.token && isAddress(form.token) ? (form.token as Address) : undefined;
  const enabled = !!address && !!chain;
  const nativeBal = useBalance({ address, chainId: chain?.id, query: { enabled, refetchInterval: 15_000 } });
  const erc20 = useReadContracts({
    allowFailure: false,
    contracts: tokenAddress && address
      ? [
          { address: tokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [address], chainId: chain?.id },
          { address: tokenAddress, abi: erc20Abi, functionName: "decimals", chainId: chain?.id },
          { address: tokenAddress, abi: erc20Abi, functionName: "symbol", chainId: chain?.id },
        ]
      : [],
    query: { enabled: enabled && !!tokenAddress, refetchInterval: 15_000 },
  });
  const tokenBal = erc20.data ? { value: erc20.data[0] as bigint, decimals: erc20.data[1] as number, symbol: erc20.data[2] as string } : undefined;

  const hint = gasHint(chain?.name, chain?.nativeCurrency.symbol);
  if (!enabled || !nativeBal.data) return { check: { kind: "ok" }, hint };
  const tok = native ? nativeBal.data : tokenBal;
  if (!tok) return { check: { kind: "ok" }, hint };
  let amount = 0n;
  try {
    amount = form.amount ? parseUnits(form.amount, tok.decimals) : 0n;
  } catch {
    amount = 0n;
  }
  return {
    hint,
    check: checkSourceFunds({
      chainName: chain.name,
      nativeSymbol: chain.nativeCurrency.symbol,
      nativeBalance: nativeBal.data.value,
      payingNative: native,
      tokenSymbol: tok.symbol,
      tokenDecimals: tok.decimals,
      tokenBalance: tok.value,
      amount,
    }),
  };
}
