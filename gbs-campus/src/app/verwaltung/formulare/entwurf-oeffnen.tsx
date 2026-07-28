"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";

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
    <div className="text-right">
      <button
        type="button"
        onClick={oeffnen}
        disabled={laeuft}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {laeuft ? "Wird geöffnet …" : "Formular bearbeiten"}
      </button>
      {fehler && <p className="mt-1 text-xs text-credo-rot">{fehler}</p>}
    </div>
  );
}
