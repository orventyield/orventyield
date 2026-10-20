/** What the user still needs before the bridge transaction can be sent from the chain they picked. Pure, so it is unit tested. */
export type SourceFundsCheck =
  | { kind: "ok" }
  | { kind: "no-gas"; message: string }
  | { kind: "no-funds"; message: string };

export interface SourceFundsInput {
  chainName: string;
  nativeSymbol: string;
  /** Native balance in wei. */
  nativeBalance: bigint;
  /** Paying with the chain's native token itself (then the amount and the gas come out of the same balance). */
  payingNative: boolean;
  tokenSymbol: string;
  tokenDecimals: number;
  tokenBalance: bigint;
  /** The amount the user typed, in the token's base units. 0n while empty. */
  amount: bigint;
}

function fmt(v: bigint, decimals: number): string {
  const s = v.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "").slice(0, 6);
  return frac ? `${whole}.${frac}` : whole;
}

export function checkSourceFunds(i: SourceFundsInput): SourceFundsCheck {
  // Gas first: without any native token nothing can be sent, whatever the amount.
  if (i.nativeBalance <= 0n) {
    return { kind: "no-gas", message: `Insufficient gas on ${i.chainName}. Your wallet needs a little ${i.nativeSymbol} on ${i.chainName} to pay the network fee.` };
  }
  if (i.amount > 0n && i.tokenBalance < i.amount) {
    return {
      kind: "no-funds",
      message: `Insufficient funds: you have ${fmt(i.tokenBalance, i.tokenDecimals)} ${i.tokenSymbol} on ${i.chainName} and need ${fmt(i.amount, i.tokenDecimals)}.${i.payingNative ? " Leave some for gas." : ""}`,
    };
  }
  return { kind: "ok" };
}

/** The always-visible helper line, shown before anything is typed. */
export function gasHint(chainName: string | undefined, nativeSymbol: string | undefined): string {
  return chainName && nativeSymbol
    ? `To send from ${chainName} you need a little ${nativeSymbol} in your wallet for network gas.`
    : "To send from Ethereum, Base, Optimism or Polygon you need a little of that network's native token (ETH, or POL on Polygon) in your wallet for network gas.";
}
