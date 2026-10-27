import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { ARBITRUM, ARBITRUM_CHAIN_ID } from "../../src/lib/contracts/arbitrum";
import { ROBINHOOD, ROBINHOOD_CHAIN_ID } from "../../src/lib/contracts/robinhood";
import { CARD_PROVIDERS, TEST_SEND, checkCardSend, linkCard, markTestSent, markVerified, parseLinkedCards, protocolAddresses, providerById, providerFor, storageKey, unlinkCard, validateCardAddress, type LinkedCard } from "../../src/lib/linkedCards/cards";

const CARD = "0x00000000000000000000000000000000c0ffee01";
const CARD_CS = getAddress(CARD);
const SAFE = "0x1111111111111111111111111111111111111111";
const OWNER = "0x2222222222222222222222222222222222222222";
const ctx = (network: "arbitrum" | "robinhood" = "arbitrum") => ({ network, own: [SAFE, OWNER] as const });

describe("provider config", () => {
  it("one provider per chain, with the chain id and token of that chain's engine", () => {
    expect(providerFor("arbitrum")).toMatchObject({ id: "redotpay", chainId: ARBITRUM_CHAIN_ID, token: "USDC", chainName: "Arbitrum One" });
    expect(providerFor("robinhood")).toMatchObject({ id: "solcard", chainId: ROBINHOOD_CHAIN_ID, token: "USDG", chainName: "Robinhood Chain" });
    expect(CARD_PROVIDERS).toHaveLength(2);
  });
  it("links go to the provider's own https site: no referral, affiliate or tracking parameters, no credentials", () => {
    for (const p of CARD_PROVIDERS) {
      const u = new URL(p.siteUrl);
      expect(u.protocol).toBe("https:");
      expect(u.search).toBe("");
      expect(u.hash).toBe("");
      expect(u.username + u.password).toBe("");
      expect(["www.redotpay.com", "www.solcard.cc"]).toContain(u.host);
    }
  });
  it("every provider explains the steps and warns that it is a third party", () => {
    for (const p of CARD_PROVIDERS) {
      expect(p.steps.length).toBeGreaterThanOrEqual(4);
      expect(p.steps.join(" ")).toContain(p.token);
      expect(p.steps.join(" ")).toContain(p.chainName.split(" ")[0]);
      expect(p.caution).toContain("not affiliated");
    }
  });
  it("lookup by id", () => {
    expect(providerById("redotpay")?.network).toBe("arbitrum");
    expect(providerById("nope")).toBeUndefined();
  });
});

describe("validateCardAddress: only a plausible, safe deposit address is accepted", () => {
  it("accepts a lowercase and a correctly checksummed address, and returns the checksummed form", () => {
    expect(validateCardAddress(CARD, ctx())).toEqual({ ok: true, address: CARD_CS });
    expect(validateCardAddress(`  ${CARD_CS}  `, ctx())).toEqual({ ok: true, address: CARD_CS });
  });
  it("rejects empty input and internal whitespace", () => {
    expect(validateCardAddress("", ctx()).ok).toBe(false);
    expect(validateCardAddress("   ", ctx()).ok).toBe(false);
    const r = validateCardAddress("0x0000 0000000000000000000000000000c0ffee01", ctx());
    expect(r).toEqual({ ok: false, reason: "Remove the spaces from the address." });
  });
  it("rejects other chains' formats (Tron, Solana, Bitcoin) and malformed hex with a clear reason", () => {
    for (const bad of ["TJRabPrwbZy45sbavfcjinPJC18kjpRTv8", "4Nd1m8f1c5y3VnoNPLmQ5vVTK8rD6pXQjQk2Z8xYbKp", "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", "0x1234", "0xZZ00000000000000000000000000000000c0ffee", "c0ffee01"]) {
      const r = validateCardAddress(bad, ctx());
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.reason).toContain("EVM address");
    }
  });
  it("catches a single mistyped or mis-copied character through the checksum", () => {
    // flip the case of the first letter in the checksummed form
    const i = CARD_CS.slice(2).search(/[a-fA-F]/) + 2;
    const flipped = CARD_CS.slice(0, i) + (CARD_CS[i] === CARD_CS[i]!.toUpperCase() ? CARD_CS[i]!.toLowerCase() : CARD_CS[i]!.toUpperCase()) + CARD_CS.slice(i + 1);
    expect(flipped).not.toBe(CARD_CS);
    const r = validateCardAddress(flipped, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("typo");
  });
  it("rejects the zero and burn addresses", () => {
    expect(validateCardAddress("0x0000000000000000000000000000000000000000", ctx()).ok).toBe(false);
    expect(validateCardAddress("0x000000000000000000000000000000000000dEaD", ctx()).ok).toBe(false);
  });
  it("rejects the user's own wallet and Safe (any case), but only the ones that are known", () => {
    expect(validateCardAddress(SAFE.toUpperCase().replace("0X", "0x"), ctx()).ok).toBe(false);
    expect(validateCardAddress(OWNER, ctx())).toMatchObject({ ok: false });
    expect(validateCardAddress(OWNER, { network: "arbitrum", own: [undefined, undefined] }).ok).toBe(true);
  });
  it("rejects every token / protocol / Safe contract we use, on each chain", () => {
    for (const net of ["arbitrum", "robinhood"] as const) {
      for (const a of protocolAddresses(net)) expect(validateCardAddress(a, ctx(net)).ok, `${net} ${a}`).toBe(false);
    }
    expect(protocolAddresses("arbitrum")).toContain(ARBITRUM.usdc);
    expect(protocolAddresses("arbitrum")).toContain(ARBITRUM.aavePool);
    expect(protocolAddresses("robinhood")).toContain(ROBINHOOD.usdg);
    expect(protocolAddresses("robinhood")).toContain(ROBINHOOD.steakhouseUsdgVault);
    expect(protocolAddresses("robinhood")).toContain(ROBINHOOD.morphoBlue);
  });
  it("USDC is a forbidden target on Arbitrum", () => {
    expect(validateCardAddress(ARBITRUM.usdc, ctx("arbitrum")).ok).toBe(false);
  });
});

describe("state machine: linked -> test sent -> verified", () => {
  const redot = providerFor("arbitrum");
  const solcard = providerFor("robinhood");
  it("a new link starts at 'linked'; relinking a provider replaces it and resets to 'linked'", () => {
    let list = linkCard([], redot, CARD_CS, 1);
    expect(list).toEqual([{ provider: "redotpay", network: "arbitrum", token: "USDC", address: CARD_CS, status: "linked", linkedAt: 1 }]);
    list = markVerified(markTestSent(list, "redotpay"), "redotpay");
    expect(list[0]!.status).toBe("verified");
    const other = getAddress("0x00000000000000000000000000000000c0ffee02");
    list = linkCard(list, redot, other, 2);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ address: other, status: "linked" }); // a new address must be tested again
  });
  it("cannot be verified without a test, and a verified card is not downgraded by a repeated test mark", () => {
    const list = linkCard([], redot, CARD_CS, 1);
    expect(markVerified(list, "redotpay")[0]!.status).toBe("linked");
    const verified = markVerified(markTestSent(list, "redotpay"), "redotpay");
    expect(markTestSent(verified, "redotpay")[0]!.status).toBe("verified");
  });
  it("providers are independent, and unlink removes only that one", () => {
    let list = linkCard(linkCard([], redot, CARD_CS, 1), solcard, getAddress("0x00000000000000000000000000000000c0ffee03"), 1);
    expect(list).toHaveLength(2);
    list = markTestSent(list, "solcard");
    expect(list.find((c) => c.provider === "redotpay")!.status).toBe("linked");
    expect(unlinkCard(list, "redotpay").map((c) => c.provider)).toEqual(["solcard"]);
  });
});

describe("checkCardSend: what each step allows", () => {
  const card = (status: LinkedCard["status"]) => ({ status, token: "USDC" as const });
  const big = 10n ** 12n;
  it("test send is exactly $1.00, only before verification, and needs that much in the source", () => {
    expect(checkCardSend(card("linked"), "test", "yield", TEST_SEND, big)).toEqual({ ok: true });
    expect(checkCardSend(card("test-sent"), "test", "principal", TEST_SEND, big)).toEqual({ ok: true }); // can be resent
    expect(checkCardSend(card("linked"), "test", "yield", TEST_SEND + 1n, big).ok).toBe(false);
    expect(checkCardSend(card("linked"), "test", "yield", TEST_SEND - 1n, big).ok).toBe(false);
    expect(checkCardSend(card("linked"), "test", "yield", TEST_SEND, TEST_SEND - 1n).ok).toBe(false);
    expect(checkCardSend(card("verified"), "test", "yield", TEST_SEND, big).ok).toBe(false);
  });
  it("adding money needs a verified card", () => {
    for (const s of ["linked", "test-sent"] as const) expect(checkCardSend(card(s), "add", "yield", 5_000_000n, big)).toEqual({ ok: false, reason: "Send the $1 test and confirm it arrived before adding more." });
    expect(checkCardSend(card("verified"), "add", "yield", 5_000_000n, big)).toEqual({ ok: true });
  });
  it("zero and negative are refused; the limit is exact (boundary and one base unit over)", () => {
    expect(checkCardSend(card("verified"), "add", "yield", 0n, big).ok).toBe(false);
    expect(checkCardSend(card("verified"), "add", "yield", -1n, big).ok).toBe(false);
    expect(checkCardSend(card("verified"), "add", "yield", 12_345_678n, 12_345_678n).ok).toBe(true);
    expect(checkCardSend(card("verified"), "add", "yield", 12_345_679n, 12_345_678n)).toEqual({ ok: false, reason: "That is more than the yield you have earned. Your principal stays locked." });
    expect(checkCardSend(card("verified"), "add", "principal", 1_000_000_001n, 1_000_000_000n)).toEqual({ ok: false, reason: "That is more than your deposited principal." });
    expect(checkCardSend(card("verified"), "add", "principal", 1n, 1n).ok).toBe(true); // dust
  });
});

describe("parseLinkedCards: nothing read back from storage is trusted", () => {
  const good = { provider: "redotpay", network: "arbitrum", token: "USDC", address: CARD, status: "verified", linkedAt: 5 };
  const own = [SAFE, OWNER];
  it("round-trips a valid record (address comes back checksummed)", () => {
    expect(parseLinkedCards(JSON.stringify([good]), own)).toEqual([{ ...good, address: CARD_CS }]);
  });
  it("garbage, wrong shape and empty input give an empty list, never a throw", () => {
    for (const raw of [null, "", "not json", "{}", "123", "null", "[1,2,3]", "[null]"]) expect(parseLinkedCards(raw, own)).toEqual([]);
  });
  it("drops tampered records: unknown provider, provider on the wrong chain/token, bad status, bad address", () => {
    const bad = [
      { ...good, provider: "evilpay" },
      { ...good, network: "robinhood" },
      { ...good, token: "USDG" },
      { ...good, status: "approved" },
      { ...good, address: "0x1234" },
      { ...good, address: ARBITRUM.usdc },
      { ...good, address: SAFE },
      { ...good, address: OWNER },
    ];
    expect(parseLinkedCards(JSON.stringify(bad), own)).toEqual([]);
  });
  it("keeps one card per provider and ignores the rest", () => {
    const second = { ...good, address: "0x00000000000000000000000000000000c0ffee09" };
    expect(parseLinkedCards(JSON.stringify([good, second]), own)).toHaveLength(1);
  });
  it("storage is keyed per wallet, case-insensitively, so one wallet never sees another's cards", () => {
    expect(storageKey("0xABCDEF0000000000000000000000000000000001")).toBe(storageKey("0xabcdef0000000000000000000000000000000001"));
    expect(storageKey(OWNER)).not.toBe(storageKey(SAFE));
  });
});

import { readFileSync } from "node:fs";

describe("source guards for the card-link feature", () => {
  const read = (f: string) => readFileSync(f, "utf8");
  const PANEL = "src/components/dashboard/cards/LinkedCardPanel.tsx";
  const FILES = [PANEL, "src/components/dashboard/cards/SourceSelector.tsx", "src/features/card/useLinkedCards.ts", "src/lib/linkedCards/cards.ts"];
  it("no raw 40-hex address literal anywhere in the feature: addresses only come from the verified constants or the user's input", () => {
    // The only literals allowed are the two burn addresses the validator rejects.
    const burn = ["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"];
    for (const f of FILES) expect((read(f).match(/0x[0-9a-fA-F]{40}\b/g) ?? []).filter((a) => !burn.includes(a.toLowerCase())), f).toEqual([]);
  });
  it("the only external link is the provider's configured site, opened with noopener noreferrer", () => {
    const src = read(PANEL);
    expect([...src.matchAll(/href=\{([^}]+)\}/g)].map((m) => m[1])).toEqual(["provider.siteUrl"]);
    expect(src).toContain('rel="noopener noreferrer"');
    expect(src).toContain('target="_blank"');
    expect(src).not.toMatch(/https?:\/\//); // no URL literal in the component at all
  });
  it("no HTML injection and no direct chain access from the UI: React text only, wagmi/viem calls stay in hooks", () => {
    for (const f of [PANEL, "src/components/dashboard/cards/SourceSelector.tsx"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/dangerouslySetInnerHTML|innerHTML|eval\(/);
      expect(src, f).not.toMatch(/from "wagmi"|from "viem\/actions"|useWriteContract|sendTransaction/);
    }
    expect(read("src/features/card/useLinkedCards.ts")).not.toMatch(/from "wagmi"/);
  });
  it("sending re-validates the stored address and the step before any money moves, and defaults the source to yield", () => {
    const src = read(PANEL);
    const send = src.slice(src.indexOf("const send = async"));
    expect(send.indexOf("validateCardAddress")).toBeGreaterThan(-1);
    expect(send.indexOf("checkCardSend")).toBeGreaterThan(send.indexOf("validateCardAddress"));
    expect(send.indexOf("f.payFromYield")).toBeGreaterThan(send.indexOf("checkCardSend"));
    expect(src).toContain('setSource("yield")');
    expect(src).not.toContain('setSource("principal")');
  });
  it("guide steps and description are tucked behind a collapsible '?' button", () => {
    const src = read(PANEL);
    expect(src).toContain('data-testid="card-help-toggle"');
    expect(src).toContain('data-testid="card-help-guide"');
    expect(src).toContain("showHelp");
  });
});

import { freshHead } from "../../src/lib/aave/account";

describe("freshHead: log reads never stop at a cached, older block", () => {
  it("asks the node for the head with the block-number cache disabled", async () => {
    const calls: unknown[] = [];
    const client = { getBlockNumber: async (o?: unknown) => (calls.push(o), 123n) };
    expect(await freshHead(client)).toBe(123n);
    expect(calls).toEqual([{ cacheTime: 0 }]);
  });
  it("every log reader and account query uses it (no plain getBlockNumber() left in the engines)", () => {
    for (const f of ["src/lib/aave/account.ts", "src/lib/morpho/account.ts"]) {
      expect(readFileSync(f, "utf8").match(/\.getBlockNumber\(\)/g), f).toBeNull();
    }
    for (const f of ["src/features/account/useSafeAccount.ts", "src/features/account/useMorphoAccount.ts"]) {
      expect(readFileSync(f, "utf8")).toContain("getBlockNumber({ cacheTime: 0 })");
    }
  });
});
