import Image from "next/image";
import { SignOutButton } from "@/components/SignOutButton";
import styles from "./TopStrip.module.css";

// The brand + account header strip — same look as the dashboard's mobile top
// bar (receipt mark · GANPATI ENTERPRISES · "<name> · Sign out"), extracted so
// the salesman home wears it too (unification follow-up, owner request).
export function TopStrip({ accountLabel }: { accountLabel: string }) {
  return (
    <header className={styles.strip}>
      <div className={styles.brand}>
        <Image src="/icon.png" alt="" width={20} height={20} />
        <span className={styles.brandName}>GANPATI ENTERPRISES</span>
      </div>
      <div className={styles.account}>
        {accountLabel} · <SignOutButton />
      </div>
    </header>
  );
}
