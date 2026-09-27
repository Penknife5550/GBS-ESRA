"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { knopf } from "@/components/ui/knopf";

type Antwort = { belegNr: string; dmsGesendet: boolean };

/**
 * Sendet einen DMS-Beleg, der nicht angekommen ist, mit derselben Beleg-Nr
 * erneut (M12) — für Abrechnungen (Zahlungsbeleg) und Honorarsätze. Steht neben
 * „Versand steht aus“. Mit Rückfrage, weil der Beleg das Haus verlässt (beim
 * Zahlungsbeleg samt IBAN). Nach Erfolg lädt die Seite neu und zeigt „gesendet“.
 * Selten gebraucht, deshalb als kleiner heller Knopf (Oberflächenplan 09/2026).
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
    <span className="mt-2 flex flex-col items-start gap-1">
      <button type="button" onClick={nachsenden} disabled={laeuft} className={knopf("sekundaer", "klein")}>
        {laeuft ? "Sende …" : "Beleg erneut senden"}
      </button>
      {fehler && (
        <span role="alert" className="text-xs text-credo-rot">
          {fehler}
        </span>
      )}
    </span>
  );
}
