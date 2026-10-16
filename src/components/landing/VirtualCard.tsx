"use client";

import { motion, useMotionTemplate, useMotionValue, useSpring, useTransform } from "motion/react";
import { useRef } from "react";
import { Contactless, Logo } from "../ui/Icons";

export function VirtualCard({
  frozen = false,
  interactive = true,
  className = "",
}: {
  frozen?: boolean;
  interactive?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const sx = useSpring(mx, { stiffness: 140, damping: 16 });
  const sy = useSpring(my, { stiffness: 140, damping: 16 });
  const rotateY = useTransform(sx, [0, 1], [-18, 18]);
  const rotateX = useTransform(sy, [0, 1], [16, -16]);
  const gx = useTransform(sx, [0, 1], ["0%", "100%"]);
  const gy = useTransform(sy, [0, 1], ["0%", "100%"]);
  const glare = useMotionTemplate`radial-gradient(420px circle at ${gx} ${gy}, rgba(255,255,255,0.22), rgba(0,240,255,0.12) 30%, transparent 55%)`;

  const onMove = (e: React.PointerEvent) => {
    if (!interactive || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    mx.set((e.clientX - r.left) / r.width);
    my.set((e.clientY - r.top) / r.height);
  };
  const reset = () => {
    mx.set(0.5);
    my.set(0.5);
  };

  return (
    <div
      className={`[perspective:1100px] ${className}`}
      onPointerMove={onMove}
      onPointerLeave={reset}
      style={{ touchAction: "pan-y" }}
    >
      <motion.div
        ref={ref}
        style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
        className="relative aspect-[1.586/1] w-full select-none [container-type:inline-size] rounded-[26px] border border-white/15 bg-[#0a0c12] shadow-[0_40px_120px_-20px_rgba(0,240,255,0.35),0_0_0_1px_rgba(0,240,255,0.12)_inset]"
      >
        {/* base art */}
        <div className="absolute inset-0 overflow-hidden rounded-[26px]">
          <div className="absolute -right-24 -top-28 h-80 w-80 rounded-full bg-cyan/25 blur-3xl" />
          <div className="absolute -bottom-32 -left-16 h-72 w-72 rounded-full bg-emerald/20 blur-3xl" />
          <svg className="absolute inset-0 h-full w-full opacity-[0.22]" viewBox="0 0 400 252" fill="none">
            {[40, 80, 120, 160, 200].map((r) => (
              <circle key={r} cx="330" cy="40" r={r} stroke="#00F0FF" strokeWidth="0.6" />
            ))}
          </svg>
          {/* holographic conic sheen */}
          <div className="absolute inset-0 opacity-40 mix-blend-screen [background:conic-gradient(from_210deg_at_70%_20%,transparent_0deg,rgba(0,240,255,0.35)_70deg,rgba(16,185,129,0.3)_140deg,transparent_220deg,rgba(120,100,255,0.25)_300deg,transparent_360deg)]" />
          <motion.div className="absolute inset-0 mix-blend-overlay" style={{ background: glare }} />
          <div className="absolute inset-y-0 -left-1/2 w-1/3 animate-sheen bg-white/10 blur-xl" />
        </div>

        {/* content, lifted in Z for parallax depth */}
        <div className="relative flex h-full flex-col justify-between p-[6%]" style={{ transform: "translateZ(40px)" }}>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <Logo className="h-7 w-7" />
              <span className="text-[15px] font-bold tracking-[0.22em] text-white">ORVENT</span>
            </div>
            <Contactless className="h-7 w-7 text-white/70" />
          </div>

          <div className="flex items-center gap-3">
            <div className="h-9 w-12 rounded-md border border-white/20 bg-[linear-gradient(135deg,#c9fbff,#2dd4bf_45%,#0e7490)] shadow-inner">
              <div className="mx-auto mt-[9px] h-px w-8 bg-black/25" />
              <div className="mx-auto mt-[6px] h-px w-8 bg-black/25" />
            </div>
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/50">Yield card · Demo</span>
          </div>

          <div>
            <p className="font-mono text-[clamp(11px,5.4cqw,22px)] tracking-[0.12em] text-white/90 whitespace-nowrap">
              •••• •••• •••• 0000
            </p>
            <div className="mt-2 flex items-end justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-white/55">
              <span>Spend the yield</span>
              <span>Principal locked</span>
            </div>
          </div>
        </div>

        {/* frozen overlay */}
        <motion.div
          initial={false}
          animate={{ opacity: frozen ? 1 : 0 }}
          transition={{ duration: 0.4 }}
          className="pointer-events-none absolute inset-0 grid place-items-center rounded-[26px] bg-[#0a1a22]/75 backdrop-blur-[3px]"
        >
          <span className="rounded-full border border-cyan/50 bg-cyan/10 px-4 py-1.5 font-mono text-xs tracking-[0.3em] text-cyan">
            FROZEN
          </span>
        </motion.div>
      </motion.div>
    </div>
  );
}
