"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tag, ReceiptText, Wallet } from "lucide-react";
import { Glyph } from "@/components/ui/Glyph";
import styles from "./BottomTabBar.module.css";

// Salesman bottom bar: Products (/products) · Orders (/) · Deposits (/deposits)
// — Orders in the CENTER (owner 2026-07-23). New Order left the bar (it's the
// floating FAB, orders-ui §2). Default landing is unchanged — the app still
// opens on / (Orders); only the tab order changed. Products is the read-only
// pricelist/stocklist reference.
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
        href="/deposits"
        className={[styles.tab, pathname === "/deposits" ? styles.active : ""].join(" ")}
      >
        <Glyph icon={Wallet} />
        Deposits
      </Link>
    </nav>
  );
}
