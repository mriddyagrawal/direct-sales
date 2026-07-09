"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReceiptText, Store, Package, Users } from "lucide-react";
import { SignOutButton } from "@/components/SignOutButton";
import { Glyph } from "@/components/ui/Glyph";
import styles from "./DashboardNav.module.css";

interface DashboardNavProps {
  accountLabel: string;
  isAdmin?: boolean;
}

const BASE_TABS = [
  {
    href: "/dashboard",
    label: "Orders",
    icon: ReceiptText,
    match: (p: string) => p === "/dashboard" || p.startsWith("/dashboard/orders"),
  },
  { href: "/dashboard/retailers", label: "Retailers", icon: Store, match: (p: string) => p.startsWith("/dashboard/retailers") },
  { href: "/dashboard/products", label: "Products", icon: Package, match: (p: string) => p.startsWith("/dashboard/products") },
];

// Users is admin-only — an accountant never sees the tab (and the page + every
// action gate it independently, so hiding the tab is convenience, not the
// security boundary).
const ADMIN_TABS = [
  { href: "/dashboard/users", label: "Users", icon: Users, match: (p: string) => p.startsWith("/dashboard/users") },
];

// M5 nav shell — Orders/Retailers/Products (+ admin-only Users), left rail on
// desktop, a bottom tab bar + top account strip on phone (owner deviation:
// a responsive layout is required, not just >=1280px desktop).
export function DashboardNav({ accountLabel, isAdmin = false }: DashboardNavProps) {
  const pathname = usePathname();
  const TABS = isAdmin ? [...BASE_TABS, ...ADMIN_TABS] : BASE_TABS;

  return (
    <>
      <nav className={styles.rail}>
        <div className={styles.brand}>
          <Image src="/icon.png" alt="" width={24} height={24} />
          <span className={styles.brandName}>GANPATI ENTERPRISES</span>
        </div>
        <div className={styles.railLinks}>
          {TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={`${styles.railLink} ${tab.match(pathname) ? styles.active : ""}`}
            >
              <Glyph icon={tab.icon} />
              {tab.label}
            </Link>
          ))}
        </div>
        <div className={styles.railAccount}>
          <span>{accountLabel}</span>
          <SignOutButton />
        </div>
      </nav>

      <div className={styles.mobileTop}>
        <div className={styles.brand}>
          <Image src="/icon.png" alt="" width={20} height={20} />
          <span className={styles.brandName}>GANPATI ENTERPRISES</span>
        </div>
        <div className={styles.account}>
          {accountLabel} · <SignOutButton />
        </div>
      </div>

      <nav className={styles.mobileBottom}>
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`${styles.mobileTab} ${tab.match(pathname) ? styles.active : ""}`}
          >
            <Glyph icon={tab.icon} />
            {tab.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
