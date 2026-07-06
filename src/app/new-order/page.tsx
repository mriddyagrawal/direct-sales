import Link from "next/link";
import { BottomTabBar } from "@/components/BottomTabBar";
import styles from "./new-order.module.css";

// Placeholder — the actual Quick Order / Pick Retailer / Review flow (S3-S6)
// is M4, not this milestone. This just proves the tab bar routes here.
export default function NewOrderPlaceholder() {
  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <p className={styles.text}>Order taking is coming soon.</p>
        <Link href="/" className={styles.link}>
          Back to Home
        </Link>
      </div>
      <BottomTabBar />
    </div>
  );
}
