import { useCallback, useEffect, useRef, useState } from "react";

export function useRafRenderVersion(): readonly [number, () => void] {
  const [renderVersion, setRenderVersion] = useState(0);
  const rafIdRef = useRef<number | null>(null);

  const bumpRenderVersion = useCallback(() => {
    if (rafIdRef.current !== null) return;
    if (typeof requestAnimationFrame !== "function") {
      setRenderVersion((n) => n + 1);
      return;
    }
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      setRenderVersion((n) => n + 1);
    });
  }, []);

  useEffect(
    () => () => {
      if (
        rafIdRef.current !== null &&
        typeof cancelAnimationFrame === "function"
      ) {
        cancelAnimationFrame(rafIdRef.current);
      }
      rafIdRef.current = null;
    },
    [],
  );

  return [renderVersion, bumpRenderVersion];
}
