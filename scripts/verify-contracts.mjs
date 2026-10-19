// Checks every address in the contract registry against a public RPC (eth_getCode).
// Usage: npm run verify:contracts
import { ETHERFI_REGISTRY } from "../src/lib/contracts/etherfi.ts";

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

let drift = 0;
for (const [chainId, chain] of Object.entries(ETHERFI_REGISTRY)) {
  const live = Number.parseInt(await rpc(chain.rpc, "eth_chainId", []), 16);
  console.log(`\n${chain.name} (registry ${chainId}, rpc says ${live})`);
  for (const [name, c] of Object.entries(chain.contracts)) {
    const code = await rpc(chain.rpc, "eth_getCode", [c.address, "latest"]);
    const bytes = (code.length - 2) / 2;
    const hasCode = bytes > 0;
    const expectCode = c.status !== "no-code";
    const ok = hasCode === expectCode;
    if (!ok) drift++;
    console.log(`  ${ok ? "ok   " : "DRIFT"} ${name.padEnd(20)} ${c.address}  ${bytes} bytes  [${c.status}]`);
  }
}
if (drift) {
  console.error(`\n${drift} registry entr${drift === 1 ? "y" : "ies"} no longer match the chain. Update src/lib/contracts/etherfi.ts.`);
  process.exit(1);
}
console.log("\nRegistry matches on-chain code presence.");
