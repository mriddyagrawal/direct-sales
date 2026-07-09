import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { SwRegister } from "@/components/SwRegister";
import "./globals.css";

// Structure/labels/names typeface. next/font self-hosts + subsets + sets
// font-display: swap by default, so first paint never blocks on the
// webfont — the <2s-on-4G budget outranks typography (design spec
// deviation #2). System fallback stack covers the gap until it loads.
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  fallback: ["system-ui", "sans-serif"],
});

// Every figure — refs, SKUs, prices, quantities, times, countdowns —
// renders in this so numbers are tabular and column-aligned by construction.
const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  fallback: ["ui-monospace", "Menlo", "Consolas", "monospace"],
});

export const metadata: Metadata = {
  title: "Ganpati Enterprises — Order Capture",
  description: "Direct sales order capture for Ganpati Enterprises",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${jetBrainsMono.variable}`}>
      <body>
        <SwRegister />
        {children}
      </body>
    </html>
  );
}
