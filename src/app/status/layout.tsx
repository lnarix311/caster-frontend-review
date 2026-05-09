import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Status · Caster",
  description: "Real-time monitoring dashboard for Caster chain and services.",
  robots: { index: false, follow: false },
};

export default function StatusLayout({ children }: { children: React.ReactNode }) {
  return children;
}
