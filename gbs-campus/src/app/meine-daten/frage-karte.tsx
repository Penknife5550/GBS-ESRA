"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { SELBST_STATUS, type SelbstStatus } from "@/lib/selbstbestaetigung";
import { knopf } from "@/components/ui/knopf";
import { MeldungsBox, type Meldung } from "@/components/ui/meldung";
import { KARTE } from "./handy-seite";

export type Frage = {
  terminId: string;
  /** „Waren Sie am Dienstag da?“ */
  frage: string;
  /** „22.09. · 19:00 · Bibelkunde · Genesis 12–50“ */
  zeile: string;
};

// Die beiden Antworten sind genau die Selbstbestätigungen (SELBST_STATUS):
// „entschuldigt“ entscheidet die Schule, „gefehlt“ meldet niemand über sich selbst.
const ANTWORT: Record<SelbstStatus, { text: string; art: "primaer" | "sekundaer" }> = {
  ANWESEND: { text: "Ja, ich war da", art: "primaer" },
  NACHGEARBEITET: { text: "Nachgearbeitet", art: "sekundaer" },
};

/**
 * Die eine Frage oben auf der Übersicht (Oberflächenplan 09/2026): der jüngste
 * gehaltene Abend ohne Eintrag, mit einem Tippen bestätigt. Dieselbe Route und
 * dieselben Regeln wie die Liste unter „Abende“ (`/api/meine-daten/anwesenheit`).
 * Die Karte verschwindet sofort und kommt bei einem Fehler zurück.
 */
export function FrageKarte({ frage }: { frage: Frage | null }) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  // Optimistisch ausgeblendet, bis die Seite den neuen Stand geladen hat.
  const [beantwortet, setBeantwortet] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<Meldung | null>(null);

  async function antworten(terminId: string, status: SelbstStatus) {
    if (laeuft) return;
    setLaeuft(true);
    setMeldung(null);
    setBeantwortet(terminId);
    const antwort = await sendeAnfrage<{ status: string }>("/api/meine-daten/anwesenheit", {
      methode: "POST",
      rumpf: { terminId, status },
    });
    setLaeuft(false);
    if (!antwort.ok) {
      setBeantwortet(null); // Rücknahme
      setMeldung({ art: "fehler", text: antwort.meldung });
      // Hat die Schule inzwischen erfasst, zeigt der frische Stand es.
      if (antwort.status === 409) router.refresh();
      return;
    }
    setMeldung({ art: "ok", text: "Danke, Ihre Bestätigung ist gespeichert." });
    router.refresh();
  }

  return (
    <>
      <MeldungsBox meldung={meldung} className="lg:col-span-2" />
      {frage && frage.terminId !== beantwortet && (
        <section aria-labelledby="frage-titel" className={`${KARTE} lg:col-span-2`}>
          <h2 id="frage-titel" className="text-[17px] font-semibold leading-snug tracking-tight text-foreground">
            {frage.frage}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{frage.zeile}</p>
          <div className="mt-3.5 grid grid-cols-2 gap-2.5 lg:max-w-md">
            {SELBST_STATUS.map((status) => (
              <button
                key={status}
                type="button"
                disabled={laeuft}
                onClick={() => antworten(frage.terminId, status)}
                className={knopf(ANTWORT[status].art, "gross")}
              >
                {ANTWORT[status].text}
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
