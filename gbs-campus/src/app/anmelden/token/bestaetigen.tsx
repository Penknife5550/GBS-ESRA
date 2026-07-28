"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";

export function AnmeldungBestaetigen({ token }: { token: string }) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function bestaetigen() {
    setLaeuft(true);
    setFehler(null);

    const antwort = await sendeAnfrage("/api/auth/token", { methode: "POST", rumpf: { token } });

    if (!antwort.ok) {
      setLaeuft(false);
      setFehler(antwort.meldung);
      return;
    }
    router.push("/verwaltung");
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={bestaetigen}
        disabled={laeuft}
        className="mt-8 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {laeuft ? "Wird angemeldet …" : "Jetzt anmelden"}
      </button>

      {fehler && (
        <p role="alert" className="mt-6 rounded-lg border border-credo-rot/40 bg-credo-rot/5 px-4 py-3 text-sm">
          {fehler}{" "}
          <a href="/anmelden" className="underline underline-offset-2">
            Neuen Link anfordern
          </a>
        </p>
      )}
    </>
  );
}
