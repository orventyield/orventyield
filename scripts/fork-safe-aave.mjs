#!/usr/bin/env node
// Fork test for the permissionless core (D10): canonical Safe + Aave v3 deposit + yield accrual.
// Needs the Arbitrum fork: `bash scripts/anvil-fork.sh`. Nothing touches a real network.
//   node scripts/fork-safe-aave.mjs
import {
  createPublicClient, createWalletClient, http, parseAbi, parseUnits, encodeFunctionData, encodePacked,
  getContractAddress, keccak256, encodeAbiParameters, parseAbiParameters, zeroAddress, concat, pad, getAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";

const RPC = process.env.RPC ?? "http://127.0.0.1:8545";
// Anvil's well-known dev key #0 (public, funded only on the local fork).
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// Canonical Safe v1.4.1 + Aave v3 (Arbitrum). Verified on the fork: code present, reserve data readable.
const A = {
  factory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
  singleton: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
  fallback: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
  multiSend: "0x9641d764fc13c8B624c04430C7356C1C7C8102e2",
  aavePool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
};

const chain = { ...arbitrum, id: 31337, rpcUrls: { default: { http: [RPC] } } };
const account = privateKeyToAccount(KEY);
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account, chain, transport: http(RPC) });

const factoryAbi = parseAbi([
  "function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
  "function proxyCreationCode() view returns (bytes)",
]);
const safeAbi = parseAbi([
  "function setup(address[] owners, uint256 threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
  "function nonce() view returns (uint256)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
  "function getOwners() view returns (address[])",
]);
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
]);
const poolAbi = parseAbi([
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function withdraw(address asset, uint256 amount, address to) returns (uint256)",
  "function getReserveData(address) view returns ((uint256,uint128,uint128,uint128,uint128,uint128,uint40,uint16,address,address,address,address,uint128,uint128,uint128))",
]);
const multiSendAbi = parseAbi(["function multiSend(bytes transactions)"]);

const must = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); process.exit(1); } console.log("ok  ", msg); };
const send = async (req) => {
  const { request } = await pub.simulateContract({ account, ...req }); // simulate -> send -> receipt
  const hash = await wallet.writeContract(request);
  const r = await pub.waitForTransactionReceipt({ hash });
  must(r.status === "success", `${req.functionName} mined`);
  return r;
};

// 1. Counterfactual address: CREATE2(factory, keccak(keccak(initializer), saltNonce), proxy creation code + singleton)
const owners = [account.address];
const initializer = encodeFunctionData({
  abi: safeAbi, functionName: "setup",
  args: [owners, 1n, zeroAddress, "0x", A.fallback, zeroAddress, 0n, zeroAddress],
});
const saltNonce = BigInt(Date.now());
const salt = keccak256(concat([keccak256(initializer), pad(`0x${saltNonce.toString(16)}`, { size: 32 })]));
const creation = await pub.readContract({ address: A.factory, abi: factoryAbi, functionName: "proxyCreationCode" });
const predicted = getContractAddress({
  opcode: "CREATE2", from: A.factory, salt,
  bytecode: concat([creation, pad(A.singleton, { size: 32 })]),
});
console.log("predicted Safe:", predicted);
must((await pub.getCode({ address: predicted })) === undefined, "Safe not deployed yet (counterfactual)");

// 2. Deploy (user pays gas; permissionless)
await send({ address: A.factory, abi: factoryAbi, functionName: "createProxyWithNonce", args: [A.singleton, initializer, saltNonce] });
must(!!(await pub.getCode({ address: predicted })), "Safe deployed at the predicted address");
const safe = getAddress(predicted);
must((await pub.readContract({ address: safe, abi: safeAbi, functionName: "getOwners" }))[0] === account.address, "owner = connected wallet");

// 3. Fund the Safe with USDC from the wallet
const AMOUNT = parseUnits("1000", 6);
const usdcBefore = await pub.readContract({ address: A.usdc, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
must(usdcBefore >= AMOUNT, `wallet has >= 1000 USDC (${usdcBefore})`);
await send({ address: A.usdc, abi: erc20Abi, functionName: "transfer", args: [safe, AMOUNT] });

// 4. Safe batch (MultiSend, delegatecall): exact-amount approve + supply
const packTx = (to, data) => encodePacked(["uint8", "address", "uint256", "uint256", "bytes"], [0, to, 0n, BigInt((data.length - 2) / 2), data]);
const batch = concat([
  packTx(A.usdc, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [A.aavePool, AMOUNT] })),
  packTx(A.aavePool, encodeFunctionData({ abi: poolAbi, functionName: "supply", args: [A.usdc, AMOUNT, safe, 0] })),
]);
const exec = async (to, data, operation) => {
  // Pre-validated signature (v=1): valid because the owner is msg.sender. No private key leaves this script.
  const sig = concat([pad(account.address, { size: 32 }), pad("0x00", { size: 32 }), "0x01"]);
  return send({
    address: safe, abi: safeAbi, functionName: "execTransaction",
    args: [to, 0n, data, operation, 0n, 0n, 0n, zeroAddress, zeroAddress, sig],
  });
};
await exec(A.multiSend, encodeFunctionData({ abi: multiSendAbi, functionName: "multiSend", args: [batch] }), 1);

const reserve = await pub.readContract({ address: A.aavePool, abi: poolAbi, functionName: "getReserveData", args: [A.usdc] });
const aToken = reserve[8];
const a0 = await pub.readContract({ address: aToken, abi: erc20Abi, functionName: "balanceOf", args: [safe] });
must(a0 >= AMOUNT - 1n && a0 <= AMOUNT + 1n, `Safe holds ${a0} aUSDC (principal supplied)`);
must((await pub.readContract({ address: A.usdc, abi: erc20Abi, functionName: "balanceOf", args: [safe] })) === 0n, "no USDC left in the Safe (exact amounts)");

// 5. Yield accrual: advance 30 days, mine, read
await pub.request({ method: "evm_increaseTime", params: [30 * 24 * 3600] });
await pub.request({ method: "evm_mine", params: [] });
const a1 = await pub.readContract({ address: aToken, abi: erc20Abi, functionName: "balanceOf", args: [safe] });
const yieldAccrued = a1 - AMOUNT;
must(yieldAccrued > 0n, `30 days of yield accrued: ${yieldAccrued} (6-dec units) on ${AMOUNT}`);

// 6. Spend yield only: withdraw exactly the yield, principal untouched
await exec(A.aavePool, encodeFunctionData({ abi: poolAbi, functionName: "withdraw", args: [A.usdc, yieldAccrued, account.address] }), 0);
const a2 = await pub.readContract({ address: aToken, abi: erc20Abi, functionName: "balanceOf", args: [safe] });
must(a2 >= AMOUNT && a2 - AMOUNT <= 2n, `principal intact after spending yield (${a2} vs ${AMOUNT})`);
console.log("\nALL CHECKS PASSED on the fork");
