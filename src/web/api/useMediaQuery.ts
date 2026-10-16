import { useEffect, useState } from "react";

function matches(query: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false;
}

/**
 * Whether a CSS media query matches now, updated on change. Without matchMedia it answers false, so a
 * component that switches structure on a narrow query renders its wide layout by default.
 */
export function useMediaQuery(query: string): boolean {
  const [current, setCurrent] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const onChange = () => setCurrent(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return current;
}
