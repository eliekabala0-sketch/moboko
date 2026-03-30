"use client";

import { useEffect } from "react";

/** Après navigation depuis /sermons avec #p-N, assure le défilement sous le masthead. */
export function ScrollToSermonHash() {
  useEffect(() => {
    const raw = window.location.hash?.replace(/^#/, "");
    if (!raw || !raw.startsWith("p-")) return;
    const el = document.getElementById(raw);
    if (!el) return;
    const t = window.setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(t);
  }, []);

  return null;
}
