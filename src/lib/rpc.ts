import { fallback, http, type Transport } from "wagmi";

/**
 * RPC endpoints in priority order: the dedicated provider (primary), a second provider (secondary), then the chain's public
 * endpoint as the last resort. Empty, non-https and duplicate entries are dropped. The public endpoint alone is rate-limited
 * and "not for production" (Robinhood's own docs), so production should set at least NEXT_PUBLIC_RPC_<CHAIN>.
 */
export function rpcUrlList(primary: string | undefined, secondary: string | undefined, publicUrl: string): string[] {
  const out: string[] = [];
  for (const u of [primary, secondary, publicUrl]) {
    const v = u?.trim();
    if (v && /^https:\/\//.test(v) && !out.includes(v)) out.push(v);
  }
  return out.length ? out : [publicUrl];
}

/**
 * One transport per chain: ordered fallback over the URLs. Each endpoint batches JSON-RPC calls (several reads in one HTTP
 * request) and silently retries 429 / 5xx / timeouts with exponential backoff (200ms, 400ms, 800ms) before the next endpoint
 * is tried. Nothing here rejects to the UI until every endpoint has failed.
 */
export function resilientTransport(urls: string[]): Transport {
  const each = urls.map((u) => http(u, { batch: { wait: 16, batchSize: 50 }, retryCount: 3, retryDelay: 200, timeout: 15_000 }));
  return each.length === 1 ? each[0]! : fallback(each, { rank: false, retryCount: 1 });
}
