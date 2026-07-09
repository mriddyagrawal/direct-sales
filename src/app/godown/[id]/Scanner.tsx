"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import styles from "./pick.module.css";

interface ScannerProps {
  onDecode: (raw: string) => void;
}

// Continuous camera decode via @zxing/browser (1D linear + QR — LG's serial
// barcode is linear/Code128-style, not a QR). Camera lifecycle is strictly
// scoped to this component: tracks start on mount and are stopped on unmount
// (controls.stop()), so navigating away never leaves a hot camera.
//
// Camera needs a secure context (HTTPS/localhost); on plain-http LAN
// getUserMedia is simply absent — surface that plainly and let the manual
// entry path carry the pick instead of dying.
export function Scanner({ onDecode }: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  // Keep the latest callback in a ref (updated in an effect, never during
  // render) so the camera effect itself runs exactly once.
  const onDecodeRef = useRef(onDecode);
  useEffect(() => {
    onDecodeRef.current = onDecode;
  });

  useEffect(() => {
    let controls: IScannerControls | undefined;
    let cancelled = false;

    async function start(): Promise<IScannerControls> {
      // Camera needs a secure context — on plain-http LAN mediaDevices is
      // simply absent. Throwing routes it into the same .catch as the other
      // startup failures (also keeps setState out of the sync effect body).
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        throw Object.assign(new Error("insecure context"), { name: "InsecureContextError" });
      }
      const reader = new BrowserMultiFormatReader();
      return reader.decodeFromConstraints(
        { video: { facingMode: "environment" } },
        videoRef.current!,
        (result) => {
          if (result) onDecodeRef.current(result.getText());
        },
      );
    }

    start()
      .then((c) => {
        // If the route unmounted while the camera was still warming up, stop
        // immediately — otherwise the tracks would leak past cleanup.
        if (cancelled) c.stop();
        else controls = c;
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const name = (err as { name?: string } | null)?.name;
        setError(
          name === "InsecureContextError"
            ? "Camera needs a secure (HTTPS) connection — type the serials by hand below."
            : name === "NotAllowedError"
              ? "Camera permission denied — allow it in your browser settings, or type the serials by hand below."
              : "Couldn't start the camera — type the serials by hand below.",
        );
      });

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, []);

  if (error) {
    return <p className={styles.cameraError}>{error}</p>;
  }

  return (
    <div className={styles.cameraWrap}>
      <video ref={videoRef} className={styles.camera} muted playsInline />
      <div className={styles.cameraGuide} aria-hidden />
    </div>
  );
}
