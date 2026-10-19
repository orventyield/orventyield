import { parseAbi } from "viem";

/** Aave v3 Pool: only what we call. Event shapes verified on the Arbitrum fork (see scripts/fork-safe-aave.mjs). */
export const poolAbi = parseAbi([
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function withdraw(address asset, uint256 amount, address to) returns (uint256)",
  "function getReserveData(address asset) view returns ((uint256,uint128,uint128,uint128,uint128,uint128,uint40,uint16,address,address,address,address,uint128,uint128,uint128))",
  "event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)",
  "event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)",
]);

/** Index of aTokenAddress / currentLiquidityRate inside the getReserveData tuple. */
export const RESERVE_ATOKEN = 8;
export const RESERVE_LIQUIDITY_RATE = 2;
