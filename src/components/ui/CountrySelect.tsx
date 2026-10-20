"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface CountryOption {
  iso: string;
  name: string;
  flag: string;
  dial: string;
}

/** Frosted-glass, searchable country picker. Replaces the browser's native <select> menu, which cannot be themed. */
export function CountrySelect({
  value,
  options,
  onChange,
  testId,
  label,
  className = "",
}: {
  value: string;
  options: CountryOption[];
  onChange: (iso: string) => void;
  testId: string;
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean; maxH: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const uid = useId();
  const current = options.find((o) => o.iso === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    const digits = q.replace(/[^\d]/g, "");
    return options.filter((o) => o.name.toLowerCase().includes(q) || o.iso.toLowerCase() === q || (digits !== "" && o.dial.replace("+", "").startsWith(digits)));
  }, [options, query]);

  const place = useCallback(() => {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const margin = 12;
    const width = Math.min(Math.max(r.width, 300), window.innerWidth - margin * 2);
    const left = Math.min(Math.max(margin, r.left), window.innerWidth - width - margin);
    const below = window.innerHeight - r.bottom - margin;
    const above = r.top - margin;
    const up = below < 260 && above > below;
    setPos({ left, width, up, top: up ? r.top - 8 : r.bottom + 8, maxH: Math.max(160, Math.min(340, (up ? above : below) - 8)) });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => place();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!list.current?.parentElement?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, place]);

  // Focus the search box on open; start the highlight on the selected country.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(Math.max(0, options.findIndex((o) => o.iso === value)));
    requestAnimationFrame(() => search.current?.focus());
  }, [open, options, value]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, filtered, open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) requestAnimationFrame(() => button.current?.focus());
  };
  const choose = (iso: string) => {
    onChange(iso);
    close();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(filtered.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = filtered[active];
      if (o) choose(o.iso);
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${uid}-list`}
        aria-label={`${label}: ${current ? `${current.name} ${current.dial}` : "choose"}`}
        data-testid={testId}
        data-value={value}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={`flex h-12 w-[8.5rem] shrink-0 items-center justify-between gap-1.5 rounded-xl border bg-white/[0.05] px-3 text-sm text-fg outline-none transition hover:bg-white/[0.08] focus-visible:border-cyan ${open ? "border-cyan shadow-[0_0_0_3px_rgba(0,240,255,0.15)]" : "border-white/10"} ${className}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="text-lg leading-none">{current?.flag ?? "🌐"}</span>
          <span className="truncate font-mono">{current?.dial ?? "+"}</span>
        </span>
        <svg aria-hidden="true" viewBox="0 0 20 20" className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 8l5 5 5-5" />
        </svg>
      </button>

      {open && pos && typeof document !== "undefined" &&
        createPortal(
          <div
            data-dialog-portal
            data-dialog-popover-open
            data-testid={`${testId}-panel`}
            style={{ position: "fixed", left: pos.left, width: pos.width, top: pos.top, transform: pos.up ? "translateY(-100%)" : undefined, zIndex: 120 }}
            className="overflow-hidden rounded-2xl border border-white/[0.1] bg-[#0b0e14]/85 shadow-2xl shadow-black/70 backdrop-blur-xl"
          >
            <div className="border-b border-white/[0.07] p-2">
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 focus-within:border-cyan">
                <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="9" cy="9" r="5.5" /><path d="M13.5 13.5L17 17" /></svg>
                <input
                  ref={search}
                  data-testid={`${testId}-search`}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={onKey}
                  placeholder="Search country or code"
                  aria-label="Search country or calling code"
                  aria-controls={`${uid}-list`}
                  aria-activedescendant={filtered[active] ? `${uid}-${filtered[active]!.iso}` : undefined}
                  autoComplete="off"
                  spellCheck={false}
                  style={{ outline: "none" }} /* the wrapper shows the focus ring; the global :focus-visible rule would draw a second box */
                  className="h-10 w-full bg-transparent text-sm text-fg placeholder:text-muted/70"
                />
              </div>
            </div>
            <ul ref={list} id={`${uid}-list`} role="listbox" aria-label={label} style={{ maxHeight: pos.maxH - 58 }} className="overflow-y-auto overscroll-contain p-1.5 [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin]">
              {filtered.length === 0 && <li className="px-3 py-6 text-center text-xs text-muted">No country matches &ldquo;{query}&rdquo;</li>}
              {filtered.map((o, i) => {
                const selected = o.iso === value;
                const isActive = i === active;
                return (
                  <li
                    key={o.iso}
                    id={`${uid}-${o.iso}`}
                    role="option"
                    aria-selected={selected}
                    data-active={isActive}
                    data-testid={`country-option-${o.iso}`}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(o.iso)}
                    className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm transition-colors ${isActive ? "bg-white/[0.08]" : ""} ${selected ? "text-cyan" : "text-fg"}`}
                  >
                    <span aria-hidden="true" className="text-lg leading-none">{o.flag}</span>
                    <span className="min-w-0 flex-1 truncate">{o.name}</span>
                    <span className="font-mono text-xs text-muted">{o.dial}</span>
                    {selected && <span aria-hidden="true" className="text-cyan">✓</span>}
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}
