/**
 * Minimal ABIs for the Ether.fi Cash contracts the app reads.
 * Derived from the official interfaces in etherfi-protocol/cash-v3 (src/interfaces) and decoded against
 * the deployed contracts on Optimism (see tests/integration/etherfi-live.test.ts).
 */
import { parseAbi } from "viem";

export const cashLensAbi = parseAbi([
  "struct TokenData { address token; uint256 amount; }",
  "struct WithdrawalRequest { address[] tokens; uint256[] amounts; address recipient; uint96 finalizeTime; }",
  "struct DebitModeMaxSpend { address[] spendableTokens; uint256[] spendableAmounts; uint256[] amountsInUsd; uint256 totalSpendableInUsd; }",
  "struct SafeCashData { uint8 mode; TokenData[] collateralBalances; TokenData[] borrows; TokenData[] tokenPrices; WithdrawalRequest withdrawalRequest; uint256 totalCollateral; uint256 totalBorrow; uint256 maxBorrow; uint256 creditMaxSpend; uint256 spendingLimitAllowance; uint256 totalCashbackEarnedInUsd; uint256 incomingModeStartTime; DebitModeMaxSpend debitMaxSpend; }",
  "function getSafeCashData(address safe, address[] debtServiceTokenPreference) view returns (SafeCashData)",
  // Deployed signatures (differ from the single-token interface file in the repo): arrays in, verdict + reason out.
  "function canSpend(address safe, bytes32 txId, address[] tokens, uint256[] amountsInUsd) view returns (bool, string)",
  "function canSpendSingleToken(address safe, bytes32 txId, address[] creditModeTokenPreferences, address[] debitModeTokenPreferences, uint256 amountInUsd) view returns (uint8 mode, address token, bool canSpendResult, string declineReason)",
]);

export const debtManagerAbi = parseAbi([
  "struct CollateralTokenConfig { uint80 ltv; uint80 liquidationThreshold; uint96 liquidationBonus; }",
  "function getCollateralTokens() view returns (address[])",
  "function getBorrowTokens() view returns (address[])",
  "function collateralTokenConfig(address collateralToken) view returns (CollateralTokenConfig)",
  "function borrowApyPerSecond(address borrowToken) view returns (uint64)",
  "function getMaxBorrowAmount(address user, bool forLtv) view returns (uint256)",
  "function liquidatable(address user) view returns (bool)",
]);

export const safeFactoryAbi = parseAbi([
  "function isEtherFiSafe(address safeAddr) view returns (bool)",
  "function getDeployedAddresses(uint256 start, uint256 n) view returns (address[])",
  "function getDeterministicAddress(bytes32 salt) view returns (address)",
  "function numContractsDeployed() view returns (uint256)",
]);

export const etherFiSafeAbi = parseAbi([
  "function getOwners() view returns (address[])",
  "function isAdmin(address account) view returns (bool)",
  "function getThreshold() view returns (uint8)",
]);

export const cashModuleAbi = parseAbi([
  "function getMode(address safe) view returns (uint8)",
  "function getDebtManager() view returns (address)",
  "function etherFiDataProvider() view returns (address)",
  "function getLendGateway() view returns (address)",
  "function getSettlementDispatcher(uint8 binSponsor) view returns (address)",
  "function getDelays() view returns (uint64, uint64, uint64)",
]);

export const dataProviderAbi = parseAbi([
  "function getCashModule() view returns (address)",
  "function getEtherFiSafeFactory() view returns (address)",
  "function getPriceProvider() view returns (address)",
]);

export const priceProviderAbi = parseAbi(["function price(address token) view returns (uint256)"]);

/** CashModule.BinSponsor */
export const BIN_SPONSOR = { Reap: 0, Rain: 1, PIX: 2, CardOrder: 3 } as const;
/** CashModule.Mode */
export const CASH_MODE = { Credit: 0, Debit: 1 } as const;
