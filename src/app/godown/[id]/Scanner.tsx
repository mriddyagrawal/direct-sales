"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./pick.module.css";

interface ScannerProps {
  onDecode: (raw: string) => void;
}

// Torch + focusMode aren't in the DOM lib's MediaTrack* types yet — extend locally.
type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] };
type TorchConstraintSet = MediaTrackConstraintSet & { torch?: boolean; focusMode?: string };

// The native, OS-level BarcodeDetector isn't in the DOM lib types. Minimal shape.
interface DetectedBarcode {
  rawValue: string;
  format: string;
}
interface BarcodeDetectorInstance {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorInstance;
  getSupportedFormats(): Promise<string[]>;
}
// Structural type for the ZXing fallback reader (dynamic-imported), so we can
// hold it without a static import.
interface ZXingReaderLike {
  decodeFromCanvas(canvas: HTMLCanvasElement): { getText(): string };
}

// LG boxes carry 3 barcodes (serial CODE_128, an EAN-13, sometimes a QR) and a
// whole-frame decode kept locking onto the easy EAN/QR. This scanner owns the
// pipeline instead:
//   stream (native res, environment camera, continuous autofocus + torch when
//     available) → throttled decode loop → draws ONLY the on-screen reticle
//   region onto one reused offscreen canvas (downscaled to ≤1400px) → decode
//   restricted to CODE_128/39/93.
//
// Decoder: the phone's NATIVE `BarcodeDetector` (Android Chrome etc.) when it
// exposes our formats — far faster + more forgiving than JS, and it lets us
// skip loading ZXing entirely. Where it's absent (notably iOS Safari) we fall
// back to ZXing (`@zxing/browser`), dynamic-imported ONLY then.
//
// WYSIWYG: what's inside the reticle is what's decoded; EAN/QR are excluded by
// format at the decoder AND by PickScreen's extractSerial content-filter (so a
// bigger reticle stays safe). Lifecycle is strictly leak-free: interval,
// torch, and all tracks stop on unmount (including the getUserMedia warm-up race).
const RETICLE_W = 0.92; // fraction of the visible video, matches the CSS overlay
const RETICLE_H = 0.5; // taller box (owner call) — easier to land the barcode in
const DECODE_MS = 50; // ~20 decodes/sec; the native path self-paces via a busy guard
const MAX_DECODE_W = 1400; // downscale very high-res crops for cheap decodes
const NATIVE_FORMATS = ["code_128", "code_39", "code_93"];

export function Scanner({ onDecode }: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  // Latest callback in a ref (updated in an effect, never during render) so
  // the camera effect runs exactly once.
  const onDecodeRef = useRef(onDecode);
  useEffect(() => {
    onDecodeRef.current = onDecode;
  });

  useEffect(() => {
    let stream: MediaStream | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    // One offscreen canvas + one reader, reused across every tick.
    const canvas = document.createElement("canvas");

    async function start() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        throw Object.assign(new Error("insecure context"), { name: "InsecureContextError" });
      }

      // Prefer the phone's native BarcodeDetector; only if it can't do our
      // linear formats do we pull in ZXing. Linear alphanumeric symbologies
      // only either way — EAN-13 and QR are never attempted (the LG serial
      // reads as CODE_128; 39/93 cover old labels).
      let detector: BarcodeDetectorInstance | null = null;
      const BD = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
      if (BD) {
        try {
          const supported = await BD.getSupportedFormats();
          const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
          if (formats.length > 0) detector = new BD({ formats });
        } catch {
          detector = null;
        }
      }

      let reader: ZXingReaderLike | null = null;
      if (!detector) {
        const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([
          import("@zxing/browser"),
          import("@zxing/library"),
        ]);
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.CODE_93,
        ]);
        reader = new BrowserMultiFormatReader(hints);
      }

      // Native resolution on purpose (owner decision): better focus + detail
      // for the dense Code128. The decode stays cheap because we only ever
      // decode the reticle crop, throttled.
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
      });
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();

      // Torch ON by default where the hardware has one (Android). iOS Safari
      // and torchless devices skip silently — no error, no crash.
      const track = stream.getVideoTracks()[0];
      trackRef.current = track;
      const caps = track.getCapabilities?.() as TorchCapabilities | undefined;
      if (caps?.torch) {
        setTorchAvailable(true);
        try {
          await track.applyConstraints({ advanced: [{ torch: true } as TorchConstraintSet] });
          setTorchOn(true);
        } catch {
          // Constraint refused — stay torchless, keep scanning.
        }
      }

      // Continuous autofocus where the hardware supports it — cuts the
      // focus-lock lag once the barcode is at a readable angle/distance.
      // Capability-gated exactly like torch; unsupported devices skip
      // silently and keep their default (single-shot) focus — no crash.
      if (caps?.focusMode?.includes("continuous")) {
        try {
          await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as TorchConstraintSet] });
        } catch {
          // Refused — keep the device's default focus mode.
        }
      }

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;

      // Native detect() is async — skip a tick while one is still in flight so
      // detections can't stack up.
      let busy = false;

      interval = setInterval(() => {
        if (cancelled) return;
        if (detector && busy) return;
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) return;
        const rect = video.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        // The element uses object-fit: cover — first find which intrinsic
        // region is actually visible on screen, then take the reticle
        // (RETICLE_W × RETICLE_H, centered) of THAT. On-screen box and
        // decoded pixels stay 1:1 (WYSIWYG).
        const elAspect = rect.width / rect.height;
        const vAspect = vw / vh;
        let visW: number, visH: number, offX: number, offY: number;
        if (vAspect > elAspect) {
          visH = vh;
          visW = vh * elAspect;
          offX = (vw - visW) / 2;
          offY = 0;
        } else {
          visW = vw;
          visH = vw / elAspect;
          offX = 0;
          offY = (vh - visH) / 2;
        }
        const sw = visW * RETICLE_W;
        const sh = visH * RETICLE_H;
        const sx = offX + (visW - sw) / 2;
        const sy = offY + (visH - sh) / 2;

        const scale = sw > MAX_DECODE_W ? MAX_DECODE_W / sw : 1;
        const dw = Math.max(1, Math.round(sw * scale));
        const dh = Math.max(1, Math.round(sh * scale));
        if (canvas.width !== dw) canvas.width = dw;
        if (canvas.height !== dh) canvas.height = dh;
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);

        if (detector) {
          busy = true;
          detector
            .detect(canvas)
            .then((codes) => {
              if (!cancelled && codes.length > 0) onDecodeRef.current(codes[0].rawValue);
            })
            .catch(() => {
              // detect() can reject transiently (e.g. source not ready) — ignore.
            })
            .finally(() => {
              busy = false;
            });
        } else if (reader) {
          try {
            const result = reader.decodeFromCanvas(canvas);
            if (result) onDecodeRef.current(result.getText());
          } catch {
            // NotFoundException — nothing in frame this tick; keep looping.
          }
        }
      }, DECODE_MS);
    }

    start().catch((err: unknown) => {
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
      if (interval) clearInterval(interval);
      // Torch off before the track stops — some devices leave the LED lit.
      trackRef.current
        ?.applyConstraints({ advanced: [{ torch: false } as TorchConstraintSet] })
        .catch(() => {});
      stream?.getTracks().forEach((t) => t.stop());
      trackRef.current = null;
    };
  }, []);

  async function toggleTorch() {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as TorchConstraintSet] });
      setTorchOn(next);
    } catch {
      // Toggle refused — leave the state as-is.
    }
  }

  if (error) {
    return <p className={styles.cameraError}>{error}</p>;
  }

  return (
    <div className={styles.cameraWrap}>
      <video ref={videoRef} className={styles.camera} muted playsInline />
      {/* The reticle — landscape (barcodes are wide/short), same fractions the
          decode loop crops to, so what's inside is exactly what's decoded. */}
      <div className={styles.reticle} aria-hidden />
      {torchAvailable && (
        <button
          type="button"
          className={`${styles.torchToggle} ${torchOn ? styles.torchOnState : ""}`}
          onClick={toggleTorch}
          aria-label={torchOn ? "Turn torch off" : "Turn torch on"}
        >
          {torchOn ? "⚡ Torch on" : "⚡ Torch off"}
        </button>
      )}
    </div>
  );
}
