/**
 * Mainnet mode against the real Optimism contracts. Needs network: run with `LIVE=1 npm run e2e`.
 * Every assertion about on-chain values is checked against an independent read made from this test process.
 */
import { createPublicClient, http, keccak256, toHex, type Address } from "viem";
import { optimism } from "viem/chains";
import { expect, test, type Page } from "@playwright/test";
import { cashLensAbi, safeFactoryAbi } from "../../src/lib/etherfi/abi";
import { ETHERFI_REGISTRY } from "../../src/lib/contracts/etherfi";

const LIVE = process.env.LIVE === "1";
const client = createPublicClient({ chain: optimism, transport: http(ETHERFI_REGISTRY[10]!.rpc), batch: { multicall: true } });
const C = ETHERFI_REGISTRY[10]!.contracts;
const LENS = C.CashLens!.address;
const FACTORY = C.EtherFiSafeFactory!.address;
const USDC = C.USDC!.address;

interface Found {
  address: Address;
  mode: number;
  totalCollateral: number;
  totalBorrow: number;
}

/** First real Safes with a meaningful balance: one debit-mode and one credit-mode with debt (when they exist). */
async function discover(): Promise<{ debit?: Found; credit?: Found }> {
  const out: { debit?: Found; credit?: Found } = {};
  for (let start = 0; start < 1500 && (!out.debit || !out.credit); start += 100) {
    const safes = await client.readContract({ address: FACTORY, abi: safeFactoryAbi, functionName: "getDeployedAddresses", args: [BigInt(start), 100n] });
    if (!safes.length) break;
    const res = await Promise.allSettled(safes.map((s) => client.readContract({ address: LENS, abi: cashLensAbi, functionName: "getSafeCashData", args: [s, []] })));
    res.forEach((r, i) => {
      if (r.status !== "fulfilled") return;
      const f: Found = { address: safes[i]!, mode: r.value.mode, totalCollateral: Number(r.value.totalCollateral) / 1e6, totalBorrow: Number(r.value.totalBorrow) / 1e6 };
      if (f.totalCollateral < 100 || f.totalCollateral > 200_000) return;
      if (f.mode === 1 && !out.debit && Number(r.value.debitMaxSpend.totalSpendableInUsd) / 1e6 > 20) out.debit = f;
      if (f.mode === 0 && f.totalBorrow > 0 && !out.credit && Number(r.value.creditMaxSpend) / 1e6 > 20) out.credit = f;
    });
  }
  return out;
}

const num = (s: string | null) => Number((s ?? "").replace(/[^0-9.\-]/g, ""));
const usd = async (page: Page, id: string) => num(((await page.getByTestId(id).first().textContent()) ?? "").replace(/,/g, ""));

async function watch(page: Page, safe: Address) {
  await page.goto("/dashboard");
  await page.getByTestId("mode-mainnet").click();
  await page.getByTestId("gate-watch").click();
  await page.getByTestId("safe-input").fill(safe);
  await expect(page.getByTestId("safe-message")).toContainText("Ether.fi Safe found", { timeout: 30_000 });
  await page.getByTestId("safe-link").click();
  await expect(page.getByTestId("live-dashboard")).toBeVisible({ timeout: 30_000 });
}

test.describe("mainnet (live Optimism)", () => {
  test.skip(!LIVE, "set LIVE=1 to run against the real chain");
  test.setTimeout(120_000);

  let safes: { debit?: Found; credit?: Found } = {};
  let errors: string[] = [];

  test.beforeAll(async () => {
    safes = await discover();
    expect(safes.debit || safes.credit, "found at least one real Safe to test with").toBeTruthy();
  });

  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
  });
  test.afterEach(() => expect(errors).toEqual([]));

  test("Mainnet shows a connect gate; Watch validates the address against the real factory", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByTestId("mode-mainnet").click();
    await expect(page.getByTestId("mainnet-gate")).toBeVisible();
    await expect(page.getByTestId("network-pill")).toHaveText("Optimism");
    await page.getByTestId("gate-watch").click();

    await page.getByTestId("safe-input").fill("not an address");
    await expect(page.getByTestId("safe-message")).toContainText("valid 0x");
    await expect(page.getByTestId("safe-link")).toBeDisabled();

    await page.getByTestId("safe-input").fill("0x000000000000000000000000000000000000dEaD");
    await expect(page.getByTestId("safe-message")).toContainText("not an Ether.fi Safe", { timeout: 30_000 });
    await expect(page.getByTestId("safe-link")).toBeDisabled();
  });

  test("live numbers match an independent on-chain read", async ({ page }) => {
    const s = (safes.credit ?? safes.debit)!;
    await watch(page, s.address);
    const truth = await client.readContract({ address: LENS, abi: cashLensAbi, functionName: "getSafeCashData", args: [s.address, []] });
    const collateral = Number(truth.totalCollateral) / 1e6;
    const borrow = Number(truth.totalBorrow) / 1e6;
    expect(Math.abs((await usd(page, "live-collateral")) - collateral)).toBeLessThanOrEqual(Math.max(1, collateral * 0.01));
    expect(Math.abs((await usd(page, "live-borrowed")) - borrow)).toBeLessThanOrEqual(Math.max(1, borrow * 0.01));
    await expect(page.getByTestId("safe-mode")).toHaveText(truth.mode === 0 ? "credit mode" : "debit mode");
    await expect(page.getByTestId("safe-role")).toHaveText("View-only");
    await expect(page.getByTestId("live-collateral-table")).toBeVisible();
    if (borrow > 0) {
      const hf = Number(((await page.getByTestId("live-hf").textContent()) ?? "").replace(/[^0-9.]/g, ""));
      expect(hf).toBeGreaterThan(1);
    } else {
      await expect(page.getByTestId("live-hf")).toContainText("no debt");
    }
    await expect(page.getByTestId("safe-address")).toHaveAttribute("href", new RegExp(`optimistic\\.etherscan\\.io/address/${s.address}`, "i"));
  });

  test("card check returns the contract's own verdict, including its decline reason", async ({ page }) => {
    const s = (safes.debit ?? safes.credit)!;
    await watch(page, s.address);
    await page.getByTestId("live-tab-pos").click();

    const ask = async (amountUsd: number) => {
      const r = await client.readContract({
        address: LENS,
        abi: cashLensAbi,
        functionName: "canSpendSingleToken",
        args: [s.address, keccak256(toHex(`e2e-${Date.now()}-${amountUsd}`)), [USDC], [USDC], BigInt(Math.round(amountUsd * 1e6))],
      });
      return { ok: r[2], reason: r[3] };
    };

    // Small swipe (the default preset, $4.85).
    const small = await ask(4.85);
    await page.getByTestId("pos-pay").click();
    if (small.ok) {
      await expect(page.getByTestId("pos-terminal")).toContainText("APPROVED", { timeout: 20_000 });
      await expect(page.getByTestId("receipt-source")).toHaveText("Ether.fi CashLens");
      await expect(page.getByTestId("pos-receipt")).toContainText("nothing was sent");
    } else {
      await expect(page.getByTestId("pos-terminal")).toContainText(`DECLINED: ${small.reason.toUpperCase()}`, { timeout: 20_000 });
    }

    // Absurd swipe: must decline, with the contract's reason.
    const huge = await ask(50_000_000);
    expect(huge.ok).toBe(false);
    await page.getByTestId("preset-custom").click();
    await page.getByTestId("custom-amount").fill("50000000");
    await page.getByTestId("pos-pay").click();
    await expect(page.getByTestId("pos-terminal")).toHaveText(`DECLINED: ${huge.reason.toUpperCase()}`, { timeout: 20_000 });
    await expect(page.getByTestId("pos-receipt")).toHaveCount(0);
  });

  test("if the RPC is unreachable the engine takes over and says so", async ({ page }) => {
    const s = (safes.credit ?? safes.debit)!;
    await watch(page, s.address);
    await page.getByTestId("live-tab-pos").click();
    await page.getByTestId("preset-custom").click();
    await page.getByTestId("custom-amount").fill("1");
    await page.route(/mainnet\.optimism\.io/, (route) => route.abort());
    await page.getByTestId("pos-pay").click();
    await expect(page.getByTestId("pos-terminal")).toContainText("APPROVED", { timeout: 20_000 });
    await expect(page.getByTestId("receipt-source")).toHaveText("OrventYield engine");
  });

  test("the chosen Safe and mode survive a reload", async ({ page }) => {
    const s = (safes.debit ?? safes.credit)!;
    await watch(page, s.address);
    await page.reload();
    await expect(page.getByTestId("mode-mainnet")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("live-dashboard")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("safe-address")).toHaveAttribute("title", s.address);
  });

  test("vouchers and payouts are explained, and Change Safe returns to the link form", async ({ page }) => {
    const s = (safes.debit ?? safes.credit)!;
    await watch(page, s.address);
    await page.getByTestId("live-tab-vouchers").click();
    await expect(page.getByTestId("locked-panel")).toContainText("Playground");
    await page.getByTestId("live-tab-cashout").click();
    await expect(page.getByTestId("locked-panel")).toContainText("Playground");
    await page.getByTestId("change-safe").click();
    await expect(page.getByTestId("link-safe")).toBeVisible();
  });
});
