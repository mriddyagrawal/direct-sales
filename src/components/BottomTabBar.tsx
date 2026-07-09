"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReceiptText, Wallet } from "lucide-react";
import { Glyph } from "@/components/ui/Glyph";
import styles from "./BottomTabBar.module.css";

// Salesman bottom bar (orders-ui spec §6): Orders (/) · Deposits (/deposits).
// New Order left the bar — it's the floating FAB now (§2). Deposits is a live,
// tappable tab routing to a "Coming soon!" placeholder (owner decision #3);
// the real feature later replaces the page without touching this nav.
export function BottomTabBar() {
  const pathname = usePathname();

  return (
    <nav className={styles.bar}>
      <Link href="/" className={[styles.tab, pathname === "/" ? styles.active : ""].join(" ")}>
        <Glyph icon={ReceiptText} />
        Orders
      </Link>
      <Link
        href="/deposits"
        className={[styles.tab, pathname === "/deposits" ? styles.active : ""].join(" ")}
      >
        <Glyph icon={Wallet} />
        Deposits
      </Link>
    </nav>
  );
}
