import { Bento } from "@/components/landing/Bento";
import { Calculator } from "@/components/landing/Calculator";
import { Cta, Footer } from "@/components/landing/CtaFooter";
import { Faq } from "@/components/landing/Faq";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Marquee } from "@/components/landing/Marquee";
import { Nav } from "@/components/landing/Nav";
import { Problem } from "@/components/landing/Problem";
import { Trust } from "@/components/landing/Trust";
import { CursorGlow, MotionProvider, ScrollProgress } from "@/components/ui/motion";

export default function Home() {
  return (
    <MotionProvider>
      <ScrollProgress />
      <CursorGlow />
      <Nav />
      <main>
        <Hero />
        <Marquee />
        <Problem />
        <HowItWorks />
        <Calculator />
        <Bento />
        <Trust />
        <Faq />
        <Cta />
      </main>
      <Footer />
    </MotionProvider>
  );
}
