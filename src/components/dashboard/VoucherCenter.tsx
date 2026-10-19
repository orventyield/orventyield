"use client";

import { useState } from "react";
import type { VoucherBrandId } from "@/utils/card";

interface VoucherCenterProps {
  accruedYieldUsd: number;
  availableLimit: number;
  onRedeemVoucher: (
    brand: VoucherBrandId,
    label: string,
    amountUsd: number,
    fundWith: "yield" | "credit"
  ) => { success: boolean; voucherCode?: string; error?: string };
}

interface VoucherProduct {
  id: VoucherBrandId;
  brand: string;
  category: string;
  denominations: number[];
  icon: string;
  badge?: string;
}

const CATALOG: VoucherProduct[] = [
  {
    id: "amazon",
    brand: "Amazon Gift Card",
    category: "Shopping",
    denominations: [10, 25, 50, 100],
    icon: "📦",
    badge: "Most Popular",
  },
  {
    id: "uber",
    brand: "Uber & UberEats",
    category: "Ride & Food",
    denominations: [15, 25, 50],
    icon: "🚗",
  },
  {
    id: "swiggy",
    brand: "Swiggy / Zomato",
    category: "Food Delivery",
    denominations: [10, 20, 35],
    icon: "🍔",
    badge: "Instant Delivery",
  },
  {
    id: "apple",
    brand: "Apple App Store",
    category: "Digital Services",
    denominations: [15, 25, 50],
    icon: "🍏",
  },
  {
    id: "steam",
    brand: "Steam Wallet",
    category: "Gaming",
    denominations: [20, 50],
    icon: "🎮",
  },
];

export function VoucherCenter({
  accruedYieldUsd,
  availableLimit,
  onRedeemVoucher,
}: VoucherCenterProps) {
  const [selectedProduct, setSelectedProduct] = useState<VoucherProduct>(CATALOG[0]!);
  const [selectedAmount, setSelectedAmount] = useState<number>(CATALOG[0]!.denominations[1] ?? 25);
  const [useYieldPayment, setUseYieldPayment] = useState<boolean>(true);
  const [redeemedCode, setRedeemedCode] = useState<string | null>(null);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSelectProduct = (prod: VoucherProduct) => {
    setSelectedProduct(prod);
    setSelectedAmount(prod.denominations[0] ?? 25);
    setRedeemedCode(null);
    setRedeemError(null);
  };

  const handleRedeem = () => {
    setRedeemError(null);
    const result = onRedeemVoucher(selectedProduct.id, selectedProduct.brand, selectedAmount, useYieldPayment ? "yield" : "credit");
    if (!result.success) {
      setRedeemError(result.error || "Redemption failed");
      setRedeemedCode(null);
    } else {
      setRedeemedCode(result.voucherCode || null);
    }
  };

  const copyToClipboard = () => {
    if (!redeemedCode) return;
    void navigator.clipboard?.writeText(redeemedCode).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-surface border border-white/5 rounded-2xl p-5 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-fg flex items-center gap-2">
            Digital Voucher Store
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald/10 border border-emerald/20 text-emerald font-mono">
              Bitrefill-style · demo
            </span>
          </h3>
          <p className="text-xs text-muted mt-0.5">
            Buy digital gift cards with accrued yield or your credit line.
          </p>
        </div>

        {/* Live Balance Pills */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 bg-surface-2 border border-white/5 rounded-xl px-3 py-1.5 text-xs font-mono">
            <span className="text-muted">Available Yield:</span>
            <span className="text-emerald font-bold">${accruedYieldUsd.toFixed(2)}</span>
          </div>
          <div className="hidden sm:flex items-center gap-2 bg-surface-2 border border-white/5 rounded-xl px-3 py-1.5 text-xs font-mono">
            <span className="text-muted">Credit Line:</span>
            <span className="text-cyan font-bold">${availableLimit.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Catalog Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {CATALOG.map((prod) => {
          const isSelected = selectedProduct.id === prod.id;
          return (
            <button
              key={prod.id}
              onClick={() => handleSelectProduct(prod)}
              className={`p-3 rounded-xl border text-left flex flex-col justify-between transition-all ${
                isSelected
                  ? "bg-cyan/10 border-cyan/40 text-fg shadow-sm shadow-cyan/20"
                  : "bg-surface-2 border-white/5 text-muted hover:text-fg hover:border-white/10"
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-2xl">{prod.icon}</span>
                  {prod.badge && (
                    <span className="text-[9px] bg-cyan/15 text-cyan border border-cyan/30 px-1.5 py-0.5 rounded font-mono">
                      {prod.badge}
                    </span>
                  )}
                </div>
                <div className="text-xs font-bold line-clamp-1">{prod.brand}</div>
                <div className="text-[10px] text-muted/70">{prod.category}</div>
              </div>
              <div className="text-[11px] font-mono text-cyan mt-3">
                From ${prod.denominations[0]}
              </div>
            </button>
          );
        })}
      </div>

      {/* Configuration & Purchase Section */}
      <div className="bg-[#090b10] border border-white/10 rounded-2xl p-5 grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
        {/* Denomination Selector */}
        <div className="md:col-span-6 space-y-3">
          <label className="text-xs font-mono text-muted uppercase tracking-wider block">
            Choose Amount for {selectedProduct.brand}
          </label>
          <div className="flex flex-wrap gap-2">
            {selectedProduct.denominations.map((denom) => (
              <button
                key={denom}
                type="button"
                onClick={() => setSelectedAmount(denom)}
                className={`px-4 py-2 rounded-xl text-xs font-mono font-bold transition-all ${
                  selectedAmount === denom
                    ? "bg-cyan text-bg shadow-sm shadow-cyan/40"
                    : "bg-surface-2 border border-white/10 text-muted hover:text-fg"
                }`}
              >
                ${denom} USD
              </button>
            ))}
          </div>

          {/* Payment Method Switch */}
          <div className="pt-2">
            <span className="text-[11px] font-mono text-muted block mb-1.5">Funding Source:</span>
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="fund-yield"
                aria-pressed={useYieldPayment}
                onClick={() => setUseYieldPayment(true)}
                className={`flex-1 p-2.5 rounded-xl border text-xs font-medium text-left transition-all ${
                  useYieldPayment
                    ? "bg-emerald/15 border-emerald/40 text-emerald"
                    : "bg-surface-2 border-white/5 text-muted hover:text-fg"
                }`}
              >
                <div className="font-bold flex items-center gap-1">
                  <span>⚡ Fund with Accrued Yield</span>
                </div>
                <div className="text-[10px] opacity-80 mt-0.5">
                  $0 debt · collateral untouched
                </div>
              </button>

              <button
                type="button"
                data-testid="fund-credit"
                aria-pressed={!useYieldPayment}
                onClick={() => setUseYieldPayment(false)}
                className={`flex-1 p-2.5 rounded-xl border text-xs font-medium text-left transition-all ${
                  !useYieldPayment
                    ? "bg-cyan/15 border-cyan/40 text-cyan"
                    : "bg-surface-2 border-white/5 text-muted hover:text-fg"
                }`}
              >
                <div className="font-bold">🏦 Fund with Credit Line</div>
                <div className="text-[10px] opacity-80 mt-0.5">
                  Borrows against collateral (HF ≥ 1.20x)
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* Purchase Action & Output */}
        <div className="md:col-span-6 flex flex-col justify-center space-y-3 bg-surface-2/80 border border-white/5 rounded-xl p-4">
          <div className="flex justify-between text-xs font-mono">
            <span className="text-muted">Item:</span>
            <span className="text-fg font-semibold">{selectedProduct.brand}</span>
          </div>
          <div className="flex justify-between text-xs font-mono">
            <span className="text-muted">Total Due:</span>
            <span className="text-fg font-bold text-base">${selectedAmount}.00 USD</span>
          </div>

          {redeemError && (
            <div role="alert" data-testid="voucher-error" className="bg-danger/10 border border-danger/30 text-danger text-xs font-mono p-2.5 rounded-lg">
              {redeemError}
            </div>
          )}

          <button
            type="button"
            data-testid="voucher-redeem"
            onClick={handleRedeem}
            className="w-full py-3 rounded-xl bg-cyan text-bg font-bold text-xs uppercase tracking-wider hover:brightness-110 shadow-lg shadow-cyan/25 transition-all"
          >
            Buy voucher (${selectedAmount})
          </button>

          {/* Generated Code Reveal */}
          {redeemedCode && (
            <div className="mt-2 bg-black border border-emerald/40 rounded-xl p-3.5 space-y-2 animate-in fade-in">
              <div className="flex items-center justify-between text-xs font-mono text-emerald font-bold">
                <span>DEMO VOUCHER CODE</span>
                <span>PLAYGROUND</span>
              </div>
              <div className="flex items-center justify-between bg-surface-2 px-3 py-2 rounded-lg font-mono text-sm font-bold text-cyan">
                <span data-testid="voucher-code">{redeemedCode}</span>
                <button
                  type="button"
                  onClick={copyToClipboard}
                  className="text-xs bg-white/10 hover:bg-white/20 text-fg px-2.5 py-1 rounded transition-colors"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <div className="text-[10px] font-mono text-muted text-center">
                Demo code for {selectedProduct.brand}. Not redeemable.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
