import type { Metadata } from "next";
import { Playfair_Display } from "next/font/google";
import "./globals.css";
import { WebSocketProvider } from "@/providers/WebSocketProvider";
import { AccountProvider } from "@/providers/AccountProvider";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { WalletProvider } from "@/providers/WalletProvider";
import { Navbar } from "@/components/layout/Navbar";
import { TestnetBanner } from "@/components/layout/TestnetBanner";
import { NetworkSwitchToast } from "@/components/layout/NetworkSwitchToast";
import { FeedbackButton } from "@/components/feedback/FeedbackButton";

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-playfair",
});

export const metadata: Metadata = {
  title: "Caster -- Prediction Market Exchange",
  description: "Trade prediction markets with a real orderbook",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={playfairDisplay.variable}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@100;300;400;500&family=Playfair+Display:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700&f[]=satoshi@400,500,600,700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen">
        <ThemeProvider>
          <WalletProvider>
            <AccountProvider>
              <WebSocketProvider>
                <TestnetBanner />
                <Navbar />
                <NetworkSwitchToast />
                <main>{children}</main>
                <FeedbackButton />
              </WebSocketProvider>
            </AccountProvider>
          </WalletProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
