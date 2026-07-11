"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ScanBarcode, Truck, History } from "lucide-react";
import { Glyph } from "@/components/ui/Glyph";
import styles from "./GodownTabBar.module.css";

// Godown bottom nav (Stage 2, orders-ui): Pickup (/godown) · Dispatch
// (/godown/dispatch) · History (/godown/history). Shown on the three list
// pages; NOT on the scanner (/godown/[id]) or the reused order detail
// (/godown/orders/[id]). Active by exact pathname match.
const TABS = [
  { href: "/godown", label: "Pickup", icon: ScanBarcode },
  { href: "/godown/dispatch", label: "Dispatch", icon: Truck },
  { href: "/godown/history", label: "History", icon: History },
] as const;

export function GodownTabBar() {
  const pathname = usePathname();
  return (
    <nav className={styles.bar}>
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={[styles.tab, pathname === t.href ? styles.active : ""].join(" ")}
        >
          <Glyph icon={t.icon} />
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
