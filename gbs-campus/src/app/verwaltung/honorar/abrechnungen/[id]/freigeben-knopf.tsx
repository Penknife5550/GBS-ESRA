"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import type { DmsVersand } from "@/lib/honorar-korrektur";
import { knopf } from "@/components/ui/knopf";

type Antwort = { belegNr: string; dmsGesendet: boolean; dmsVersand: DmsVersand };

/**
 * Gibt die Abrechnung frei — dabei geht der Zahlungsbeleg mit IBAN an das DMS.
 * Bewusst mit Rückfrage, weil hier die Bankverbindung herausgegeben wird. Steht
 * als Hauptaktion oben rechts im Seitenkopf (Oberflächenplan 09/2026).
 *
 * `gesperrtGrund` (z. B. keine Bankverbindung hinterlegt) sperrt den Knopf und
 * steht sichtbar daneben — statt einer Rückfrage, deren Anfrage sicher scheitert.
 */
export function FreigebenKnopf({
  abrechnungId,
  gesperrtGrund = null,
}: {
  abrechnungId: string;
  gesperrtGrund?: string | null;
}) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function freigeben() {
    if (gesperrtGrund) return;
    if (!confirm("Abrechnung freigeben? Der Zahlungsbeleg inkl. IBAN wird an das DMS gesendet.")) return;
    setLaeuft(true);
    setFehler(null);

    const antwort = await sendeAnfrage<Antwort>(`/api/honorar/abrechnungen/${abrechnungId}/freigeben`, {
      methode: "POST",
    });

    if (!antwort.ok) {
      setLaeuft(false);
      setFehler(antwort.meldung);
      return;
    }
    // Der tatsächliche Ausgang (M12) geht als ?freigabe=… an die Seite: Dieser
    // Knopf steht nur bei OFFEN und hängt mit dem Statuswechsel aus — eine
    // eigene Meldung wäre nach dem Neuladen sofort wieder weg. Die Seite zeigt ihn
    // oben unter der Überschrift mit dmsVersandText an — dorthin springt
    // router.replace ohnehin (Seitenanfang), die Meldung steht also im Blick.
    router.replace(`/verwaltung/honorar/abrechnungen/${abrechnungId}?freigabe=${antwort.daten.dmsVersand}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {gesperrtGrund && (
        <p id="freigabe-gesperrt" className="text-xs text-muted-foreground">
          {gesperrtGrund}
        </p>
      )}
      <button
        type="button"
        onClick={freigeben}
        disabled={laeuft || Boolean(gesperrtGrund)}
        aria-describedby={gesperrtGrund ? "freigabe-gesperrt" : undefined}
        className={knopf("primaer")}
      >
        {laeuft ? "Gebe frei …" : "Freigeben …"}
      </button>
      {fehler && (
        <p role="alert" className="basis-full rounded-lg bg-credo-rot/10 px-3 py-2 text-sm text-foreground lg:max-w-sm">
          {fehler}
        </p>
      )}
    </div>
  );
}
