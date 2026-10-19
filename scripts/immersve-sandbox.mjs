#!/usr/bin/env node
// Immersve SANDBOX smoke test (docs.immersve.com). Wallet-session flow only: no API secrets involved.
// Uses the public sandbox client application and Anvil's public dev key. Nothing real is touched.
import { privateKeyToAccount } from "viem/accounts";

const BASE = process.env.IMSV_BASE ?? "https://test.immersve.com";
const CLIENT_APP = process.env.IMSV_CLIENT_APP ?? "d0b05d44204810fc61991a49e289dda3"; // public sandbox client app (localhost:3000 only)
const ORIGIN = "http://localhost:3000";
const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");

const call = async (path, body, headers = {}, method = "POST") => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
};

const init = await call("/auth/login-init", {
  loginMethod: "siwe", network: "polygon-amoy", clientApplicationId: CLIENT_APP,
  scopes: ["cardholder-partner"], address: account.address, url: ORIGIN, autoSignup: true,
});
console.log("login-init", init.status, init.status === 200 ? "ok" : JSON.stringify(init.json).slice(0, 300));
if (init.status !== 200 && init.status !== 201) process.exit(1);

const signature = await account.signMessage({ message: init.json.signingChallenge.message });
const done = await call("/auth/login-complete", { loginRequestId: init.json.id, signature });
console.log("login-complete", done.status, done.status < 300 ? "ok (tokens received)" : JSON.stringify(done.json).slice(0, 300));

const tokens = done.json;
console.log("login response keys:", Object.keys(tokens));
const auth = { authorization: `Bearer ${tokens.accessToken}` };
const accountId = tokens.cardholderAccountId;
const show = (label, r) => console.log(label, r.status, JSON.stringify(r.json).slice(0, 400));

const PARTNER = process.env.IMSV_PARTNER ?? "d1bc97edfa4f7dc9b56726c7d82a9956";
const CARD_PROGRAM = "7dfa2e3ed390493ab307fac622f05ae9";
const CHANNEL = "4cdc4310718674342d561647194e2446"; // public sandbox: simulator strategy

const rg = await call(`/api/accounts/${PARTNER}/supported-regions`, undefined, auth, "GET");
console.log("available regions:", rg.json.regions.filter((r) => r.isAvailable).map((r) => r.code).join(",") || "none");
const fs = await call("/api/funding-sources", { accountId, fundingAddress: account.address, fundingChannelId: CHANNEL }, auth);
show("funding-source", fs);
let fundingSourceId = fs.json.id;
if (!fundingSourceId && fs.json.errorCode === "FUNDING_SOURCE_EXISTS") {
  const list = await call(`/api/accounts/${accountId}/funding-sources`, undefined, auth, "GET");
  fundingSourceId = list.json.items?.[0]?.id;
  console.log("reusing funding source", fundingSourceId);
}
const preBody = {
  cardProgramId: CARD_PROGRAM, fundingSourceId, spendableAmount: 100, spendableCurrency: "USD",
  kycType: process.env.KYC_TYPE ?? "immersve-conducted", kycRedirectUrl: process.env.KYC_REDIRECT ?? "https://orventyield.tech/dashboard",
};
const pre = await call("/api/spending-prerequisites", preBody, auth);
show("prerequisites", pre);
const kycStep = pre.json.prerequisites?.find((p) => p.stage === "kyc");
if (kycStep?.status !== "ok" && kycStep?.params?.kycUrl) console.log("\nKYC needed (browser, sandbox): open\n" + kycStep.params.kycUrl + "\n");
if (process.env.DEBUG_IMSV) {
  show("prereq (no redirect)", await call("/api/spending-prerequisites", { ...preBody, kycRedirectUrl: undefined }, auth));
  show("prereq (x-account-id)", await call("/api/spending-prerequisites", preBody, { ...auth, "x-account-id": accountId }));
}
const card = process.env.IMSV_CARD_ID ? { json: { cardId: process.env.IMSV_CARD_ID } } : await call("/api/cards", { cardProgramId: CARD_PROGRAM, fundingSourceId }, auth);
if (!process.env.IMSV_CARD_ID) show("create card", card);
if (process.env.DEBUG_IMSV) {
  const l = await call(`/api/accounts/${accountId}/funding-sources`, undefined, auth, "GET");
  console.log("list", l.status, JSON.stringify(l.json).slice(0, 500));
}

// Card details + secure reveal (PAN/CVV never logged in full)
const cardId = card.json.cardId;
if (cardId) {
  const got = await call(`/api/cards/${cardId}`, undefined, auth, "GET");
  show("get card", got);
  const tok = await call(`/api/cards/${cardId}/pan-token`, {}, auth);
  console.log("pan-token", tok.status, Object.keys(tok.json ?? {}));
  if (tok.json?.callbackUrl) {
    const r = await fetch(tok.json.callbackUrl);
    const d = await r.json().catch(() => ({}));
    console.log("reveal", r.status, Object.keys(d));
    const pan = String(d.pan ?? d.cardPan ?? "");
    if (pan) console.log("PAN masked:", pan.slice(0, 6) + "******" + pan.slice(-4), "| cvv present:", Boolean(d.cvv ?? d.cvv2 ?? d.cardCvv), "| expiry:", d.expiry ?? d.cardExpiry);
  }
}
