"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { knopf } from "@/components/ui/knopf";

/**
 * Öffnet den bearbeitbaren Entwurf. Gibt es keinen, entsteht serverseitig eine
 * Kopie der zuletzt veröffentlichten Fassung — der Schulleiter muss sich also
 * nicht merken, ob er gerade eine neue Version anlegen darf.
 */
export function EntwurfOeffnen({ formularCode }: { formularCode: string }) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function oeffnen() {
    setLaeuft(true);
    setFehler(null);

    const antwort = await sendeAnfrage<{ versionId: string }>("/api/formulare/entwurf", {
      methode: "POST",
      rumpf: { formularCode },
    });

    if (!antwort.ok) {
      setFehler(antwort.meldung);
      setLaeuft(false);
      return;
    }
    router.push(`/verwaltung/formulare/${antwort.daten.versionId}`);
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <button type="button" onClick={oeffnen} disabled={laeuft} className={knopf("primaer")}>
        {laeuft ? "Wird geöffnet …" : "Formular bearbeiten"}
      </button>
      {fehler && <p className="max-w-xs text-xs text-credo-rot sm:text-right">{fehler}</p>}
    </div>
  );
}
