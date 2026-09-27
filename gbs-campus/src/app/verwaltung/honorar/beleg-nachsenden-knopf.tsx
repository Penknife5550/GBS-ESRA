"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";

type Antwort = { belegNr: string; dmsGesendet: boolean };

/**
 * Sendet einen DMS-Beleg, der nicht angekommen ist, mit derselben Beleg-Nr
 * erneut (M12) — für Abrechnungen (Zahlungsbeleg) und Honorarsätze. Steht neben
 * „Versand steht aus“. Mit Rückfrage, weil der Beleg das Haus verlässt (beim
 * Zahlungsbeleg samt IBAN). Nach Erfolg lädt die Seite neu und zeigt „gesendet“.
 */
export function BelegNachsendenKnopf({ pfad, rueckfrage }: { pfad: string; rueckfrage: string }) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function nachsenden() {
    if (!confirm(rueckfrage)) return;
    setLaeuft(true);
    setFehler(null);

    const antwort = await sendeAnfrage<Antwort>(pfad, { methode: "POST" });
    setLaeuft(false);

    if (!antwort.ok) {
      setFehler(antwort.meldung);
      return;
    }
    router.refresh();
  }

  return (
    <span className="mt-1 block">
      <button
        type="button"
        onClick={nachsenden}
        disabled={laeuft}
        className="min-h-10 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:border-primary disabled:opacity-60"
      >
        {laeuft ? "Sende …" : "Beleg erneut senden"}
      </button>
      {fehler && (
        <span role="alert" className="mt-1 block text-xs text-credo-rot">
          {fehler}
        </span>
      )}
    </span>
  );
}
