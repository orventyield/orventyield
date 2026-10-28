"use client";

import Link from "next/link";
import { Magnetic, SplitWords } from "../ui/motion";
import { Logo, XIcon } from "../ui/Icons";
import { NAV_LINKS } from "./Nav";

export function Cta() {
  return (
    <section id="cta" className="relative isolate overflow-hidden px-5 py-28 sm:px-6 sm:py-40">
      <div aria-hidden="true" className="absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-1/2 h-[70vmin] w-[70vmin] -translate-x-1/2 -translate-y-1/2 animate-drift-a rounded-full bg-cyan/25 blur-[120px]" />
        <div className="absolute left-[60%] top-[55%] h-[50vmin] w-[50vmin] -translate-x-1/2 -translate-y-1/2 animate-drift-b rounded-full bg-emerald/25 blur-[110px]" />
      </div>
      <div className="mx-auto max-w-4xl text-center">
        <h2 className="text-[clamp(2.6rem,10vw,6.5rem)] font-extrabold leading-[0.95] tracking-[-0.05em]">
          <SplitWords text="Your crypto," wordClassName="text-gradient" />
          <br />
          <SplitWords text="finally working." wordClassName="text-shimmer" delay={0.2} />
        </h2>
        <p className="mx-auto mt-6 max-w-md text-muted">
          Spend the yield. Keep the principal. Connect your wallet and start now.
        </p>
        <Magnetic className="mt-10 inline-block">
          <Link
            href="/dashboard"
            className="relative inline-flex items-center justify-center min-h-14 overflow-hidden rounded-full bg-cyan px-9 text-base font-bold text-bg shadow-[0_0_0_1px_rgba(0,240,255,0.7),0_18px_70px_-8px_rgba(0,240,255,0.85)] transition hover:brightness-110 active:scale-[0.97]"
          >
            <span className="absolute inset-y-0 -left-1/2 w-1/3 animate-sheen bg-white/60 blur-md" aria-hidden="true" />
            <span className="relative">Launch App →</span>
          </Link>
        </Magnetic>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-line px-5 py-12 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 md:flex-row md:justify-between">
        <div className="max-w-sm">
          <div className="flex items-center gap-2">
            <Logo className="h-7 w-7" />
            <span className="text-lg font-bold">
              Orvent<span className="text-cyan">Yield</span>
            </span>
          </div>
          <p className="mt-3 text-sm text-muted">Spend the yield. Keep the principal.</p>
          <div className="mt-4">
            <a
              href="https://x.com/orventyield?s=20"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-cyan/40 hover:bg-cyan/10 hover:text-cyan"
              aria-label="OrventYield on X"
            >
              <XIcon className="h-3.5 w-3.5 text-fg" />
              <span>Follow @orventyield</span>
            </a>
          </div>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-8 gap-y-3 text-sm text-muted">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="transition-colors hover:text-cyan">
              {l.label}
            </Link>
          ))}
          <a
            href="https://x.com/orventyield?s=20"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-muted transition-colors hover:text-cyan"
            aria-label="OrventYield on X"
          >
            <XIcon className="h-3.5 w-3.5" />
            <span>X (Twitter)</span>
          </a>
        </nav>
      </div>
      <p className="mx-auto mt-10 max-w-6xl border-t border-line pt-6 text-xs leading-relaxed text-muted/80">
        OrventYield is an independent, non-custodial interface and is not affiliated with or endorsed by Safe, Aave or Immersve. Figures
        shown are examples. Crypto involves risk, including loss of funds. Nothing here is financial,
        legal or tax advice.
      </p>
    </footer>
  );
}
