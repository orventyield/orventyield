import { ROBINHOOD, ROBINHOOD_CHAIN_ID } from "../contracts/robinhood";

/**
 * The vault's current net APY, for DISPLAY only (no money decision uses it). The public RPC keeps no historical state, so it
 * cannot be derived on chain from share prices; Morpho's public API publishes it. Any failure returns null and the UI shows
 * "variable" instead of a number.
 */
export const MORPHO_API = "https://blue-api.morpho.org/graphql";

export const APY_QUERY = `{ vaultV2s(first: 1, where: { address_in: ["${ROBINHOOD.steakhouseUsdgVault}"], chainId_in: [${ROBINHOOD_CHAIN_ID}] }) { items { address netApy } } }`;

/** Pull a sane APY (0..1 as a fraction) for exactly the allowlisted vault out of the API response, or null. */
export function parseApyResponse(json: unknown): number | null {
  const items = (json as { data?: { vaultV2s?: { items?: unknown } } } | null)?.data?.vaultV2s?.items;
  if (!Array.isArray(items)) return null;
  const hit = items.find((i) => typeof i?.address === "string" && i.address.toLowerCase() === ROBINHOOD.steakhouseUsdgVault.toLowerCase());
  const apy = hit?.netApy;
  // A negative or absurd number is a data problem, not something to show a user.
  return typeof apy === "number" && Number.isFinite(apy) && apy >= 0 && apy <= 1 ? apy : null;
}

export async function fetchVaultApy(doFetch: typeof fetch = (...a) => fetch(...a), timeoutMs = 8000): Promise<number | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await doFetch(MORPHO_API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: APY_QUERY }), signal: ctl.signal });
    if (!r.ok) return null;
    return parseApyResponse(await r.json());
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const SECONDS_PER_YEAR = 31_536_000;

/** Display-only live yield: the yield read at `fetchedAt`, plus what `assets` earns at `apy` since then. Never negative. */
export function tickYield(baseYield: bigint, assets: bigint, apy: number | null, elapsedMs: number): bigint {
  if (!apy || apy <= 0 || assets <= 0n || elapsedMs <= 0) return baseYield > 0n ? baseYield : 0n;
  const extra = (Number(assets) * apy * (elapsedMs / 1000)) / SECONDS_PER_YEAR;
  return (baseYield > 0n ? baseYield : 0n) + BigInt(Math.floor(extra));
}
