/** Pure helpers for valuing a wallet's tokens against Ether.fi's collateral parameters. */
import { collateralTokenByAddress } from "../contracts/etherfi";

export interface HoldingInput {
  symbol: string;
  address: `0x${string}` | "native";
  decimals: number;
  rawBalance: bigint;
  /** USD price with 6 decimals, as returned by the Ether.fi PriceProvider. */
  price6: bigint;
}

export interface Holding {
  symbol: string;
  units: number;
  priceUsd: number;
  valueUsd: number;
  ltv: number;
}

export interface WalletValue {
  rows: Holding[];
  totalUsd: number;
  /** What the wallet could borrow against if it were all collateral (sum of value x LTV). */
  borrowPowerUsd: number;
}

/** Native ETH is valued and risk-weighted as WETH. */
export function valueHoldings(inputs: HoldingInput[]): WalletValue {
  const rows: Holding[] = [];
  for (const i of inputs) {
    if (i.rawBalance <= 0n || i.price6 <= 0n) continue;
    const units = Number(i.rawBalance) / 10 ** i.decimals;
    const priceUsd = Number(i.price6) / 1e6;
    const meta = i.address === "native" ? collateralTokenByAddress("0x4200000000000000000000000000000000000006") : collateralTokenByAddress(i.address);
    rows.push({ symbol: i.symbol, units, priceUsd, valueUsd: units * priceUsd, ltv: (meta?.ltvBps ?? 0) / 10_000 });
  }
  rows.sort((a, b) => b.valueUsd - a.valueUsd);
  return {
    rows,
    totalUsd: rows.reduce((a, r) => a + r.valueUsd, 0),
    borrowPowerUsd: rows.reduce((a, r) => a + r.valueUsd * r.ltv, 0),
  };
}
