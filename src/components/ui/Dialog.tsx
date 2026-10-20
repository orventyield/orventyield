"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Accessible modal: overlay click and Escape close it, Tab is trapped inside, and focus returns to the opener.
 * Bottom sheet on phones, centred card on larger screens.
 */
export function Dialog({
  open,
  onClose,
  labelledBy,
  testId,
  children,
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  testId?: string;
  children: ReactNode;
  dismissible?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const close = useCallback(() => dismissible && onClose(), [dismissible, onClose]);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => {
      const target = panel.current?.querySelector<HTMLElement>("[data-autofocus]") ?? panel.current?.querySelector<HTMLElement>("button, input, select");
      target?.focus();
    });
    return () => {
      cancelAnimationFrame(raf);
      opener.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // A popover rendered outside the panel (e.g. a dropdown) handles its own Escape and Tab.
      if (document.querySelector("[data-dialog-popover-open]")) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
      if (e.key !== "Tab" || !panel.current) return;
      const f = panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled])');
      if (!f.length) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      if (!panel.current.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  // Portaled to <body>: a parent with backdrop-filter (every glass card) would otherwise become the containing block of
  // `fixed` and squeeze the sheet into the card.
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          data-testid={testId}
          role="presentation"
          className="fixed inset-0 z-[90] grid items-end bg-black/70 backdrop-blur-sm sm:place-items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && close()}
        >
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-white/10 glass-card p-5 shadow-[0_-20px_80px_-20px_rgba(0,240,255,0.25)] sm:max-w-md sm:rounded-3xl sm:p-6"
            initial={{ y: 60, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
