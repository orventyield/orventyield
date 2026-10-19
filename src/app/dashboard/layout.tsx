import type { Metadata } from "next";
import { Web3Provider } from "@/components/providers/Web3Provider";

export const metadata: Metadata = {
  title: "Dashboard · OrventYield",
  description: "Your vault, virtual card and spending in one place.",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <Web3Provider>{children}</Web3Provider>;
}
