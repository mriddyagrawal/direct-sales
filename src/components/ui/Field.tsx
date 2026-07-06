"use client";

import { useId, useState, type InputHTMLAttributes } from "react";
import styles from "./Field.module.css";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

// White, 1px hairline, 2px radius; focus = 1px accent, sharp; error = 1px
// red + plain-words helper below (design spec §2 "Fields"). Password
// fields get the mono SHOW/HIDE toggle the S1 login screen specs.
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
          >
            {visible ? "HIDE" : "SHOW"}
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
