"use client";

import { useId, useState, type InputHTMLAttributes } from "react";
import styles from "./Field.module.css";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

// White, 1px hairline, 2px radius; focus = 1px accent, sharp; error = 1px
// red + plain-words helper below (design spec §2 "Fields"). Password fields
// get an eye toggle (owner swap from the mono SHOW/HIDE text): eye = tap to
// reveal, struck-through eye = tap to hide.
function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {off ? (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      ) : (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

export function Field({ label, error, id, type, className, ...rest }: FieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const [visible, setVisible] = useState(false);
  const isPassword = type === "password";

  return (
    <div className={[styles.wrapper, className].filter(Boolean).join(" ")}>
      <label htmlFor={fieldId} className={styles.label}>
        {label}
      </label>
      <div className={styles.inputRow}>
        <input
          id={fieldId}
          type={isPassword && visible ? "text" : type}
          className={[styles.input, error ? styles.inputError : ""].filter(Boolean).join(" ")}
          aria-invalid={!!error}
          aria-describedby={error ? `${fieldId}-error` : undefined}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            className={styles.showToggle}
            onClick={() => setVisible((v) => !v)}
            tabIndex={-1}
            aria-label={visible ? "Hide password" : "Show password"}
          >
            <EyeIcon off={visible} />
          </button>
        )}
      </div>
      {error && (
        <p id={`${fieldId}-error`} className={styles.errorText}>
          {error}
        </p>
      )}
    </div>
  );
}
