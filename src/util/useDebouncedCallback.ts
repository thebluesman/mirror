import { useEffect, useMemo, useRef } from "react";

// Extracted from ShellPanel.tsx (Phase 3) so ImportPanel's tint control
// (improvements-v2.2 §5) can reuse the same "debounce a live-dragged
// control's commit" behavior instead of duplicating it — a `<input
// type="color">` drag fires onChange continuously, same as the calibration
// sliders this was written for, and both drive the same kind of expensive
// commit (a scene mutation + structural rebuild).

/** Debounces a callback by `delayMs`, always calling with the most recent
 *  args. Flushes any pending call on unmount so a drag-then-navigate-away
 *  doesn't drop the final value. */
export function useDebouncedCallback<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delayMs: number,
): (...args: Args) => void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingArgsRef = useRef<Args | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        if (pendingArgsRef.current) fnRef.current(...pendingArgsRef.current);
      }
    },
    [],
  );

  return useMemo(() => {
    const debounced = (...args: Args) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      pendingArgsRef.current = args;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        pendingArgsRef.current = null;
        fnRef.current(...args);
      }, delayMs);
    };
    return debounced;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fn is read via fnRef so it can change every render without re-debouncing
  }, [delayMs]);
}
