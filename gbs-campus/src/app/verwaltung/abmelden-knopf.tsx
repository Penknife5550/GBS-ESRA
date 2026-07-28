"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { sendeAnfrage } from "@/lib/api-client";

/**
 * Abmelden. Fehlte vorher vollständig — in einer Schule mit geteiltem iPad und
 * Verwaltungsrechner blieb die Sitzung offen, bis sie von selbst ablief.
 */
export function AbmeldenKnopf() {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);

  return (
    <button
      type="button"
      disabled={laeuft}
      onClick={async () => {
        setLaeuft(true);
        await sendeAnfrage("/api/auth/abmelden", { methode: "POST" });
        router.push("/anmelden");
        router.refresh();
      }}
      className="rounded-lg border border-input px-4 py-2 text-sm font-medium disabled:opacity-60"
    >
      {laeuft ? "Wird abgemeldet …" : "Abmelden"}
    </button>
  );
}
