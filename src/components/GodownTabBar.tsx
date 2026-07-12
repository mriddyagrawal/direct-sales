"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ScanBarcode, Home, Truck } from "lucide-react";
import { Glyph } from "@/components/ui/Glyph";
import styles from "./GodownTabBar.module.css";

// Godown bottom nav: Pickup (/godown) · Home (/godown/home) · Dispatch
// (/godown/dispatch). Shown on the three list pages; NOT on the scanner
// (/godown/[id]) or the reused order detail (/godown/orders/[id]). Active by
// exact pathname match. Home is the browse view (status chip-tabs: Pending
// scan / Ready to bill / Billed / Dispatched); Pickup stays the login default.
const TABS = [
  { href: "/godown", label: "Pickup", icon: ScanBarcode },
  { href: "/godown/home", label: "Home", icon: Home },
  { href: "/godown/dispatch", label: "Dispatch", icon: Truck },
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
