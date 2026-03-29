"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  return (
    <button
      type="button"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        try {
          const supabase = createSupabaseBrowserClient();
          await supabase.auth.signOut();
          router.refresh();
          router.push("/");
        } finally {
          setLoading(false);
        }
      }}
      className="rounded-full border border-[var(--border)] bg-transparent px-3.5 py-1.5 text-sm font-medium text-[var(--muted)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface)] hover:text-[var(--foreground)] disabled:opacity-50"
    >
      {loading ? "…" : "Déconnexion"}
    </button>
  );
}
