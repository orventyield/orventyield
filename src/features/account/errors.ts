/** Turn wallet / RPC failures into one plain sentence for the user. Never shows raw stack traces. */
export function friendlyTxError(e: unknown): string {
  const anyE = e as { name?: string; code?: number; shortMessage?: string; message?: string; cause?: { code?: number; name?: string } } | null;
  const name = anyE?.name ?? "";
  const code = anyE?.code ?? anyE?.cause?.code;
  const msg = `${anyE?.shortMessage ?? ""} ${anyE?.message ?? ""}`.toLowerCase();
  if (code === 4001 || name.includes("UserRejected") || msg.includes("user rejected") || msg.includes("user denied")) {
    return "You cancelled the request in your wallet. Nothing was sent.";
  }
  if (msg.includes("insufficient funds")) return "Not enough ETH for network gas on Arbitrum One.";
  if (msg.includes("chain") && (msg.includes("mismatch") || msg.includes("switch"))) return "Switch your wallet to Arbitrum One and try again.";
  if (msg.includes("execution reverted") || msg.includes("revert")) {
    const reason = /reverted with the following reason:\s*(.+)/i.exec(anyE?.shortMessage ?? anyE?.message ?? "")?.[1];
    return `The transaction would fail${reason ? `: ${reason.trim()}` : ""}. Nothing was sent.`;
  }
  return anyE?.shortMessage || "Something went wrong. Nothing was sent. Please try again.";
}
