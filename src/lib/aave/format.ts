/** USDC (6 decimals) formatting and parsing. Money stays bigint; strings are for display and input only. */
export const fmtUsdc = (v: bigint): string => {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / 1_000_000n;
  const frac = (a % 1_000_000n).toString().padStart(6, "0");
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}.${frac.slice(0, 2)}`;
};
export const fmtUsdc4 = (v: bigint): string => {
  const whole = v / 1_000_000n;
  return `${whole.toLocaleString("en-US")}.${(v % 1_000_000n).toString().padStart(6, "0").slice(0, 4)}`;
};

/** Parse "12.5" into USDC base units, or null when invalid (more than 6 decimals, negative, empty, NaN). */
export function parseUsdcInput(s: string): bigint | null {
  const t = s.trim();
  if (!/^\d+(\.\d{0,6})?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  return BigInt(w!) * 1_000_000n + BigInt(f.padEnd(6, "0"));
}

/** Full-precision string for a MAX button: no thousands separators, trailing zeros trimmed. Exact for every bigint (6 decimals). */
export function fmtUsdcFull(v: bigint): string {
  const w = v / 1_000_000n;
  const fr = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fr ? `${w}.${fr}` : `${w}`;
}
