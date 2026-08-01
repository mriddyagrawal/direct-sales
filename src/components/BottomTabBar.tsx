"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tag, ReceiptText, Store, Wallet } from "lucide-react";
import { Glyph } from "@/components/ui/Glyph";
import styles from "./BottomTabBar.module.css";

// Salesman bottom bar: Products (/products) · Orders (/) · Retailers
// (/retailers) · Deposits (/deposits).
//
// Retailers joined in position 3 (owner 2026-08-01), which moves Orders off
// centre — accepted explicitly, because with FOUR tabs there is no centre, and
// 2nd keeps Orders nearest where the thumb already is. Nothing in the
// stylesheet assumed three: `.tab` is `flex: 1`, so a fourth just divides the
// width. Icon is `Store`, the same one the office nav uses for Retailers.
//
// New Order left the bar (it's the floating FAB, orders-ui §2). Default landing
// is unchanged — the app still opens on / (Orders). Products and Retailers are
// both read-only references he can pull up mid-conversation.
export function BottomTabBar() {
  const pathname = usePathname();

  return (
    <nav className={styles.bar}>
      <Link
        href="/products"
        className={[styles.tab, pathname === "/products" ? styles.active : ""].join(" ")}
      >
        <Glyph icon={Tag} />
        Products
      </Link>
      <Link href="/" className={[styles.tab, pathname === "/" ? styles.active : ""].join(" ")}>
        <Glyph icon={ReceiptText} />
        Orders
      </Link>
      <Link
        href="/retailers"
        className={[styles.tab, pathname === "/retailers" ? styles.active : ""].join(" ")}
      >
        <Glyph icon={Store} />
        Retailers
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
