"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "@/components/SignOutButton";
import styles from "./DashboardNav.module.css";

interface DashboardNavProps {
  accountLabel: string;
}

const TABS = [
  { href: "/dashboard", label: "Orders", match: (p: string) => p === "/dashboard" || p.startsWith("/dashboard/orders") },
  { href: "/dashboard/retailers", label: "Retailers", match: (p: string) => p.startsWith("/dashboard/retailers") },
  { href: "/dashboard/products", label: "Products", match: (p: string) => p.startsWith("/dashboard/products") },
];

// M5 nav shell — 3 tabs only (Orders/Retailers/Products), left rail on
// desktop, a bottom tab bar + top account strip on phone (owner deviation:
// a responsive layout is required, not just >=1280px desktop).
export function DashboardNav({ accountLabel }: DashboardNavProps) {
  const pathname = usePathname();

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
            {tab.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
