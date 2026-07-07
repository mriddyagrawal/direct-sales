import { DateRangeDemo } from "./DateRangeDemo";
import styles from "./DateRangeDemo.module.css";

// Throwaway demo route — visit /date-demo to try the range picker.
// Not linked from anywhere; delete this folder once evaluated.
export default function DateDemoPage() {
  return (
    <main className={styles.page}>
      <div>
        <h1 className={styles.pageTitle}>Date range picker — demo</h1>
        <p className={styles.pageNote}>
          react-day-picker in range mode + a preset rail, behind a DATE filter button — exactly how it&apos;ll
          sit in S8. Click DATE to open; pick a preset or drag a range on the calendar. Click outside or press
          Esc to dismiss.
        </p>
        <DateRangeDemo />
      </div>
    </main>
  );
}
