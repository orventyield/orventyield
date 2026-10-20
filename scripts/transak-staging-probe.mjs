#!/usr/bin/env node
// Transak STAGING probe: confirms the two things the docs do not tell us, using YOUR staging partner key (never production).
//
//   TRANSAK_API_KEY=... TRANSAK_API_SECRET=... node scripts/transak-staging-probe.mjs --ip <your public IP>
//       1. gets a partner access token, 2. creates a USDC/Arbitrum SELL widget URL (prints it), 3. tells you what to do next.
//   TRANSAK_API_KEY=... TRANSAK_API_SECRET=... node scripts/transak-staging-probe.mjs --order <orderId>
//       prints the SELL order's field names, and every field whose value is an EVM address. The one that is the address you must
//       pay is what to set as TRANSAK_DEPOSIT_FIELD in worker/wrangler.jsonc. Until then the app refuses to send anything.
//
// Staging only. It prints no secrets and no personal data (non-address values are shown as types).
const key = process.env.TRANSAK_API_KEY;
const secret = process.env.TRANSAK_API_SECRET;
if (!key || !secret) {
  console.error("Set TRANSAK_API_KEY and TRANSAK_API_SECRET (staging, from dashboard.transak.com > Developers).");
  process.exit(1);
}
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const PARTNERS = "https://api-stg.transak.com";
const GATEWAY = "https://api-gateway-stg.transak.com";

const refresh = await fetch(`${PARTNERS}/partners/api/v2/refresh-token`, {
  method: "POST",
  headers: { "api-secret": secret, "x-api-key": key, accept: "application/json", "content-type": "application/json" },
  body: JSON.stringify({ apiKey: key }),
});
const rj = await refresh.json().catch(() => ({}));
console.log("refresh-token:", refresh.status, rj?.data?.accessToken ? `ok, expires ${new Date(rj.data.expiresAt * 1000).toISOString()}` : JSON.stringify(rj).slice(0, 200));
if (!rj?.data?.accessToken) process.exit(2);
const token = rj.data.accessToken;

const orderId = arg("--order");
if (orderId) {
  const r = await fetch(`${PARTNERS}/partners/api/v2/order/${encodeURIComponent(orderId)}`, { headers: { "x-api-key": key, "access-token": token, accept: "application/json" } });
  const j = await r.json().catch(() => ({}));
  console.log("order:", r.status);
  const d = j?.data ?? {};
  console.log("isBuyOrSell:", d.isBuyOrSell, "| status:", d.status, "| crypto:", d.cryptoCurrency, d.network, d.cryptoAmount);
  console.log("\nfields:");
  for (const [k, v] of Object.entries(d)) {
    const isAddr = typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
    console.log(`  ${k.padEnd(28)} ${isAddr ? `ADDRESS ${v}` : typeof v}`);
  }
  console.log("\nSet TRANSAK_DEPOSIT_FIELD to the field above that holds the address you must send the USDC to (not your own wallet).");
  process.exit(0);
}

const ip = arg("--ip");
if (!ip) { console.error("Pass --ip <your public IP> (Transak requires x-user-ip)."); process.exit(1); }
const s = await fetch(`${GATEWAY}/api/v2/auth/session`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-api-key": key, "access-token": token, "x-user-ip": ip },
  body: JSON.stringify({ widgetParams: { apiKey: key, referrerDomain: "orventyield.tech", productsAvailed: "SELL", cryptoCurrencyCode: "USDC", network: "arbitrum", cryptoAmount: 10 } }),
});
const sj = await s.json().catch(() => ({}));
console.log("create session:", s.status, s.status === 403 || s.status === 401 ? "(if this says IP not allowed, Transak enforces static egress IPs: see worker/transak.ts open item 2)" : "");
console.log(sj?.data?.widgetUrl ? `widget (valid 5 min, single use):\n${sj.data.widgetUrl}\n\nOpen it, pass the staging KYC (docs.transak.com/guides/sandbox-credentials.md), create a SELL order, copy the order id, then run:\n  node scripts/transak-staging-probe.mjs --order <orderId>` : JSON.stringify(sj).slice(0, 300));
