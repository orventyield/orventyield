/**
 * Mainnet mode with a connected wallet: the account is found automatically, with nothing to paste.
 * Needs network (LIVE=1). The index files are served by the test so the outcome does not depend on a built index.
 */
import { existsSync } from "node:fs";
import { createPublicClient, encodeAbiParameters, formatUnits, http, keccak256, toHex, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { optimism } from "viem/chains";
import { expect, test, type Page } from "@playwright/test";
import { cashLensAbi, etherFiSafeAbi, priceProviderAbi, safeFactoryAbi } from "../../src/lib/etherfi/abi";
import { ETHERFI_REGISTRY, OPTIMISM_COLLATERAL } from "../../src/lib/contracts/etherfi";
import { buildShard } from "../../src/lib/etherfi/safeIndex";
import { erc20Abi } from "../../src/lib/contracts/abis";
import { installMockWallet } from "./helpers";

const LIVE = process.env.LIVE === "1";
const client = createPublicClient({ chain: optimism, transport: http(ETHERFI_REGISTRY[10]!.rpc), batch: { multicall: true } });
const C = ETHERFI_REGISTRY[10]!.contracts;
const OWNERS_TOPIC = keccak256(toHex("OwnersConfigured(address[],bool[])"));
const nosign = async () => "0x";

/** A real Safe with a balance, plus one of its current owners. */
async function realSafeAndOwner(): Promise<{ safe: Address; owner: Address }> {
  for (let start = 0; start < 1500; start += 100) {
    const safes = await client.readContract({ address: C.EtherFiSafeFactory!.address, abi: safeFactoryAbi, functionName: "getDeployedAddresses", args: [BigInt(start), 100n] });
    const res = await Promise.allSettled(safes.map((s) => client.readContract({ address: C.CashLens!.address, abi: cashLensAbi, functionName: "getSafeCashData", args: [s, []] })));
    for (let i = 0; i < res.length; i++) {
      const r = res[i]!;
      if (r.status === "fulfilled" && Number(r.value.totalCollateral) / 1e6 > 50) {
        const owners = await client.readContract({ address: safes[i]!, abi: etherFiSafeAbi, functionName: "getOwners" });
        if (owners.length === 1) return { safe: safes[i]!, owner: owners[0]! };
      }
    }
  }
  throw new Error("no suitable Safe found");
}

/** Serve a controlled index: `entries` map owner -> Safe; head is a little behind the chain. */
async function serveIndex(page: Page, entries: [string, string][], headOffset = 3000) {
  const head = Number(await client.getBlockNumber()) - headOffset;
  const byPrefix = new Map<string, [string, string][]>();
  for (const [o, s] of entries) {
    const p = o.toLowerCase().slice(2, 4);
    byPrefix.set(p, [...(byPrefix.get(p) ?? []), [o, s]]);
  }
  await page.route("**/safe-index/meta.json", (r) => r.fulfill({ json: { version: 1, headBlock: head, safes: entries.length, owners: entries.length, generatedAt: "test" } }));
  await page.route(/\/safe-index\/[0-9a-f]{2}\.bin$/, (r) => {
    const prefix = r.request().url().match(/([0-9a-f]{2})\.bin$/)![1]!;
    return r.fulfill({ status: 200, body: Buffer.from(buildShard(byPrefix.get(prefix) ?? [])) });
  });
  return head;
}

async function connect(page: Page, owner: string) {
  await installMockWallet(page, owner, nosign, "0xa");
  await page.goto("/dashboard");
  await page.getByTestId("connect-wallet").click();
  await page.getByTestId("wallet-option-test.wallet").click();
  await expect(page.getByTestId("account-button")).toBeVisible();
  await expect(page.getByTestId("mode-mainnet")).toHaveAttribute("aria-checked", "true");
}

test.describe("automatic account discovery for the connected wallet", () => {
  test.skip(!LIVE, "set LIVE=1 to run against the real chain");
  test.setTimeout(120_000);
  let real: { safe: Address; owner: Address };
  test.beforeAll(async () => {
    real = await realSafeAndOwner();
  });

  test("the wallet's Safe is found from the index: no address to paste, and the wallet is the owner", async ({ page }) => {
    await serveIndex(page, [[real.owner, real.safe]]);
    await connect(page, real.owner);
    await expect(page.getByTestId("live-dashboard")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("link-safe")).toHaveCount(0);
    await expect(page.getByTestId("safe-address")).toHaveAttribute("title", real.safe);
    await expect(page.getByTestId("safe-role")).toHaveText("Owner");
    await expect(page.getByTestId("change-safe")).toHaveCount(0); // nothing to change for an auto-found account
  });

  test("the real built index (npm run index:safes) resolves a real owner end to end", async ({ page }) => {
    test.skip(!existsSync("public/safe-index/meta.json"), "run `npm run index:safes` first");
    await connect(page, real.owner); // no interception: the dev server serves public/safe-index
    await expect(page.getByTestId("live-dashboard")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("safe-address")).toHaveAttribute("title", real.safe);
    await expect(page.getByTestId("safe-role")).toHaveText("Owner");
  });

  test("a Safe created after the index was built is found by the recent-blocks scan", async ({ page }) => {
    const head = await serveIndex(page, []); // index knows nothing about this wallet
    await page.route(/mainnet\.optimism\.io/, async (route) => {
      const body = route.request().postDataJSON?.();
      if (body && !Array.isArray(body) && body.method === "eth_getLogs") {
        const data = encodeAbiParameters([{ type: "address[]" }, { type: "bool[]" }], [[real.owner], [true]]);
        return route.fulfill({
          json: {
            jsonrpc: "2.0",
            id: body.id,
            result: [
              {
                address: real.safe,
                blockHash: `0x${"ab".repeat(32)}`,
                blockNumber: toHex(head + 500),
                data,
                logIndex: "0x0",
                removed: false,
                topics: [OWNERS_TOPIC],
                transactionHash: `0x${"cd".repeat(32)}`,
                transactionIndex: "0x0",
              },
            ],
          },
        });
      }
      return route.continue();
    });
    await connect(page, real.owner);
    await expect(page.getByTestId("live-dashboard")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("safe-address")).toHaveAttribute("title", real.safe);
  });

  test("a claimed Safe that the wallet does not actually own is never shown", async ({ page }) => {
    const stranger = privateKeyToAccount(generatePrivateKey()).address;
    await serveIndex(page, [[stranger, real.safe]]); // a wrong index entry
    await connect(page, stranger);
    await expect(page.getByTestId("no-account")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("live-dashboard")).toHaveCount(0);
  });

  test("a wallet without a Cash account sees its own live holdings and a clear next step", async ({ page }) => {
    // The Safe's own address works as a wallet that holds tokens but is not an owner of anything.
    await serveIndex(page, []);
    await connect(page, real.safe);
    await expect(page.getByTestId("no-account")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("open-cash-account")).toHaveAttribute("href", "https://ether.fi");
    await expect(page.getByTestId("link-safe")).toHaveCount(0);

    // Independent read of the same wallet.
    const tracked = OPTIMISM_COLLATERAL.filter((t) => ["USDC", "USDT", "weETH", "WETH", "OP"].includes(t.symbol));
    const weth = tracked.find((t) => t.symbol === "WETH")!;
    let total = 0;
    let power = 0;
    for (const t of tracked) {
      const [bal, price] = await Promise.all([
        client.readContract({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [real.safe] }),
        client.readContract({ address: C.PriceProvider!.address, abi: priceProviderAbi, functionName: "price", args: [t.address] }),
      ]);
      const v = Number(formatUnits(bal, t.decimals)) * (Number(price) / 1e6);
      total += v;
      power += v * (t.ltvBps / 10_000);
    }
    const eth = Number(formatUnits(await client.getBalance({ address: real.safe }), 18));
    const wp = Number(await client.readContract({ address: C.PriceProvider!.address, abi: priceProviderAbi, functionName: "price", args: [weth.address] })) / 1e6;
    total += eth * wp;
    power += eth * wp * (weth.ltvBps / 10_000);

    const shownTotal = Number(((await page.getByTestId("wallet-total").textContent()) ?? "").replace(/[^0-9.]/g, ""));
    const shownPower = Number(((await page.getByTestId("wallet-power").textContent()) ?? "").replace(/[^0-9.]/g, ""));
    expect(Math.abs(shownTotal - total)).toBeLessThanOrEqual(Math.max(1, total * 0.01));
    expect(Math.abs(shownPower - power)).toBeLessThanOrEqual(Math.max(1, power * 0.01));
  });

  test("a brand-new wallet gets a friendly empty state, and manual linking is still possible", async ({ page }) => {
    const fresh = privateKeyToAccount(generatePrivateKey()).address;
    await serveIndex(page, []);
    await connect(page, fresh);
    await expect(page.getByTestId("no-account")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("wallet-total")).toHaveText("$0.00", { timeout: 30_000 });
    await expect(page.getByTestId("wallet-portfolio")).toContainText("No supported assets");
    await page.getByTestId("manual-link").click();
    await expect(page.getByTestId("link-safe")).toBeVisible();
  });

  test("connecting a wallet replaces a previously watched Safe", async ({ page }) => {
    const fresh = privateKeyToAccount(generatePrivateKey()).address;
    await serveIndex(page, []);
    await page.addInitScript((safe) => window.localStorage.setItem("oy.safe", safe), real.safe);
    await installMockWallet(page, fresh, nosign, "0xa");
    await page.goto("/dashboard");
    await page.getByTestId("mode-mainnet").click();
    await expect(page.getByTestId("live-dashboard")).toBeVisible({ timeout: 60_000 }); // the watched Safe
    await page.getByTestId("connect-wallet").click();
    await page.getByTestId("wallet-option-test.wallet").click();
    await expect(page.getByTestId("no-account")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("live-dashboard")).toHaveCount(0);
  });
});
