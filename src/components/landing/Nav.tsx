"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Close, Logo, Menu } from "../ui/Icons";
import { ButtonLink } from "../ui/Button";

export const NAV_LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/calculator", label: "Calculator" },
  { href: "/features", label: "Features" },
  { href: "/security", label: "Security" },
  { href: "/faq", label: "FAQ" },
];

export function Nav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-4 pt-3 sm:px-6">
      <motion.nav
        initial={{ y: -40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className={`mx-auto flex max-w-7xl items-center justify-between rounded-full px-4 py-2.5 transition-all duration-500 sm:px-5 ${
          scrolled ? "glass shadow-[0_10px_50px_-10px_rgba(0,0,0,0.8)]" : "border border-transparent"
        }`}
        aria-label="Main"
      >
        <Link href="/" className="flex items-center gap-2" aria-label="OrventYield home">
          <Logo className="h-9 w-9" />
          <span className="text-[17px] font-bold tracking-tight">
            Orvent<span className="text-cyan">Yield</span>
          </span>
        </Link>

        <ul className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={pathname === l.href ? "page" : undefined}
                className={`rounded-full px-3.5 py-2 text-sm transition-colors hover:bg-white/5 hover:text-fg ${
                  pathname === l.href ? "bg-white/10 text-cyan" : "text-muted"
                }`}
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <div className="hidden sm:block">
            <ButtonLink href="/dashboard" className="!min-h-10 !px-5 !text-sm">
              Launch App
            </ButtonLink>
          </div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="grid h-11 w-11 place-items-center rounded-full glass text-xl md:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
          >
            {open ? <Close /> : <Menu />}
          </button>
        </div>
      </motion.nav>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="glass mx-auto mt-2 max-w-7xl rounded-3xl p-3 md:hidden"
          >
            <ul className="flex flex-col">
              {NAV_LINKS.map((l, i) => (
                <motion.li
                  key={l.href}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.05 * i }}
                >
                  <Link
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className={`flex min-h-12 items-center rounded-2xl px-4 text-lg font-medium hover:bg-white/5 ${
                      pathname === l.href ? "text-cyan" : ""
                    }`}
                  >
                    {l.label}
                  </Link>
                </motion.li>
              ))}
            </ul>
            <ButtonLink href="/dashboard" className="mt-2 w-full" arrow>
              Launch App
            </ButtonLink>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
