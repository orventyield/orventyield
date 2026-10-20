#!/usr/bin/env node
// Bitrefill cards probe (READ-ONLY, charges nothing). Answers what docs.bitrefill.com does not say, with YOUR key:
//   1. Does the catalogue contain prepaid / virtual Visa or Mastercard products, and under which category value?
//   2. What does a card product look like (denominations, currency, field names)?
//   3. (optional) What does an UNPAID usdc_arbitrum invoice for one look like (it only waits for an on-chain USDC transfer)?
//   4. (optional) After you have bought one yourself: which fields does redemption_info contain (names only, never values)?
//
//   BITREFILL_API_KEY=... BITREFILL_BASE_URL=https://... node scripts/bitrefill-cards-probe.mjs [--country US]
//   ... --invoice <productId> <packageId|value> --refund 0xYourAddress      creates an UNPAID invoice, prints its shape
//   ... --order <orderId>                                                    prints redemption_info FIELD NAMES only
//
// Use BITREFILL_API_ID + BITREFILL_API_SECRET instead of the key for a Business account. Secrets come from the environment,
// never from the command line or chat. The output has no secrets, no card numbers, no CVVs: values are shown as types/lengths.
const base = (process.env.BITREFILL_BASE_URL ?? "").replace(/\/$/, "");
const key = process.env.BITREFILL_API_KEY;
const id = process.env.BITREFILL_API_ID;
const secret = process.env.BITREFILL_API_SECRET;
if (!/^https:\/\//.test(base) || !(key || (id && secret))) {
  console.error("Set BITREFILL_BASE_URL (https, from docs.bitrefill.com) and BITREFILL_API_KEY (or BITREFILL_API_ID + BITREFILL_API_SECRET).");
  process.exit(1);
}
const auth = key ? `Bearer ${key}` : `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
const arg = (n, k = 1) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv.slice(i + 1, i + 1 + k) : undefined; };
const country = (arg("--country")?.[0] ?? "US").toUpperCase();

async function call(method, path, body) {
  const res = await fetch(base + path, { method, headers: { authorization: auth, accept: "application/json", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
const shape = (v, depth = 0) => {
  if (Array.isArray(v)) return `array(${v.length})${v.length && depth < 2 ? " of " + shape(v[0], depth + 1) : ""}`;
  if (v && typeof v === "object") return depth >= 2 ? "object" : "{ " + Object.entries(v).map(([k, x]) => `${k}: ${shape(x, depth + 1)}`).join(", ") + " }";
  if (typeof v === "string") return `string(${v.length})`;
  return typeof v;
};
const isCard = (p) => /visa|mastercard|master card|prepaid|virtual card|debit/i.test(`${p.id ?? ""} ${p.name ?? ""} ${JSON.stringify(p.categories ?? p.category ?? "")}`);

// 1 + 2: catalogue
const rows = [];
for (let start = 0; start < 500; start += 50) {
  const r = await call("GET", `/products?limit=50&start=${start}&country=${country}`);
  if (r.status !== 200 || !Array.isArray(r.json?.data)) { console.log(`catalogue page ${start}: HTTP ${r.status} ${r.text.slice(0, 160)}`); break; }
  rows.push(...r.json.data);
  if (r.json.data.length < 50) break;
}
console.log(`\ncatalogue (${country}): ${rows.length} products`);
if (rows[0]) console.log("product fields:", shape(rows[0]));
const cats = new Map();
for (const p of rows) for (const c of [].concat(p.categories ?? p.category ?? [])) cats.set(String(c), (cats.get(String(c)) ?? 0) + 1);
console.log("category values seen:", [...cats.entries()].map(([k, n]) => `${k}(${n})`).join(", ") || "(none)");
const cards = rows.filter(isCard);
console.log(`\ncard-like products (name/id/category matches visa|mastercard|prepaid|virtual|debit): ${cards.length}`);
for (const p of cards.slice(0, 15)) {
  const pk = (p.packages ?? []).map((x) => x.value ?? x.id).slice(0, 8).join("/");
  console.log(`  ${p.id} | ${p.name} | ${p.currency ?? "?"} | packages: ${pk || "-"} | range: ${p.range ? `${p.range.min}-${p.range.max}` : "-"}`);
}
const filtered = await call("GET", `/products?category=cards&limit=5&country=${country}`);
console.log(`\n?category=cards filter: HTTP ${filtered.status}, ${Array.isArray(filtered.json?.data) ? filtered.json.data.length + " rows" : "no data array"}`);

// 3: unpaid invoice shape
const inv = arg("--invoice", 2);
if (inv) {
  const refund = arg("--refund")?.[0];
  if (!refund || !/^0x[0-9a-fA-F]{40}$/.test(refund)) { console.error("--invoice needs --refund 0xYourAddress"); process.exit(3); }
  const [productId, pkg] = inv;
  const line = { product_id: productId, quantity: 1, ...(Number.isNaN(Number(pkg)) ? { package_id: pkg } : { value: Number(pkg) }) };
  // Only usdc_arbitrum: the invoice waits for an on-chain USDC transfer, so creating it can never spend your Bitrefill balance.
  const r = await call("POST", "/invoices", { products: [line], payment_method: "usdc_arbitrum", refund_address: refund });
  console.log(`\nPOST /invoices payment_method=usdc_arbitrum: HTTP ${r.status}`);
  console.log("  ", r.json ? shape(r.json) : r.text.slice(0, 200));
  const pay = r.json?.data?.payment;
  if (pay) console.log(`   payment: currency=${pay.currency} price=${pay.price} address=${String(pay.address ?? "").slice(0, 10)}… status=${pay.status}`);
  console.log("\nThis invoice is UNPAID: nothing was charged. It expires on its own.");
}

// 4: delivery field names (after you bought one yourself)
const order = arg("--order")?.[0];
if (order) {
  const r = await call("GET", `/orders/${encodeURIComponent(order)}`);
  console.log(`\nGET /orders/<id>: HTTP ${r.status}`);
  const info = r.json?.data?.redemption_info;
  console.log("order fields:", r.json ? shape(r.json.data ?? r.json) : r.text.slice(0, 120));
  console.log("redemption_info fields (names + types only):", info ? shape(info) : "(none)");
  console.log("Look for: card number / pan, cvv, expiry. If only `code`/`link`/`pin` appear, the product is a gift card, not a card with full details.");
}
console.log("\nDone. Paste the OUTPUT above (it contains no secrets) back into the chat.");
