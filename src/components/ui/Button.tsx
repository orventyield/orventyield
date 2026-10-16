import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "./Icons";

type Props = {
  href: string;
  children: ReactNode;
  variant?: "primary" | "ghost";
  className?: string;
  arrow?: boolean;
};

export function ButtonLink({ href, children, variant = "primary", className = "", arrow }: Props) {
  const base =
    "group relative inline-flex min-h-12 items-center justify-center gap-2 overflow-hidden rounded-full px-6 text-[15px] font-semibold transition-[transform,box-shadow,background] duration-300 active:scale-[0.97]";
  const styles =
    variant === "primary"
      ? "bg-cyan text-bg shadow-[0_0_0_1px_rgba(0,240,255,0.6),0_10px_40px_-8px_rgba(0,240,255,0.65)] hover:shadow-[0_0_0_1px_rgba(0,240,255,0.9),0_14px_60px_-6px_rgba(0,240,255,0.9)]"
      : "glass text-fg hover:bg-white/10";
  return (
    <Link href={href} className={`${base} ${styles} ${className}`}>
      {variant === "primary" && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 -left-1/2 w-1/3 animate-sheen bg-white/50 blur-md"
        />
      )}
      <span className="relative">{children}</span>
      {arrow && <ArrowRight className="relative transition-transform duration-300 group-hover:translate-x-1" />}
    </Link>
  );
}
