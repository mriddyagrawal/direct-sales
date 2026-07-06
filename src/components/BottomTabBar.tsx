"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./BottomTabBar.module.css";

// Two destinations only — Home / New Order (owner decision 2026-07-06, design
// spec §2 "Mobile bottom tab bar"). Sync/Profile tabs were cut; sign-out
// lives at the bottom of Home instead. The slot grammar keeps room for the
// future Payments tab (docs/future-plans.md) but only renders these two now.
export function BottomTabBar() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const isNewOrder = pathname === "/new-order";

  return (
    <nav className={styles.bar}>
      <Link href="/" className={[styles.tab, isHome ? styles.active : ""].join(" ")}>
        <span className={styles.icon} aria-hidden>
          ■
        </span>
        Home
      </Link>
      <Link href="/new-order" className={[styles.newOrder, isNewOrder ? styles.active : ""].join(" ")}>
        + New Order
      </Link>
    </nav>
  );
}
