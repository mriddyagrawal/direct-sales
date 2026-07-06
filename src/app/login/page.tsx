import Image from "next/image";
import { LoginForm } from "./LoginForm";
import styles from "./login.module.css";

interface LoginPageProps {
  searchParams: Promise<{ reason?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const deactivated = params.reason === "deactivated";

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <Image src="/icon.png" alt="" width={40} height={40} className={styles.mark} />
        <h1 className={styles.name}>Ganpati Enterprises</h1>
        <p className={styles.tagline}>ORDER CAPTURE · FIELD SALES</p>
        <LoginForm deactivated={deactivated} />
        <p className={styles.footer}>Forgot password? Call the office to reset it.</p>
      </div>
    </main>
  );
}
