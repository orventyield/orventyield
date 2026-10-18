export const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" }
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable"
  }
] as const;

export const safeFactoryAbi = [
  {
    type: "function",
    name: "createSafe",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "safe", type: "address" }],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "getSafe",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "safe", type: "address" }],
    stateMutability: "view"
  }
] as const;

export const debtManagerAbi = [
  {
    type: "function",
    name: "getDebt",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "debtAmount", type: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "repay",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [{ name: "remainingDebt", type: "uint256" }],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "maxLtv",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view"
  }
] as const;
