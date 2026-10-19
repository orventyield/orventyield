import { describe, expect, it } from "vitest";
import { buildLedger } from "../../src/features/ledger/mainnetLedger";
import type { PoolEvent } from "../../src/lib/aave/position";

const SAFE = "0xaaaa000000000000000000000000000000000001";
const OWNER = "0xbbbb000000000000000000000000000000000002";
const ev = (o: Partial<PoolEvent> & Pick<PoolEvent, "kind" | "amount" | "counterparty">): PoolEvent => ({ txHash: "0x" + "1".repeat(64), timestamp: 1000, ...o });

describe("mainnet ledger", () => {
  it("is empty with no activity (zero case)", () => {
    expect(buildLedger([], SAFE, [])).toEqual([]);
  });

  it("maps deposits, yield withdrawals and principal exits, newest first", () => {
    const rows = buildLedger(
      [
        ev({ kind: "supply", amount: 1_000_000_000n, counterparty: SAFE, timestamp: 1000 }),
        ev({ kind: "withdraw", amount: 1_900_000n, counterparty: SAFE, timestamp: 3000 }),
        ev({ kind: "withdraw", amount: 400_000_000n, counterparty: OWNER, timestamp: 2000 }),
      ],
      SAFE,
      [],
    );
    expect(rows.map((r) => [r.type, r.title, r.amountUsd])).toEqual([
      ["withdraw", "Yield withdrawn", 1.9],
      ["withdraw", "Principal withdrawn", 400],
      ["deposit", "Deposited to Aave", 1000],
    ]);
    expect(rows.every((r) => r.simulated === false)).toBe(true);
  });

  it("ignores supplies made for other beneficiaries", () => {
    expect(buildLedger([ev({ kind: "supply", amount: 5n, counterparty: OWNER })], SAFE, [])).toEqual([]);
  });

  it("shows a yield withdrawal that paid a voucher as that voucher, once", () => {
    const rows = buildLedger(
      [ev({ kind: "withdraw", amount: 1_500_000n, counterparty: SAFE, timestamp: 5000 })],
      SAFE,
      [{ invoiceId: "inv1", brand: "Swiggy", face: "USD 5", priceUsdc: 1.5, at: 4900 }],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "voucher_redeem", title: "Swiggy voucher · USD 5", amountUsd: 1.5 });
  });

  it("keeps a voucher whose payment is not loaded yet, and uses each payment only once", () => {
    const rows = buildLedger(
      [ev({ kind: "withdraw", amount: 1_500_000n, counterparty: SAFE, timestamp: 5000 })],
      SAFE,
      [
        { invoiceId: "a", brand: "Swiggy", face: "USD 5", priceUsdc: 1.5, at: 4000 },
        { invoiceId: "b", brand: "Zomato", face: "USD 5", priceUsdc: 1.5, at: 6000 },
      ],
    );
    expect(rows.map((r) => r.type)).toEqual(["voucher_redeem", "voucher_redeem"]);
    expect(rows[0]!.title).toContain("Zomato"); // unmatched one, newest
  });

  it("builds explorer links only when a hash and explorer exist", () => {
    const [a] = buildLedger([ev({ kind: "supply", amount: 1n, counterparty: SAFE, txHash: "0xabc" })], SAFE, [], "https://arbiscan.io");
    expect(a!.explorerUrl).toBe("https://arbiscan.io/tx/0xabc");
    const [b] = buildLedger([ev({ kind: "supply", amount: 1n, counterparty: SAFE, txHash: "0xabc" })], SAFE, []);
    expect(b!.explorerUrl).toBeUndefined();
  });
});
