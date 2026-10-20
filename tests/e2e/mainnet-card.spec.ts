import { expect, test, type Page, type Route } from "@playwright/test";
import { installForkWallet } from "./helpers";

/**
 * The Mainnet Card tab end to end on the Anvil fork: deposit -> yield -> wallet signature -> card issuer
 * session -> KYC -> issue -> Mastercard -> single-use PAN/CVV reveal -> fund the card from earned yield -> POS preview.
 * The card issuer (Immersve sandbox) is mocked at the network layer: tests never depend on its uptime, and its KYC step
 * needs a human with a camera. The real sandbox is exercised by `node scripts/immersve-sandbox.mjs`.
 */
const ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const FORK = "http://127.0.0.1:8545";
const KYC_URL = "https://verify.test.immersve.com/kyc/session/e2e";
const PAN = "5288541234561179";
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
/** A stand-in for the issuer's Funds Storage address in the on-chain (deposit mode) test. */
const STORAGE = "0x5707A6E00000000000000000000000000000f00d".toLowerCase();
/**
 * Runtime bytecode of a test double for the issuer's Funds Storage contract (Solidity 0.8.28, compiled with forge):
 *   contract StorageStub { function withdraw(uint256 amount) external { USDC.transfer(msg.sender, amount); } }
 */
const STORAGE_STUB = "0x608060405234801561000f575f5ffd5b5060043610610029575f3560e01c80632e1a7d4d1461002d575b5f5ffd5b61004061003b366004610100565b610042565b005b60405163a9059cbb60e01b81523360048201526024810182905273af88d065e77c8cc2239327c5edb3a432268e58319063a9059cbb906044016020604051808303815f875af1158015610097573d5f5f3e3d5ffd5b505050506040513d601f19601f820116820180604052508101906100bb9190610117565b6100fd5760405162461bcd60e51b815260206004820152600f60248201526e1d1c985b9cd9995c8819985a5b1959608a1b604482015260640160405180910390fd5b50565b5f60208284031215610110575f5ffd5b5035919050565b5f60208284031215610127575f5ffd5b81518015158114610136575f5ffd5b939250505056fea2646970667358221220b692363519362c25985e9355633124fececd0d74dc719a6f15d64c5da03d976464736f6c634300081c0033";

async function rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const r = await fetch(FORK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result: T; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

const usdcOf = async (a: string) => BigInt(await rpc<string>("eth_call", [{ to: USDC, data: `0x70a08231${a.toLowerCase().replace("0x", "").padStart(64, "0")}` }, "latest"]));

interface Issuer {
  /** Card funding source balance in USDC base units (6 decimals). */
  balance: number;
  deposits: { amount: string; fundingSourceId: string }[];
  withdrawals: number[];
  executedWithdrawals: number;
  transactions: { id: string; amount: string; currency: string; status: string; transactionDate: string; cardAcceptor: { name: string }; creditDebitIndicator: string }[];
  kycDone: boolean;
  issued: boolean;
  revealCalls: number;
  tokensIssued: number;
  logins: number;
  spendableAmounts: number[];
}

/** A stateful stand-in for the card issuer. The test flips `kycDone` the way a human finishing KYC would. */
async function mockIssuer(page: Page, opts: { onchain?: boolean } = {}): Promise<Issuer> {
  const st: Issuer = { balance: 0, deposits: [], withdrawals: [], executedWithdrawals: 0, transactions: [], kycDone: !!opts.onchain, issued: !!opts.onchain, revealCalls: 0, tokensIssued: 0, logins: 0, spendableAmounts: [] };
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,content-type", "access-control-allow-methods": "GET,POST" };
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });

  await page.route("https://test.immersve.com/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const path = new URL(req.url()).pathname;
    const body = req.postData() ? (JSON.parse(req.postData()!) as Record<string, unknown>) : {};
    if (path === "/auth/login-init") return json(route, { id: "req1", signingChallenge: { message: "orventyield.tech wants you to sign in (e2e)" } });
    if (path === "/auth/login-complete") {
      st.logins++;
      return json(route, { accessToken: "AT", refreshToken: "RT", cardholderAccountId: "acc1" });
    }
    if (path === "/api/accounts/acc1/funding-sources") return json(route, { items: [] });
    if (path === "/api/funding-sources") return json(route, { id: "fs1", accountId: "acc1", fundingChannelId: body.fundingChannelId, balance: "0", balanceCurrency: "USDC" });
    if (path === "/api/spending-prerequisites") {
      st.spendableAmounts.push(Number(body.spendableAmount));
      expect(String(body.kycRedirectUrl).startsWith("https://")).toBe(true); // the gateway rejects http://localhost
      // Funding stage exactly as the sandbox sends it: the balance must reach spendableAmount (cents), else a simulator call
      const need = Number(body.spendableAmount) * 10_000;
      if (opts.onchain) st.balance = Number(await usdcOf(STORAGE)); // the issuer credits what reached its funds address
      const funding = st.balance >= need
        ? { stage: "funding", status: "ok" }
        : opts.onchain
          ? { stage: "funding", status: "action-required", type: "smart_contract_write", actionType: "smart_contract_write", params: { opaque: "shape not in the public docs, so the app must not depend on it" } }
          : { stage: "funding", status: "action-required", type: "simulator_call", actionType: "simulator_call", params: { url: "https://test.immersve.com/api/simulator/execute-deposit", payload: { amount: String(need - st.balance), fundingSourceId: "fs1" } } };
      return json(route, {
        prerequisites: st.kycDone
          ? [{ stage: "aml", status: "ok" }, { stage: "kyc", status: "ok" }, funding]
          : [{ stage: "aml", status: "pending", params: {} }, { stage: "kyc", status: "action-required", actionType: "follow_kyc_url", params: { kycUrl: KYC_URL } }, funding],
      });
    }
    if (path.startsWith("/api/funding-channel/")) return json(route, { id: "ch", fundingTypeName: "arbitrum-mainnet-usdc-universal-evm", mode: "deposit", params: { storageAddress: STORAGE } });
    if (path === "/api/funding-source/fs1") {
      if (opts.onchain) st.balance = Number(await usdcOf(STORAGE));
      return json(route, { id: "fs1", accountId: "acc1", fundingChannelId: "ch", balance: String(st.balance), balanceCurrency: "USDC" });
    }
    if (path === "/api/funding-sources/fs1/withdraw") {
      const amount = Number((body as { amount: number }).amount);
      st.withdrawals.push(amount);
      const intent = { id: `w${st.withdrawals.length}`, amount, createdAt: "2026-10-20T05:52:59Z", expiresAt: "2099-01-01T00:00:00Z" };
      if (opts.onchain) {
        // Production-style instructions, shaped after the docs' wording (contract address, ABI, method, parameters)
        return json(route, { ...intent, execution: { params: { address: STORAGE, abi: [{ type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] }], method: "withdraw", params: [String(amount)] } } });
      }
      st.balance -= amount; // the issuer debits the card at once
      return json(route, { ...intent, execution: { url: "https://test.immersve.com/api/simulator/execute-withdrawal", payload: { amount: String(amount), fundingSourceId: "fs1", id: intent.id, expiresAt: intent.expiresAt } } });
    }
    if (path === "/api/simulator/execute-withdrawal") {
      expect(req.headers().authorization).toBe("Bearer AT");
      st.executedWithdrawals++;
      return json(route, {});
    }
    if (path === "/api/simulator/execute-deposit") {
      expect(req.headers().authorization).toBe("Bearer AT");
      st.deposits.push(body as { amount: string; fundingSourceId: string });
      st.balance += Number((body as { amount: string }).amount);
      return json(route, {});
    }
    if (path === "/api/accounts/acc1/transactions") return json(route, { items: st.transactions });
    if (path === "/api/accounts/acc1/cards") {
      return json(route, { items: st.issued ? [{ id: "c1", type: "virtual", network: "simulator", status: "active", isBlocked: false, expiry: "203006", panFirst6: "528854", panLast4: "1179", regionCode: "NZ", cardholderName: "E2E TESTER" }] : [] });
    }
    if (path === "/api/cards" && req.method() === "POST") {
      if (!st.kycDone) return json(route, { errorCode: "KYC_REQUIRED" }, 403);
      st.issued = true;
      return json(route, { cardId: "c1" });
    }
    if (path === "/api/cards/c1/pan-token") {
      st.tokensIssued++;
      return json(route, { tokenId: `t${st.tokensIssued}`, callbackUrl: `https://secure.test.immersve.com/reveal/${st.tokensIssued}` }, 201);
    }
    return json(route, { errorCode: "UNMOCKED", path }, 404);
  });
  // The single-use reveal link: first use works, any reuse is a 403, exactly like the real service.
  const used = new Set<string>();
  // The Worker is an older deployment without cashout routes: cashout must say "being switched on", not break.
  await page.route("https://vouchers.e2e.test/**", (route) =>
    route.request().method() === "OPTIONS"
      ? route.fulfill({ status: 204, headers: cors })
      : route.fulfill({ status: 404, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ ok: false, code: "NOT_FOUND", message: "Not found." }) }),
  );
  await page.route("https://secure.test.immersve.com/**", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const id = new URL(route.request().url()).pathname;
    if (used.has(id)) return json(route, { errorCode: "FORBIDDEN" }, 403);
    used.add(id);
    st.revealCalls++;
    return json(route, { pan: PAN, expiry: "203006", cvv2: "123", embossedName: "E2E TESTER" });
  });
  return st;
}

test.describe("mainnet card suite", () => {
  test.describe.configure({ mode: "serial" });
  let snapshot: string;

  test.beforeAll(async () => {
    test.skip(((await rpc<string>("eth_chainId").catch(() => null)) as string | null) !== "0x7a69", "Anvil fork not running: start it with `npm run fork`");
  });
  // Each test starts from a clean fork, so one test's deposit never leaks into the next.
  test.beforeEach(async () => {
    snapshot = await rpc<string>("evm_snapshot");
  });
  test.afterEach(async () => {
    if (snapshot) await rpc("evm_revert", [snapshot]);
  });

  test("wallet signature -> issuer sign-in -> KYC -> card -> single-use reveal -> fund from yield -> POS preview -> ledger", async ({ page, context }) => {
    test.setTimeout(180_000); // real transactions, a yield refresh and polling
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const issuer = await mockIssuer(page);
    await installForkWallet(page);
    await page.goto("/dashboard");
    await page.getByTestId("connect-wallet").click();
    await page.getByTestId("wallet-option-test.anvil.wallet").click();
    await expect(page.getByTestId("mainnet-dashboard")).toBeVisible({ timeout: 30_000 });

    // Real money first: 1,000 USDC into the Safe, then 30 days of yield on the fork.
    await page.getByTestId("open-deposit").click();
    await page.getByTestId("amount-input").fill("1000");
    await page.getByTestId("amount-confirm").click();
    await expect(page.getByTestId("tx-success")).toBeVisible({ timeout: 90_000 });
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("principal-value")).toHaveText("$1,000.00", { timeout: 30_000 });
    await rpc("evm_increaseTime", [30 * 24 * 3600]);
    await rpc("evm_mine");

    // Parity with the Playground: the same five tabs in the same order, and the same cards in the same places
    const tabs = ["tab-vault", "tab-pos", "tab-vouchers", "tab-cashout", "tab-activity"];
    const want = ["Vault & Card", "POS Terminal Simulator", "Voucher Store", "1-Click Bank / UPI", "Ledger ("];
    for (const [i, id] of tabs.entries()) await expect(page.getByTestId(id)).toContainText(want[i]!);
    await expect(page.getByTestId("principal-value")).toBeVisible();
    await expect(page.getByTestId("yield-value")).toBeVisible();
    await expect(page.getByTestId("limit-value")).toBeVisible();
    await expect(page.getByTestId("safety-value")).toHaveText("No debt"); // no borrowing, so no health factor to fake
    await expect(page.getByText("Collateral Health Factor")).toHaveCount(0);
    await expect(page.getByTestId("pos-locked")).toBeVisible(); // no card yet

    // Ledger shows the real deposit, on-chain, with its transaction hash
    await page.getByTestId("tab-activity").click();
    await expect(page.getByTestId("ledger-row")).toHaveCount(1);
    await expect(page.getByTestId("ledger-row").first()).toContainText("Deposited to Aave");
    await expect(page.getByTestId("ledger-row").first()).toContainText("On-chain");
    await expect(page.getByTestId("ledger-row").first()).toContainText(/Tx: 0x/);
    await expect(page.getByTestId("ledger-row").first()).not.toContainText("Sim tx");

    // Cashout is the same screen, honestly disabled, with no credit-line options
    await page.getByTestId("tab-cashout").click();
    await expect(page.getByTestId("cashout-unavailable")).toBeVisible();
    await expect(page.getByTestId("cashout-submit")).toBeDisabled();
    await expect(page.getByTestId("allow-credit")).toHaveCount(0);
    await expect(page.getByText(/credit advance/i)).toHaveCount(0);
    await page.getByTestId("tab-vault").click();

    // Step 1: no phone number, no SMS. Nothing of the issuer is touched until the user signs.
    await page.getByTestId("tab-vault").click(); // the card lives on the Vault & Card tab
    await expect(page.getByTestId("card-step-login")).toBeVisible();
    await expect(page.getByTestId("card-verify-phone")).toHaveCount(0);
    await expect(page.getByText(/phone|SMS|OTP/i)).toHaveCount(0);
    expect(issuer.logins).toBe(0);

    // Step 2: free wallet signature ("Activate card"). A rejection is explained and nothing is lost.
    await page.evaluate(() => ((window as unknown as { __rejectSign: boolean }).__rejectSign = true));
    await page.getByTestId("card-continue").click();
    await expect(page.getByTestId("card-error")).toContainText("cancelled");
    expect(issuer.logins).toBe(0);
    await page.getByTestId("card-continue").click();

    // Step 3: KYC opens the issuer's page in a new tab; finishing it moves this page on by itself.
    await expect(page.getByTestId("card-step-kyc")).toBeVisible({ timeout: 20_000 });
    const [popup] = await Promise.all([context.waitForEvent("page"), page.getByTestId("card-start-kyc").click()]);
    expect(popup.url()).toContain("verify.test.immersve.com/kyc/session/e2e");
    await popup.close();
    issuer.kycDone = true;
    await expect(page.getByTestId("card-step-issue")).toBeVisible({ timeout: 30_000 });

    // Step 4: issue and show a Mastercard with only the safe parts visible
    await page.getByTestId("card-issue").click();
    await expect(page.getByTestId("card-active")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("virtual-card")).toBeVisible();
    if (process.env.SHOT) await page.screenshot({ path: "/tmp/oy-main-overview.png", fullPage: true });
    await expect(page.getByRole("img", { name: "Mastercard" }).first()).toBeVisible();
    await expect(page.getByTestId("card-pan")).toHaveText("5288 54•• •••• 1179");
    await expect(page.getByTestId("card-cvv")).toHaveText("•••");
    await expect(page.getByTestId("card-expiry")).toHaveText("06/30");

    // Step 5: single-use reveal. Every reveal asks for a fresh link; the PAN never lands in storage.
    await page.getByTestId("card-reveal").click();
    await expect(page.getByTestId("card-pan")).toHaveText("5288 5412 3456 1179");
    if (process.env.SHOT) await page.screenshot({ path: "/tmp/oy-card.png" });
    await expect(page.getByTestId("card-cvv")).toHaveText("123");
    await expect(page.getByTestId("card-hide")).toContainText(/\(\d+s\)/); // the auto-hide countdown is shown
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(stored).not.toContain(PAN);
    expect(stored).not.toContain("5288541234561179");
    await page.getByTestId("card-hide").click();
    await expect(page.getByTestId("card-pan")).toHaveText("5288 54•• •••• 1179");
    await expect(page.getByTestId("card-cvv")).toHaveText("•••");
    await page.getByTestId("card-reveal").click(); // a second reveal must use a NEW one-time link
    await expect(page.getByTestId("card-cvv")).toHaveText("123");
    expect(issuer.tokensIssued).toBe(2);
    expect(issuer.revealCalls).toBe(2);
    await page.getByTestId("card-hide").click();

    // Step 6: the card starts empty. The POS preview refuses a swipe on an unfunded card.
    await expect(page.getByTestId("card-balance")).toHaveText("$0.00");
    await page.getByTestId("tab-pos").click();
    await page.getByTestId("preset-custom").click();
    await page.getByTestId("custom-merchant").fill("Test Cafe");
    await page.getByTestId("custom-amount").fill("1");
    await page.getByTestId("pos-pay").click();
    await expect(page.getByTestId("pos-terminal")).toContainText("CARD NOT FUNDED");
    await page.getByTestId("tab-vault").click();

    // Step 7: fund the card from EARNED YIELD (30 days on 1,000 USDC is a little under $2): never principal
    await expect.poll(async () => Number(((await page.getByTestId("card-fundable").textContent()) ?? "").replace(/[^0-9.]/g, "")), { timeout: 60_000 }).toBeGreaterThan(1);
    const fundable = Number(((await page.getByTestId("card-fundable").textContent()) ?? "").replace(/[^0-9.]/g, ""));
    expect(fundable).toBeLessThan(10); // far below the $1,000 principal
    expect(Math.max(...issuer.spendableAmounts)).toBeGreaterThanOrEqual(100); // never declares under $1.00
    issuer.transactions.push({ id: "tx1", amount: "100", currency: "USD", status: "holding", transactionDate: "2026-10-20T05:15:10.967Z", cardAcceptor: { name: "Test Cafe" }, creditDebitIndicator: "debit" });

    await page.getByTestId("card-fund-open").click();
    await page.getByTestId("amount-input").fill("999"); // more than the yield: refused before anything is sent
    await expect(page.getByTestId("amount-over")).toBeVisible();
    await page.getByTestId("amount-max").click();
    await page.getByTestId("amount-confirm").click();
    await expect(page.getByTestId("tx-success")).toContainText("Added $", { timeout: 60_000 });
    expect(issuer.deposits).toHaveLength(1);
    expect(issuer.deposits[0]!.fundingSourceId).toBe("fs1");
    expect(BigInt(issuer.deposits[0]!.amount) % 10_000n).toBe(0n); // whole cents only
    expect(Number(issuer.deposits[0]!.amount) / 1e6).toBeLessThanOrEqual(fundable + 0.005); // never more than the earned yield
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("card-balance")).toHaveText(new RegExp(`^\\$${(Number(issuer.deposits[0]!.amount) / 1e6).toFixed(2).replace(".", "\\.")}$`));
    await page.getByTestId("tab-vault").click();
    await expect(page.getByTestId("principal-value")).toHaveText("$1,000.00"); // principal untouched

    // POS terminal: tests a swipe against the money really on the card and charges nothing
    await expect(page.getByTestId("pos-locked")).toHaveCount(0);
    await page.getByTestId("tab-pos").click();
    await page.getByTestId("preset-custom").click(); // the terminal remounts with its default merchant
    await page.getByTestId("custom-merchant").fill("Test Cafe");
    await page.getByTestId("custom-amount").fill("1");
    await page.getByTestId("pos-pay").click();
    await expect(page.getByTestId("pos-terminal")).toContainText("APPROVED");
    await expect(page.getByTestId("receipt-source")).toHaveText("Your card balance");
    await expect(page.getByTestId("pos-receipt")).toContainText("Preview: nothing was charged");
    await expect(page.getByTestId("receipt-hf")).toHaveCount(0); // no debt model on Mainnet
    await page.getByTestId("custom-amount").fill("500");
    await page.getByTestId("pos-pay").click();
    await expect(page.getByTestId("pos-terminal")).toContainText("EXCEEDS CARD BALANCE");

    // Withdraw to Safe (sandbox): the card is debited at once and the issuer's simulator is told to execute
    await page.getByTestId("tab-vault").click();
    const balanceBefore = await page.getByTestId("card-balance").textContent();
    await page.getByTestId("card-withdraw-open").click();
    await page.getByTestId("amount-input").fill("0.50");
    await page.getByTestId("amount-confirm").click();
    await expect(page.getByTestId("tx-success")).toContainText("back to your Safe", { timeout: 60_000 });
    expect(issuer.withdrawals).toEqual([500_000]); // whole cents, exactly what was asked
    expect(issuer.executedWithdrawals).toBe(1);
    await page.getByRole("button", { name: "Done" }).click();
    const afterNum = Number(((await page.getByTestId("card-balance").textContent()) ?? "").replace(/[^0-9.]/g, ""));
    expect(afterNum).toBeCloseTo(Number((balanceBefore ?? "").replace(/[^0-9.]/g, "")) - 0.5, 2);

    // The ledger shows the real card payment from the card network
    await page.getByTestId("tab-activity").click();
    await expect(page.getByTestId("ledger-row").filter({ hasText: "Card swipe - Test Cafe" })).toContainText("Card network");

    // Mobile: the grid and tabs wrap cleanly at 360px and 390px on every tab
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 800 });
      for (const tab of ["tab-vault", "tab-pos", "tab-vouchers", "tab-cashout", "tab-activity"]) {
        await page.getByTestId(tab).click();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${tab} at ${width}px`).toBeLessThanOrEqual(0);
        if (process.env.SHOT && width === 360) await page.screenshot({ path: `/tmp/oy-m360-${tab}.png`, fullPage: true });
      }
    }
    if (process.env.SHOT) await page.screenshot({ path: "/tmp/oy-main-pos.png", fullPage: true });
    expect(errors).toEqual([]);
  });

  test("production deposit mode: ONE Safe transaction moves exactly the earned yield to the issuer's funds address", async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const issuer = await mockIssuer(page, { onchain: true }); // KYC done and card already issued
    await installForkWallet(page);
    await page.goto("/dashboard");
    await page.getByTestId("connect-wallet").click();
    await page.getByTestId("wallet-option-test.anvil.wallet").click();
    await expect(page.getByTestId("mainnet-dashboard")).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("open-deposit").click();
    await page.getByTestId("amount-input").fill("1000");
    await page.getByTestId("amount-confirm").click();
    await expect(page.getByTestId("tx-success")).toBeVisible({ timeout: 90_000 });
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("principal-value")).toHaveText("$1,000.00", { timeout: 30_000 });
    await rpc("evm_increaseTime", [30 * 24 * 3600]);
    await rpc("evm_mine");

    await page.getByTestId("card-continue").click();
    await expect(page.getByTestId("card-active")).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => Number(((await page.getByTestId("card-fundable").textContent()) ?? "").replace(/[^0-9.]/g, "")), { timeout: 60_000 }).toBeGreaterThan(1);

    expect(await usdcOf(STORAGE)).toBe(0n);
    await rpc("anvil_setCode", [STORAGE, STORAGE_STUB]); // the issuer's funds contract (test double)
    await page.getByTestId("card-fund-open").click();
    await expect(page.getByTestId("tx-preview")).toContainText("Withdraw yield and deposit"); // production wording: real money moves
    await page.getByTestId("amount-max").click();
    await page.getByTestId("amount-confirm").click();
    await expect(page.getByTestId("tx-success")).toContainText("Added $", { timeout: 120_000 });
    await expect(page.getByTestId("step-pay-yield")).toHaveAttribute("data-status", "done");

    // On-chain truth: the funds address received an exact whole-cent amount, no more than the earned yield
    const received = await usdcOf(STORAGE);
    expect(received).toBeGreaterThan(1_000_000n);
    expect(received % 10_000n).toBe(0n);
    expect(received).toBeLessThan(10_000_000n); // far below the 1,000 USDC principal
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("card-balance")).toHaveText(`$${(Number(received) / 1e6).toFixed(2)}`);
    expect(issuer.deposits).toHaveLength(0); // no sandbox call was used

    // Withdraw to Safe on a real chain: ONE Safe transaction calls withdraw() on the funds contract and USDC lands in the Safe
    const safeAddr = ((await page.getByTestId("safe-address").textContent()) ?? "").trim();
    expect(await usdcOf(safeAddr)).toBe(0n);
    await page.getByTestId("card-withdraw-open").click();
    await expect(page.getByTestId("tx-preview")).toContainText("funds contract");
    await page.getByTestId("amount-max").click();
    await page.getByTestId("amount-confirm").click();
    await expect(page.getByTestId("tx-success")).toContainText("back to your Safe", { timeout: 120_000 });
    await expect(page.getByTestId("step-safe-exec")).toHaveAttribute("data-status", "done");
    expect(await usdcOf(safeAddr)).toBe(received); // the whole card balance came back into the Safe
    expect(await usdcOf(STORAGE)).toBe(0n);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("card-balance")).toHaveText("$0.00");
    await page.getByTestId("tab-vault").click();
    await expect(page.getByTestId("principal-value")).toHaveText("$1,000.00"); // principal untouched
    expect(errors).toEqual([]);
  });
});
