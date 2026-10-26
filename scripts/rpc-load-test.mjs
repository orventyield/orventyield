#!/usr/bin/env node
// RPC load test: N concurrent "users", each doing the dashboard's read cycle against YOUR RPC endpoint. READ-ONLY (no keys,
// no transactions). Use it to check that your private RPC provider survives launch traffic before you ship.
//
//   NEXT_PUBLIC_RPC_ROBINHOOD=https://... node scripts/rpc-load-test.mjs --users 1000 --cycles 3 --concurrency 100
//   node scripts/rpc-load-test.mjs --rpc https://rpc.mainnet.chain.robinhood.com --users 20 --cycles 1     (public endpoint: go gently)
//   node scripts/rpc-load-test.mjs --chain arbitrum --rpc https://arb-mainnet.g.alchemy.com/v2/KEY --users 500
//
// One user cycle = ONE JSON-RPC batch of the reads the app makes per poll (block number, ETH balance, token balance and
// allowance, vault shares, share value, logs filtered by the Safe). With --no-batch each read is its own HTTP request (the
// worst case). Failed requests retry like the app does (3 tries, 200/400/800ms) so you see both the RAW failure rate (what the
// provider did) and the EFFECTIVE one (what a user would see). Exit code 1 when effective success < --min-success (default 99.5).
//
// Run it from a machine/network like your users', and keep to your provider's published limits: this is real traffic.
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const flag = (n) => args.includes(n);

const CHAINS = {
  robinhood: { rpc: process.env.NEXT_PUBLIC_RPC_ROBINHOOD, asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", vault: "0xBeEff033F34C046626B8D0A041844C5d1A5409dd" },
  // Arbitrum: only verified addresses (native USDC); the "vault" reads hit the same token, which costs the provider the same.
  arbitrum: { rpc: process.env.NEXT_PUBLIC_RPC_ARBITRUM, asset: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", vault: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
};
const chainName = arg("--chain", "robinhood");
const chain = CHAINS[chainName];
if (!chain) { console.error("--chain must be robinhood or arbitrum"); process.exit(2); }
const rpc = arg("--rpc", chain.rpc);
if (!rpc || !/^https:\/\//.test(rpc)) { console.error("Give an https RPC with --rpc or NEXT_PUBLIC_RPC_" + chainName.toUpperCase()); process.exit(2); }

const users = Number(arg("--users", 100));
const cycles = Number(arg("--cycles", 3));
const concurrency = Number(arg("--concurrency", 50));
const rampMs = Number(arg("--ramp-ms", 2000));
const minSuccess = Number(arg("--min-success", 99.5));
const batch = !flag("--no-batch");
const pad = (a) => a.toLowerCase().replace("0x", "").padStart(64, "0");
const word = (n) => BigInt(n).toString(16).padStart(64, "0");

// A synthetic but realistic Safe/owner per user (reads of an empty account cost the same as a funded one).
const addr = (i) => "0x" + (BigInt("0x1000000000000000000000000000000000000000") + BigInt(i)).toString(16).padStart(40, "0");

function readsFor(i, head) {
  const owner = addr(i), safe = addr(i + 1_000_000);
  const topicOwner = "0x" + pad(safe);
  return [
    ["eth_blockNumber", []],
    ["eth_getBalance", [owner, "latest"]],
    ["eth_call", [{ to: chain.asset, data: "0x70a08231" + pad(owner) }, "latest"]],                       // balanceOf(owner)
    ["eth_call", [{ to: chain.asset, data: "0xdd62ed3e" + pad(owner) + pad(chain.vault) }, "latest"]],  // allowance(owner, vault)
    ["eth_call", [{ to: chain.vault, data: "0x70a08231" + pad(safe) }, "latest"]],                        // balanceOf(safe)
    ["eth_call", [{ to: chain.vault, data: "0x07a2d13a" + word(10n ** 18n) }, "latest"]],                // convertToAssets(1e18)
    ["eth_getCode", [safe, "latest"]],
    ["eth_getLogs", [{ address: chain.vault, fromBlock: "0x" + Math.max(0, head - 5_000_000).toString(16), toBlock: "latest", topics: [null, null, topicOwner] }]],
  ];
}

const stats = { requests: 0, rawFail: 0, http429: 0, http5xx: 0, timeouts: 0, rpcErr: 0, cyclesOk: 0, cyclesFail: 0, retries: 0 };
const lat = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(body) {
  stats.requests++;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15_000);
  const t0 = performance.now();
  try {
    const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
    lat.push(performance.now() - t0);
    if (res.status === 429) { stats.http429++; return { fail: "429" }; }
    if (res.status >= 500) { stats.http5xx++; return { fail: String(res.status) }; }
    if (!res.ok) return { fail: String(res.status) };
    const json = await res.json();
    const arr = Array.isArray(json) ? json : [json];
    if (arr.some((r) => r.error)) { stats.rpcErr++; return { fail: "rpc-error:" + (arr.find((r) => r.error).error.message ?? "").slice(0, 60) }; }
    return { ok: true };
  } catch (e) {
    if (e?.name === "AbortError") stats.timeouts++;
    return { fail: e?.name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(t);
  }
}

// Same policy as the app's transport: 3 retries with exponential backoff.
async function withRetry(body) {
  let last;
  for (let a = 0; a < 4; a++) {
    const r = await post(body);
    if (r.ok) return r;
    last = r;
    stats.rawFail++;
    if (a < 3) { stats.retries++; await sleep(200 * 2 ** a + Math.random() * 100); }
  }
  return last;
}

async function userCycle(i, head) {
  const reads = readsFor(i, head);
  if (batch) {
    const r = await withRetry(reads.map(([method, params], k) => ({ jsonrpc: "2.0", id: k + 1, method, params })));
    return !!r.ok;
  }
  const rs = await Promise.all(reads.map(([method, params], k) => withRetry({ jsonrpc: "2.0", id: k + 1, method, params })));
  return rs.every((r) => r.ok);
}

const pct = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : 0);

const hb = await post([{ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }]);
if (!hb.ok) { console.error("RPC is not reachable:", hb.fail); process.exit(2); }
const headRes = await (await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) })).json();
const head = parseInt(headRes.result, 16);
stats.requests = 0; lat.length = 0;

console.log(`RPC load test: ${users} users x ${cycles} cycles, concurrency ${concurrency}, ${batch ? "JSON-RPC batch per cycle" : "one HTTP request per read"}, chain ${chainName}`);
console.log(`target: ${new URL(rpc).host} (path hidden)`);
const t0 = performance.now();
let next = 0;
async function worker() {
  for (;;) {
    const job = next++;
    if (job >= users * cycles) return;
    const i = job % users;
    await sleep((rampMs * (job / (users * cycles))) % rampMs * 0.1); // spread the start, no thundering herd
    (await userCycle(i, head)) ? stats.cyclesOk++ : stats.cyclesFail++;
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, users * cycles) }, worker));
const secs = (performance.now() - t0) / 1000;

const total = stats.cyclesOk + stats.cyclesFail;
const effective = (stats.cyclesOk / total) * 100;
console.log(`\nfinished in ${secs.toFixed(1)}s, ${stats.requests} HTTP requests (${(stats.requests / secs).toFixed(1)} req/s)`);
console.log(`cycles ok ${stats.cyclesOk}/${total}  -> EFFECTIVE success ${effective.toFixed(2)}%  (what users would see, after retries)`);
console.log(`raw failures ${stats.rawFail}  (429: ${stats.http429}, 5xx: ${stats.http5xx}, timeouts: ${stats.timeouts}, rpc errors: ${stats.rpcErr})  retries used: ${stats.retries}`);
console.log(`latency per request: p50 ${pct(lat, 50).toFixed(0)}ms  p95 ${pct(lat, 95).toFixed(0)}ms  p99 ${pct(lat, 99).toFixed(0)}ms`);
if (stats.http429) console.log("-> the provider rate-limited you: use a higher plan, add a second provider (NEXT_PUBLIC_RPC_*_2), or lower the polling.");
process.exit(effective >= minSuccess ? 0 : 1);
