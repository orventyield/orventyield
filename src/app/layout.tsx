import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Web3Provider } from "@/components/providers/Web3Provider";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "OrventYield: Spend the yield. Keep the principal.",
  description:
    "A non-custodial interface for Ether.fi Cash. Deposit collateral, watch yield tick live, and spend with a virtual card without selling your ETH.",
  openGraph: {
    title: "OrventYield: Spend the yield. Keep the principal.",
    description: "Live yield, a virtual card and real-world spending, without selling your crypto.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#07080C",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="bg-[#07080C] text-[#E6E8EE] min-h-screen antialiased selection:bg-[#00F0FF]/20 selection:text-[#00F0FF]">
        <Web3Provider>
          {children}
        </Web3Provider>
      </body>
    </html>
  );
}
