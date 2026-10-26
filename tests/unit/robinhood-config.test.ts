import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { morphoVaultV2Abi } from "../../src/lib/contracts/abis/MorphoVaultV2";
import { ARBITRUM } from "../../src/lib/contracts/arbitrum";
import { ROBINHOOD, ROBINHOOD_CHAIN_ID, ROBINHOOD_VAULT_ALLOWLIST } from "../../src/lib/contracts/robinhood";
import { approveData, assertAllowedVault, depositData, withdrawToData, withdrawYieldData } from "../../src/lib/morpho/account";

describe("Robinhood Chain config", () => {
  it("chain id and addresses are checksummed and exactly the verified ones", () => {
    expect(ROBINHOOD_CHAIN_ID).toBe(4663);
    for (const a of Object.values(ROBINHOOD)) expect(getAddress(a)).toBe(a);
    expect(ROBINHOOD.steakhouseUsdgVault).toBe("0xBeEff033F34C046626B8D0A041844C5d1A5409dd");
    expect(ROBINHOOD.usdg).toBe("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
  });
  it("Safe v1.4.1 addresses equal Arbitrum's (identical bytecode), so the same Safe helpers produce the same Safe address on both chains (create2 uses factory + singleton + creation code)", () => {
    expect(ROBINHOOD.safeProxyFactory).toBe(ARBITRUM.safeProxyFactory);
    expect(ROBINHOOD.safeL2Singleton).toBe(ARBITRUM.safeL2Singleton);
    expect(ROBINHOOD.safeFallbackHandler).toBe(ARBITRUM.safeFallbackHandler);
    expect(ROBINHOOD.safeMultiSendCallOnly).toBe(ARBITRUM.safeMultiSendCallOnly);
  });
});

describe("vault allowlist and calldata", () => {
  it("only the Steakhouse USDG vault is allowed", () => {
    expect(ROBINHOOD_VAULT_ALLOWLIST).toEqual([ROBINHOOD.steakhouseUsdgVault]);
    expect(assertAllowedVault(ROBINHOOD.steakhouseUsdgVault.toLowerCase())).toBe(ROBINHOOD.steakhouseUsdgVault);
    expect(() => assertAllowedVault("0x37788ff0c1d4e45A7FE06BC7e71e0cc00121d0A8")).toThrow(/allowlist/);
    expect(() => assertAllowedVault(ROBINHOOD.morphoBlue)).toThrow(/allowlist/);
  });
  it("ABI event positions used by the log reader are the Deposit and Withdraw events", () => {
    expect(morphoVaultV2Abi[11].name).toBe("Deposit");
    expect(morphoVaultV2Abi[12].name).toBe("Withdraw");
  });
  it("calldata uses exact amounts and the right selectors", () => {
    const safe = "0x1111111111111111111111111111111111111111" as const;
    expect(approveData(5n).startsWith("0x095ea7b3")).toBe(true); // approve(address,uint256)
    expect(approveData(5n).endsWith("5".padStart(64, "0"))).toBe(true); // exactly 5, never max
    expect(approveData(5n)).not.toContain("f".repeat(64));
    expect(depositData(7n, safe).startsWith("0x6e553f65")).toBe(true); // deposit(uint256,address)
    expect(withdrawYieldData(7n, safe).startsWith("0xb460af94")).toBe(true); // withdraw(uint256,address,address)
    expect(withdrawToData(7n, "0x2222222222222222222222222222222222222222", safe).startsWith("0xb460af94")).toBe(true);
    // yield: receiver == owner == Safe; principal exit: receiver differs
    expect(withdrawYieldData(7n, safe)).not.toBe(withdrawToData(7n, "0x2222222222222222222222222222222222222222", safe));
  });
});
