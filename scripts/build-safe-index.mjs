// Builds a static owner -> Ether.fi Safe index from the Safes' own `OwnersConfigured` events on Optimism.
//
// Why: a Safe cannot be found from a wallet address on-chain (owners are not indexed), but every Safe emits
// OwnersConfigured(address[] owners, bool[] shouldAdd). Scanning those events once gives a complete mapping that the
// app ships as static files (no server) and tops up at runtime with a short scan of the newest blocks.
//
// Output (gitignored): public/safe-index/meta.json and public/safe-index/<xx>.bin, where xx is the first byte of the
// owner address. Each .bin is a sorted array of 40-byte records: owner(20) + safe(20).
//
// Usage: node scripts/build-safe-index.mjs [--from 149400000] [--rpc url[,url...]] [--concurrency 4]
// Re-running resumes from .cache/safe-index, so an interrupted or rate-limited run loses nothing.
import { createPublicClient, http, parseAbiItem } from "viem";
import { optimism } from "viem/chains";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const FROM = BigInt(arg("from", "149400000"));
const RPCS = arg("rpc", "https://optimism.gateway.tenderly.co,https://mainnet.optimism.io").split(",");
const CONCURRENCY = Number(arg("concurrency", "4"));
const CHUNK = 10_000n;
const SAFETY = 30n; // stay behind the head to avoid reorgs
const CACHE = ".cache/safe-index";
const OUT = "public/safe-index";

const ev = parseAbiItem("event OwnersConfigured(address[] owners, bool[] shouldAdd)");
const clients = RPCS.map((url) => createPublicClient({ chain: optimism, transport: http(url, { retryCount: 0, timeout: 30_000 }) }));
let rr = 0;
const pick = () => clients[rr++ % clients.length];
mkdirSync(CACHE, { recursive: true });
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chunkFile = (from) => join(CACHE, `${from}.json`);

async function fetchRange(from, to, depth = 0) {
  // Never give up on a chunk: rotate endpoints and back off, so a rate limit only slows the run down.
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const logs = await pick().getLogs({ event: ev, fromBlock: from, toBlock: to });
      // A log whose data does not decode as (address[], bool[]) is not one of ours: skip it instead of failing the chunk.
      return logs
        .filter((l) => Array.isArray(l.args?.owners) && Array.isArray(l.args?.shouldAdd))
        .map((l) => [Number(l.blockNumber), l.logIndex, l.address.toLowerCase(), l.args.owners.map((o) => o.toLowerCase()), [...l.args.shouldAdd]]);
    } catch (e) {
      // "Invalid params" / result-size errors mean the range holds too many events (there are bursts of thousands
      // in a few hundred blocks): halve it immediately. Anything else (rate limits, timeouts) just backs off.
      const tooBig = /InvalidParams|invalid parameters|limit|too many|10000|range|exceed/i.test(`${e?.name} ${e?.shortMessage ?? e?.message}`);
      if ((tooBig || attempt >= 8) && to - from >= 50n) {
        const mid = from + (to - from) / 2n;
        const left = await fetchRange(from, mid, depth + 1);
        const right = await fetchRange(mid + 1n, to, depth + 1);
        return left.concat(right);
      }
      await sleep(Math.min(30_000, 500 * 2 ** Math.min(attempt, 6)));
    }
  }
  throw new Error(`failed to fetch logs ${from}-${to}`);
}

const head = await (async () => {
  for (const c of clients) {
    try {
      return await c.getBlockNumber();
    } catch {
      /* try the next endpoint */
    }
  }
  throw new Error("no RPC endpoint answered");
})();
const TO = head - SAFETY;
const starts = [];
for (let b = FROM; b <= TO; b += CHUNK) starts.push(b);
const todo = starts.filter((b) => !existsSync(chunkFile(b)) || b + CHUNK - 1n > TO);
console.log(`head ${head}; ${starts.length} chunks (${todo.length} to fetch) from ${FROM} to ${TO}`);

let done = 0;
async function worker() {
  while (todo.length) {
    const from = todo.shift();
    const to = from + CHUNK - 1n > TO ? TO : from + CHUNK - 1n;
    const rows = await fetchRange(from, to);
    // only cache chunks that are fully behind the safety line
    if (to === from + CHUNK - 1n) writeFileSync(chunkFile(from), JSON.stringify(rows));
    else writeFileSync(`${chunkFile(from)}.partial`, JSON.stringify(rows));
    done++;
    if (done % 25 === 0 || todo.length === 0) console.log(`  fetched ${done} chunks, ${todo.length} left`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

// Replay every event in chain order to get each Safe's CURRENT owners.
const events = [];
for (const b of starts) {
  const f = existsSync(chunkFile(b)) ? chunkFile(b) : `${chunkFile(b)}.partial`;
  if (existsSync(f)) for (const e of JSON.parse(readFileSync(f, "utf8"))) events.push(e); // not push(...x): chunks can hold thousands of rows
}
events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const ownersOf = new Map();
for (const [, , safe, owners, add] of events) {
  let set = ownersOf.get(safe);
  if (!set) ownersOf.set(safe, (set = new Set()));
  owners.forEach((o, i) => (add[i] ? set.add(o) : set.delete(o)));
}
const byOwner = new Map();
for (const [safe, set] of ownersOf) for (const o of set) (byOwner.get(o) ?? byOwner.set(o, []).get(o)).push(safe);

// Shard by the owner's first byte; records are sorted so the browser can binary-search them.
const shards = new Map();
for (const [owner, safes] of byOwner) {
  const key = owner.slice(2, 4);
  (shards.get(key) ?? shards.set(key, []).get(key)).push([owner, safes]);
}
let records = 0;
for (let i = 0; i < 256; i++) {
  const key = i.toString(16).padStart(2, "0");
  const rows = (shards.get(key) ?? []).flatMap(([o, safes]) => safes.map((s) => [o, s])).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  const buf = Buffer.alloc(rows.length * 40);
  rows.forEach(([o, s], j) => {
    Buffer.from(o.slice(2), "hex").copy(buf, j * 40);
    Buffer.from(s.slice(2), "hex").copy(buf, j * 40 + 20);
  });
  writeFileSync(join(OUT, `${key}.bin`), buf);
  records += rows.length;
}
writeFileSync(join(OUT, "meta.json"), JSON.stringify({ version: 1, fromBlock: Number(FROM), headBlock: Number(TO), safes: ownersOf.size, owners: byOwner.size, records, generatedAt: new Date().toISOString() }));
console.log(`index built: ${ownersOf.size} Safes, ${byOwner.size} owners, ${records} records, head block ${TO}`);
