"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

export interface SegTab<T extends string> {
  id: T;
  label: ReactNode;
  icon: string;
  testId?: string;
}

/**
 * Floating pill segmented bar with a sliding, glowing active state. Buttons keep the "button" role so the whole dashboard
 * stays keyboard- and test-friendly. Scrolls sideways on phones instead of wrapping.
 */
export function SegmentedTabs<T extends string>({ tabs, value, onChange, layoutId }: { tabs: SegTab<T>[]; value: T; onChange: (id: T) => void; layoutId: string }) {
  return (
    <div role="group" aria-label="Dashboard sections" className="no-scrollbar -mx-4 overflow-x-auto px-4 py-2 sm:mx-0 sm:px-0">
      <div className="pill-bar mx-auto flex w-max items-center gap-1 rounded-full p-1.5 font-mono text-xs">
        {tabs.map((t) => {
          const active = t.id === value;
          return (
            <button
              key={t.id}
              type="button"
              data-testid={t.testId}
              aria-pressed={active}
              onClick={() => onChange(t.id)}
              className={`relative flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full px-4 font-semibold transition-colors sm:px-5 ${active ? "text-bg" : "text-muted hover:text-fg"}`}
            >
              {active && (
                <motion.span
                  layoutId={layoutId}
                  transition={{ type: "spring", stiffness: 480, damping: 36 }}
                  className="absolute inset-0 -z-0 rounded-full bg-gradient-to-r from-cyan via-[#5ef0e0] to-emerald shadow-[0_0_30px_rgba(0,240,255,0.5)]"
                />
              )}
              <span aria-hidden="true" className="relative">{t.icon}</span>
              <span className="relative">{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
