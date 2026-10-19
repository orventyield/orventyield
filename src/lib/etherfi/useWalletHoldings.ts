"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { useBalance, useReadContracts } from "wagmi";
import { erc20Abi } from "../contracts/abis";
import { OPTIMISM_COLLATERAL, verifiedAddress } from "../contracts/etherfi";
import { priceProviderAbi } from "./abi";
import { valueHoldings, type WalletValue } from "./walletHoldings";

const CHAIN = 10;
/** The assets people actually hold; the full registry has 28. */
const TRACKED = ["USDC", "USDT", "weETH", "WETH", "OP"] as const;

/** Live Optimism balances of a wallet, valued with Ether.fi's own oracle and collateral parameters. */
export function useWalletHoldings(owner: Address | null): { loading: boolean; value: WalletValue | null } {
  const tokens = useMemo(() => OPTIMISM_COLLATERAL.filter((t) => (TRACKED as readonly string[]).includes(t.symbol)), []);
  const priceProvider = verifiedAddress(CHAIN, "PriceProvider");
  const enabled = !!owner && !!priceProvider;

  const eth = useBalance({ address: owner ?? undefined, chainId: CHAIN, query: { enabled: !!owner } });
  const balances = useReadContracts({
    contracts: owner ? tokens.map((t) => ({ chainId: CHAIN, address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [owner] }) as const) : [],
    query: { enabled },
  });
  const wethAddress = tokens.find((t) => t.symbol === "WETH")!.address;
  const prices = useReadContracts({
    contracts: priceProvider ? [...tokens.map((t) => t.address), wethAddress].map((a) => ({ chainId: CHAIN, address: priceProvider, abi: priceProviderAbi, functionName: "price", args: [a] }) as const) : [],
    query: { enabled },
  });

  const value = useMemo(() => {
    if (!enabled || !balances.data || !prices.data || eth.data === undefined) return null;
    const price = (i: number) => {
      const r = prices.data![i];
      return r?.status === "success" ? (r.result as bigint) : 0n;
    };
    const inputs = tokens.map((t, i) => {
      const b = balances.data![i];
      return { symbol: t.symbol, address: t.address, decimals: t.decimals, rawBalance: b?.status === "success" ? (b.result as bigint) : 0n, price6: price(i) };
    });
    inputs.push({ symbol: "ETH", address: "native" as never, decimals: 18, rawBalance: eth.data.value, price6: price(tokens.length) });
    return valueHoldings(inputs);
  }, [enabled, balances.data, prices.data, eth.data, tokens]);

  return { loading: enabled && !value, value };
}
