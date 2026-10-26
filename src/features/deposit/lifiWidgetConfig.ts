import { formatUnits, getAddress, isAddress, type Address } from "viem";
import type { WidgetConfig } from "@lifi/widget";
import { supplyData } from "../../lib/aave/account";
import { ARBITRUM, ARBITRUM_CHAIN_ID } from "../../lib/contracts/arbitrum";
import { ROBINHOOD, ROBINHOOD_CHAIN_ID } from "../../lib/contracts/robinhood";

/**
 * Pure builder for the LI.FI "Bridge & Deposit" widget configuration. No React, no network.
 *
 * Destination is locked to native USDC on Arbitrum One or Paxos USDG on Robinhood Chain, received by the user's Safe (the
 * address is shown but cannot be edited).
 * Modes:
 *  - plain (default): USDC/USDG lands in the Safe; the Safe -> vault supply step then deposits it.
 *  - contract call (`supplyAmount` given on Arbitrum): LI.FI also runs Aave Pool.supply(USDC, amount, onBehalfOf=Safe, 0),
 *    so the funds land as aUSDC.
 */

export const LIFI_INTEGRATOR = "OrventYield";
/** Source chains the widget may spend from: Ethereum, Base, Optimism, Polygon, Arbitrum. */
export const SOURCE_CHAIN_IDS = [1, 8453, 10, 137, 42161] as const;
export const USDC_DECIMALS = 6;
/** Default slippage 0.5% (widget takes a fraction). */
export const DEFAULT_SLIPPAGE = 0.005;
/** Gas limit LI.FI is told to reserve for the destination Pool.supply call. Estimate, not measured on-chain. */
export const SUPPLY_CALL_GAS_LIMIT = "500000";

/**
 * Token allowlist for the "from" side. Addresses were read from the LI.FI token API (GET https://li.quest/v1/tokens) on
 * 2026-10-20 and match the canonical issuer deployments; ETH is the zero address. Arbitrum USDT is intentionally absent
 * because it was not returned by that query and we do not guess addresses.
 */
export const SOURCE_TOKENS: ReadonlyArray<{ chainId: number; symbol: string; address: Address }> = [
  { chainId: 1, symbol: "ETH", address: "0x0000000000000000000000000000000000000000" },
  { chainId: 1, symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  { chainId: 1, symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7" },
  { chainId: 1, symbol: "DAI", address: "0x6B175474E89094C44Da98b954EedeAC495271d0F" },
  { chainId: 8453, symbol: "ETH", address: "0x0000000000000000000000000000000000000000" },
  { chainId: 8453, symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  { chainId: 8453, symbol: "USDT", address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2" },
  { chainId: 8453, symbol: "DAI", address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb" },
  { chainId: 10, symbol: "ETH", address: "0x0000000000000000000000000000000000000000" },
  { chainId: 10, symbol: "USDC", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" },
  { chainId: 10, symbol: "USDT", address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58" },
  { chainId: 10, symbol: "DAI", address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1" },
  { chainId: 137, symbol: "USDC", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" },
  { chainId: 137, symbol: "USDT", address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F" },
  { chainId: 137, symbol: "DAI", address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063" },
  { chainId: 42161, symbol: "ETH", address: "0x0000000000000000000000000000000000000000" },
  { chainId: 42161, symbol: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
  { chainId: 42161, symbol: "DAI", address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1" },
];

/** Dark-glass tokens from src/app/globals.css (@theme). Kept literal because the widget themes through MUI, not CSS vars. */
const PALETTE = {
  bg: "#07080c",
  surface: "#111319",
  surface2: "#171a22",
  cyan: "#00f0ff",
  emerald: "#10b981",
  amber: "#f59e0b",
  danger: "#ef4444",
  fg: "#e6e8ee",
  muted: "#8a8f9e",
} as const;

export interface BuildLifiConfigInput {
  /** The user's Safe. Required: the widget must never fall back to the connected EOA. */
  safe: string;
  /** Destination chain ID (defaults to Arbitrum One: 42161). Can be set to 4663 for Robinhood Chain. */
  toChainId?: number;
  /** Destination token address (defaults to native USDC on Arbitrum, or Paxos USDG on Robinhood Chain). */
  toTokenAddress?: Address;
  /** USDC base units. When > 0, add the destination Aave supply call so funds arrive as aUSDC. */
  supplyAmount?: bigint;
  /** Optional LI.FI partner key. NOTE: anything passed here ships in the public bundle. */
  apiKey?: string;
  /** Opens our own connect modal from the widget's "Connect wallet" button. */
  onConnect?: () => void;
}

export function buildLifiWidgetConfig(input: BuildLifiConfigInput): WidgetConfig {
  if (!isAddress(input.safe, { strict: false }) || /^0x0{40}$/i.test(input.safe)) {
    throw new Error("A valid Safe address is required to configure the deposit widget.");
  }
  const safe = getAddress(input.safe);
  const supply = input.supplyAmount ?? 0n;
  if (supply < 0n) throw new Error("supplyAmount must not be negative.");

  const destChainId = input.toChainId ?? ARBITRUM_CHAIN_ID;
  const isRobinhood = destChainId === ROBINHOOD_CHAIN_ID;
  const destToken = input.toTokenAddress ?? (isRobinhood ? (ROBINHOOD.usdg as Address) : ARBITRUM.usdc);
  const safeName = isRobinhood ? "Your Robinhood Safe" : "Your OrventYield Safe";

  const config: WidgetConfig = {
    integrator: LIFI_INTEGRATOR,
    ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    variant: "compact",
    appearance: "dark",
    slippage: DEFAULT_SLIPPAGE,

    // Destination: locked.
    toChain: destChainId,
    toToken: destToken,
    // "EVM" is the value of @lifi/sdk's ChainType.EVM; spelled out so this module stays free of runtime SDK imports.
    toAddress: { address: safe, chainType: "EVM" as NonNullable<WidgetConfig["toAddress"]>["chainType"], name: safeName },
    disabledUI: { toAddress: true, toToken: true },
    hiddenUI: { appearance: true, language: true },
    requiredUI: { toAddress: true },

    // Source: five chains, four asset families. Destination: target chain & token.
    chains: { from: { allow: [...SOURCE_CHAIN_IDS] }, to: { allow: [destChainId] } },
    tokens: {
      from: { allow: SOURCE_TOKENS.map((t) => ({ chainId: t.chainId, address: t.address })) },
      to: { allow: [{ chainId: destChainId, address: destToken }] },
    },

    walletConfig: { onConnect: input.onConnect },

    theme: {
      colorSchemes: {
        dark: {
          palette: {
            primary: { main: PALETTE.cyan },
            secondary: { main: PALETTE.emerald },
            error: { main: PALETTE.danger },
            warning: { main: PALETTE.amber },
            success: { main: PALETTE.emerald },
            background: { default: PALETTE.bg, paper: PALETTE.surface },
            text: { primary: PALETTE.fg, secondary: PALETTE.muted },
            grey: { 200: "rgba(255,255,255,0.08)", 300: "rgba(255,255,255,0.12)", 700: PALETTE.muted, 800: PALETTE.surface2, 900: PALETTE.surface },
          },
        },
      },
      shape: { borderRadius: 16, borderRadiusSecondary: 12 },
      typography: { fontFamily: "var(--font-inter), Inter, ui-sans-serif, system-ui, sans-serif" },
      container: { boxShadow: "0 0 0 1px rgba(0,240,255,0.18), 0 0 40px -12px rgba(0,240,255,0.25)", border: "none", borderRadius: "20px", background: PALETTE.surface },
      components: {
        // Input blocks (From / To): soft glass cards that light up on hover and focus.
        MuiCard: {
          styleOverrides: {
            root: {
              border: "1px solid rgba(255,255,255,0.08)",
              backgroundColor: PALETTE.surface2,
              transition: "border-color 0.15s ease, box-shadow 0.15s ease",
              "&:hover, &:focus-within": { borderColor: "rgba(0,240,255,0.45)", boxShadow: "0 0 18px -6px rgba(0,240,255,0.4)" },
            },
          },
        },
        MuiButton: { styleOverrides: { root: { textTransform: "none", fontWeight: 600 } } },
      },
    },
    // Plain-English labels: the whole flow reads "You pay" -> "You receive" -> "Review & Bridge" -> "Bridge & Deposit". The widget keeps the same label on a disabled button (it has no insufficient-funds label), so the reason is shown by useSourceFunds instead.
    languageResources: {
      en: {
        header: { exchange: "Pay with any token", from: "You pay", to: "You receive", youPay: "You pay", send: "Amount" },
        main: { from: "You pay", to: "You receive" },
        button: { exchange: "Review & Bridge", review: "Review & Bridge", bridgeReview: "Review & Bridge", swapReview: "Review & Bridge", depositReview: "Review & Bridge", startBridging: "Bridge & Deposit", startSwapping: "Bridge & Deposit", confirm: "Confirm" },
      },
    },
  };

  if (supply > 0n && !isRobinhood) {
    config.mode = "custom";
    config.modeOptions = { custom: { type: "deposit" } };
    // The widget wants a human decimal string for toAmount (it parses it with the token decimals).
    config.toAmount = formatUnits(supply, USDC_DECIMALS);
    config.contractTool = { name: "Aave v3", logoURI: "https://app.aave.com/favicon.ico" };
    config.contractCalls = [
      {
        fromAmount: supply.toString(),
        fromTokenAddress: ARBITRUM.usdc,
        toContractAddress: ARBITRUM.aavePool,
        toContractCallData: supplyData(supply, safe),
        toContractGasLimit: SUPPLY_CALL_GAS_LIMIT,
      },
    ];
  }
  return config;
}
