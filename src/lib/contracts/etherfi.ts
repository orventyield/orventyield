/**
 * Ether.fi Cash (cash-v3) contract registry: the single, tracked source of truth for addresses.
 *
 * Provenance
 * - Addresses come from Ether.fi's official repo: github.com/etherfi-protocol/cash-v3,
 *   `deployments/mainnet/<chainId>/deployments.json` at commit a5024d0b (2026-10-05).
 * - Each entry is then checked ON-CHAIN by `npm run verify:contracts`: bytecode exists and, where possible,
 *   the contracts agree with each other (e.g. CashModule.getDebtManager() === DebtManager).
 * - `verified` = code present AND a cross-reference or identity check passed. `unverified` = listed upstream and
 *   code present, but no cross-reference yet. Never call anything that is not `verified` from the app.
 *
 * Topology (found by tracing the contracts)
 * - Optimism (10)   : the live Cash deployment (Safes, CashModule, DebtManager, settlement dispatchers).
 * - Scroll (534352) : legacy Cash deployment (same core addresses, proxies still present).
 * - Arbitrum/Base   : top-up source chains only (users bridge funds in); no Cash core.
 * - Card spend: `CashModule.spend()` is restricted to ETHER_FI_WALLET_ROLE, so a third-party app cannot execute
 *   a card spend on-chain. The card rails are settled by Ether.fi's partners (Reap, Rain, PIX, CardOrder).
 *
 * Last verified: 2026-10-19.
 */
export type VerifyStatus = "verified" | "unverified" | "no-code";

export interface ContractEntry {
  address: `0x${string}`;
  status: VerifyStatus;
  note: string;
}

export type ContractName =
  | "CashModule"
  | "CashLens"
  | "DebtManager"
  | "EtherFiDataProvider"
  | "EtherFiSafeFactory"
  | "PriceProvider"
  | "RoleRegistry"
  | "CashbackDispatcher"
  | "CashEventEmitter"
  | "LendGateway"
  | "SettlementDispatcherReap"
  | "SettlementDispatcherRain"
  | "SettlementDispatcherPix"
  | "SettlementDispatcherCardOrder"
  | "TopUpDest"
  | "TopUpSourceFactory"
  | "weETH"
  | "USDC";

export interface ChainRegistry {
  name: string;
  /** What this chain is used for in Ether.fi Cash. */
  role: "cash" | "legacy-cash" | "top-up-source";
  rpc: string;
  contracts: Partial<Record<ContractName, ContractEntry>>;
}

export const ETHERFI_SOURCE = {
  repo: "https://github.com/etherfi-protocol/cash-v3",
  commit: "a5024d0b6e81ac0e6f40335a08f697fc7aafde52",
  checkedAt: "2026-10-19",
} as const;

const v = (address: `0x${string}`, note: string): ContractEntry => ({ address, status: "verified", note });
const u = (address: `0x${string}`, note: string): ContractEntry => ({ address, status: "unverified", note });

/** Cross-reference note shared by the core Optimism contracts. */
const OP_GRAPH = "Cross-checked on-chain: contracts reference each other (CashModule, DebtManager, DataProvider, SafeFactory, PriceProvider).";

export const ETHERFI_REGISTRY: Record<number, ChainRegistry> = {
  10: {
    name: "Optimism",
    role: "cash",
    rpc: "https://mainnet.optimism.io",
    contracts: {
      CashModule: v("0x7Ca0b75E67E33c0014325B739A8d019C4FE445F0", `UUPS proxy. ${OP_GRAPH} spend() is restricted to ETHER_FI_WALLET_ROLE.`),
      CashLens: v("0x7DA874f3BacA1A8F0af27E5ceE1b8C66A772F84E", "Read-only aggregator. getSafeCashData() decoded against real Safes."),
      DebtManager: v("0x0078C5a459132e279056B2371fE8A8eC973A9553", `Lending/borrowing. ${OP_GRAPH}`),
      EtherFiDataProvider: v("0xDC515Cb479a64552c5A11a57109C314E40A1A778", `Registry of core contracts. ${OP_GRAPH}`),
      EtherFiSafeFactory: v("0xF4e147Db314947fC1275a8CbB6Cde48c510cd8CF", "Deploys EtherFiSafe accounts. isEtherFiSafe() true for real Safes, false for random addresses."),
      PriceProvider: v("0x44dd2372FE7B97C4B4D6a7d4DeCf72466485BAcB", `Oracle aggregator (Chainlink + accountant feeds). ${OP_GRAPH}`),
      RoleRegistry: u("0x5C1E3D653fcbC54Ae25c2AD9d59548D2082C687B", "Listed in official deployments.json; code present; no on-chain cross-reference checked."),
      CashbackDispatcher: u("0xef55eC694B0B8273967f28627C5BC26F5deea836", "Listed in official deployments.json; code present."),
      CashEventEmitter: u("0x380B2e96799405be6e3D965f4044099891881acB", "Listed in official deployments.json; code present."),
      LendGateway: v("0x01F8cDFb1694eA8fE4ED6c38a0fD78d1188E03F4", "Returned by CashModule.getLendGateway()."),
      SettlementDispatcherReap: v("0x9623e86Df854FF3b48F7B4079a516a4F64861Db2", "Returned by CashModule.getSettlementDispatcher(Reap)."),
      SettlementDispatcherRain: v("0x50A233C4a0Bb1d7124b0224880037d35767a501C", "Returned by CashModule.getSettlementDispatcher(Rain)."),
      SettlementDispatcherPix: v("0x95aaddD43b6edF838ec486E9f9814787212Bf42D", "Returned by CashModule.getSettlementDispatcher(PIX)."),
      SettlementDispatcherCardOrder: v("0xb14FDfd7D2cfFb6Cc6953C1b80F1B1d12c2F766a", "Returned by CashModule.getSettlementDispatcher(CardOrder)."),
      TopUpDest: u("0x3a6A724595184dda4be69dB1Ce726F2Ac3D66B87", "Listed in official deployments.json; code present."),
      weETH: v("0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF", "Ether.fi Wrapped eETH: symbol() = weETH, decimals() = 18; collateral token on DebtManager."),
      USDC: v("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", "Circle native USDC: symbol() = USDC, decimals() = 6; collateral + borrow token on DebtManager."),
    },
  },
  534352: {
    name: "Scroll (legacy)",
    role: "legacy-cash",
    rpc: "https://rpc.scroll.io",
    contracts: {
      CashModule: u("0x7Ca0b75E67E33c0014325B739A8d019C4FE445F0", "Legacy deployment (same core addresses as Optimism). Proxy code present; not used by this app."),
      DebtManager: u("0x0078C5a459132e279056B2371fE8A8eC973A9553", "Legacy deployment. Proxy code present; not used by this app."),
      EtherFiSafeFactory: u("0xF4e147Db314947fC1275a8CbB6Cde48c510cd8CF", "Legacy deployment. Proxy code present; not used by this app."),
      CashLens: u("0x7DA874f3BacA1A8F0af27E5ceE1b8C66A772F84E", "Legacy deployment. Proxy code present; not used by this app."),
    },
  },
  42161: {
    name: "Arbitrum One",
    role: "top-up-source",
    rpc: "https://arb1.arbitrum.io/rpc",
    contracts: {
      TopUpSourceFactory: u("0xF4e147Db314947fC1275a8CbB6Cde48c510cd8CF", "Top-up source factory (users bridge funds into their Safe). No Cash core on this chain."),
      weETH: v("0x35751007a407ca6FEFfE80b3cB397736D2cf4dbe", "Ether.fi Wrapped eETH: symbol() = weETH, decimals() = 18."),
      USDC: v("0xaf88d065e77c8cC2239327C5EDb3A432268e5831", "Circle native USDC: symbol() = USDC, decimals() = 6."),
    },
  },
  8453: {
    name: "Base",
    role: "top-up-source",
    rpc: "https://mainnet.base.org",
    contracts: {
      TopUpSourceFactory: u("0xF4e147Db314947fC1275a8CbB6Cde48c510cd8CF", "Top-up source factory. No Cash core on this chain."),
    },
  },
};

export interface CollateralToken {
  symbol: string;
  address: `0x${string}`;
  decimals: number;
  /** Max borrow as basis points of collateral value. */
  ltvBps: number;
  /** Liquidation threshold in basis points. */
  liqBps: number;
  liqBonusBps: number;
}

/**
 * Optimism collateral registry, snapshotted from DebtManager.getCollateralTokens() and
 * collateralTokenConfig() on 2026-10-19. The live app reads current values from the chain.
 */
export const OPTIMISM_COLLATERAL: readonly CollateralToken[] = [
  { symbol: "USDC", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6, ltvBps: 9000, liqBps: 9500, liqBonusBps: 100 },
  { symbol: "USDT", address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6, ltvBps: 9000, liqBps: 9500, liqBonusBps: 100 },
  { symbol: "weETH", address: "0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF", decimals: 18, ltvBps: 5500, liqBps: 7500, liqBonusBps: 350 },
  { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18, ltvBps: 5500, liqBps: 7500, liqBonusBps: 350 },
  { symbol: "frxUSD", address: "0x80Eede496655FB9047dd39d9f418d5483ED600df", decimals: 18, ltvBps: 9000, liqBps: 9500, liqBonusBps: 100 },
  { symbol: "liquidETH", address: "0xf0bb20865277aBd641a307eCe5Ee04E79073416C", decimals: 18, ltvBps: 5000, liqBps: 7000, liqBonusBps: 500 },
  { symbol: "liquidBTC", address: "0x5f46d540b6eD704C3c8789105F30E075AA900726", decimals: 8, ltvBps: 5000, liqBps: 7000, liqBonusBps: 500 },
  { symbol: "liquidUSD", address: "0x08c6F91e2B681FaF5e17227F2a44C307b3C1364C", decimals: 6, ltvBps: 8000, liqBps: 9000, liqBonusBps: 200 },
  { symbol: "eBTC", address: "0x657e8C867D8B37dCC18fA4Caead9C45EB088C642", decimals: 8, ltvBps: 5200, liqBps: 7200, liqBonusBps: 500 },
  { symbol: "eUSD", address: "0x939778D83b46B456224A33Fb59630B11DEC56663", decimals: 18, ltvBps: 8000, liqBps: 9000, liqBonusBps: 200 },
  { symbol: "EURC", address: "0xDCB612005417Dc906fF72c87DF732e5a90D49e11", decimals: 6, ltvBps: 9000, liqBps: 9500, liqBonusBps: 100 },
  { symbol: "WHYPE", address: "0xd83E3d560bA6F05094d9D8B3EB8aaEA571D1864E", decimals: 18, ltvBps: 4500, liqBps: 6500, liqBonusBps: 400 },
  { symbol: "ETHFI", address: "0xe0080d2F853ecDdbd81A643dC10DA075Df26fD3f", decimals: 18, ltvBps: 2000, liqBps: 5000, liqBonusBps: 500 },
  { symbol: "sETHFI", address: "0x86B5780b606940Eb59A062aA85a07959518c0161", decimals: 18, ltvBps: 2000, liqBps: 5000, liqBonusBps: 500 },
  { symbol: "beHYPE", address: "0xA519AfBc91986c0e7501d7e34968FEE51CD901aC", decimals: 18, ltvBps: 4000, liqBps: 6000, liqBonusBps: 500 },
  { symbol: "liquidRESERVE", address: "0xE5d3854736e0D513aAE2D8D708Ad94d14Fd56A6a", decimals: 18, ltvBps: 8000, liqBps: 9000, liqBonusBps: 100 },
  { symbol: "liquidRESERVE", address: "0xca5921DF65E2e1b0B98Ae91c0187BA80D4124898", decimals: 18, ltvBps: 8000, liqBps: 9000, liqBonusBps: 100 },
  { symbol: "weEUR", address: "0xcC476B1a49bcDf5192561e87b6Fb8ea78aa28C13", decimals: 18, ltvBps: 7000, liqBps: 9000, liqBonusBps: 200 },
  { symbol: "liquidRWA", address: "0x17bC8Ffd82b8a36e737Ca1141C025089589B915e", decimals: 18, ltvBps: 7000, liqBps: 8000, liqBonusBps: 400 },
  { symbol: "OP", address: "0x4200000000000000000000000000000000000042", decimals: 18, ltvBps: 2000, liqBps: 5000, liqBonusBps: 500 },
  { symbol: "iwSPYx", address: "0xc1e636Aae7d6B46229FC2C362d562610519e8D7c", decimals: 18, ltvBps: 7300, liqBps: 7800, liqBonusBps: 750 },
  { symbol: "iPAXG", address: "0x41a7f2bb9789199654c206f09392674c1Af6676c", decimals: 18, ltvBps: 7500, liqBps: 8000, liqBonusBps: 600 },
  { symbol: "iwQQQx", address: "0x3c99d3a81b27583B2E26dbd387C10411f2763516", decimals: 18, ltvBps: 7300, liqBps: 7800, liqBonusBps: 750 },
  { symbol: "iwTBLLx", address: "0x5F8b2D2b97aD4d63188f44965778F6004D5bc387", decimals: 18, ltvBps: 7000, liqBps: 8000, liqBonusBps: 1000 },
  { symbol: "USD₮0", address: "0x01bFF41798a0BcF287b996046Ca68b395DbC1071", decimals: 6, ltvBps: 9000, liqBps: 9500, liqBonusBps: 100 },
  { symbol: "ZCHF", address: "0xD4dD9e2F021BB459D5A5f6c24C12fE09c5D45553", decimals: 18, ltvBps: 7500, liqBps: 8500, liqBonusBps: 750 },
  { symbol: "iPAXGy", address: "0x5168E0cDeb3f308F47fDF0D9A2E250A2135C3cF5", decimals: 18, ltvBps: 6700, liqBps: 7500, liqBonusBps: 1000 },
];

export function getContract(chainId: number, name: ContractName): ContractEntry | undefined {
  return ETHERFI_REGISTRY[chainId]?.contracts[name];
}

/** Address only if it is verified; otherwise null so callers fall back to the sandbox. */
export function verifiedAddress(chainId: number, name: ContractName): `0x${string}` | null {
  const c = getContract(chainId, name);
  return c && c.status === "verified" ? c.address : null;
}

const BY_ADDRESS = new Map(OPTIMISM_COLLATERAL.map((t) => [t.address.toLowerCase(), t] as const));

export function collateralTokenByAddress(address: string): CollateralToken | undefined {
  return BY_ADDRESS.get(address.toLowerCase());
}

/** The chain where Ether.fi Cash actually runs. */
export const CASH_CHAIN_ID = 10;
