"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchVaultApy } from "@/lib/morpho/apy";

/** Net APY of the allowlisted vault (fraction), or null while loading or unavailable. Cached for 5 minutes; one request per tab. */
export function useMorphoApy() {
  const q = useQuery({ queryKey: ["morpho-apy"], queryFn: () => fetchVaultApy(), staleTime: 5 * 60_000, refetchInterval: 5 * 60_000, retry: 1 });
  return { apy: q.data ?? null, loading: q.isLoading };
}
