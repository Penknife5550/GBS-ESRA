"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";

type Antwort = { belegNr: string; dmsGesendet: boolean };

/**
 * Gibt die Abrechnung frei — dabei geht der Zahlungsbeleg mit IBAN an das DMS.
 * Bewusst mit Rückfrage, weil hier die Bankverbindung herausgegeben wird.
 */
export function FreigebenKnopf({ abrechnungId }: { abrechnungId: string }) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<{ art: "ok" | "fehler"; text: string } | null>(null);

  async function freigeben() {
    if (!confirm("Abrechnung freigeben? Der Zahlungsbeleg inkl. IBAN wird an das DMS gesendet.")) return;
    setLaeuft(true);
    setMeldung(null);

    const antwort = await sendeAnfrage<Antwort>(`/api/honorar/abrechnungen/${abrechnungId}/freigeben`, {
      methode: "POST",
    });
    setLaeuft(false);

    if (!antwort.ok) {
      setMeldung({ art: "fehler", text: antwort.meldung });
      return;
    }
    const dms = antwort.daten.dmsGesendet
      ? `Beleg ${antwort.daten.belegNr} an das DMS gesendet.`
      : `Beleg ${antwort.daten.belegNr} erzeugt — DMS-Versand steht aus (E-Mail noch nicht eingerichtet).`;
    setMeldung({ art: "ok", text: `Freigegeben. ${dms}` });
    router.refresh();
  }

  return (
    <div>
      <button
        type="button"
        onClick={freigeben}
        disabled={laeuft}
        className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {laeuft ? "Gebe frei …" : "Freigeben (Beleg mit IBAN ans DMS)"}
      </button>
      {meldung && (
        <p
          role={meldung.art === "ok" ? "status" : "alert"}
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            meldung.art === "ok" ? "bg-credo-gruen/10 text-foreground" : "bg-credo-rot/10 text-foreground"
          }`}
        >
          {meldung.text}
        </p>
      )}
    </div>
  );
}
