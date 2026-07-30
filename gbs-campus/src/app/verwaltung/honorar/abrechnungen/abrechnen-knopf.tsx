"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";

type Antwort = { abrechnungId: string; abende: number; summe: number };

/**
 * Erstellt eine Abrechnung für einen Dozenten im Semester (friert die offenen
 * Abende ein) und springt danach in die Detailansicht. Bewusst mit Rückfrage,
 * weil die Abrechnung die Beträge festschreibt.
 */
export function AbrechnenKnopf({ dozentId, semesterId }: { dozentId: string; semesterId: string }) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function abrechnen() {
    if (!confirm("Alle offenen Abende dieses Dozenten zu einer Abrechnung zusammenfassen und die Beträge festschreiben?")) {
      return;
    }
    setLaeuft(true);
    setFehler(null);

    const antwort = await sendeAnfrage<Antwort>("/api/honorar/abrechnungen", {
      methode: "POST",
      rumpf: { dozentId, semesterId },
    });

    if (!antwort.ok) {
      setLaeuft(false);
      setFehler(antwort.meldung);
      return;
    }
    router.push(`/verwaltung/honorar/abrechnungen/${antwort.daten.abrechnungId}`);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={abrechnen}
        disabled={laeuft}
        className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {laeuft ? "Rechne ab …" : "Abrechnen"}
      </button>
      {fehler && (
        <span role="alert" className="max-w-[16rem] text-right text-xs text-credo-rot">
          {fehler}
        </span>
      )}
    </div>
  );
}
