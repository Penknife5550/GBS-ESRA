"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { MeldungsBox, type Meldung } from "@/components/ui/meldung";

type Ergebnis = { uebernommen: number; ohneTeilnahmeform: number };

/**
 * Übernimmt aufgenommene Personen, die dem laufenden Semester noch nicht
 * zugeordnet sind. Das Ergebnis wird ausdrücklich gemeldet — auch die
 * Ausgelassenen, damit niemand glaubt, die Liste sei jetzt vollständig.
 */
export function UebernehmenKnopf({ semesterId, anzahl }: { semesterId: string; anzahl: number }) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<Meldung | null>(null);

  async function uebernehmen() {
    setLaeuft(true);
    setMeldung(null);

    const antwort = await sendeAnfrage<Ergebnis>(`/api/semester/${semesterId}/teilnehmer`, { methode: "POST" });
    setLaeuft(false);

    if (!antwort.ok) {
      setMeldung({ art: "fehler", text: antwort.meldung });
      return;
    }

    const { uebernommen, ohneTeilnahmeform } = antwort.daten;
    setMeldung({
      art: "ok",
      text:
        // „0 Personen wurden übernommen" liest sich wie ein Fehlschlag, ist aber
        // der Normalfall beim zweiten Klick — oder wenn jemand zeitgleich
        // dasselbe getan hat.
        (uebernommen === 0
          ? "Es war niemand (mehr) zu übernehmen — die Liste ist vollständig."
          : `${uebernommen} ${uebernommen === 1 ? "Person wurde" : "Personen wurden"} übernommen.`) +
        (ohneTeilnahmeform > 0
          ? ` ${ohneTeilnahmeform} ${ohneTeilnahmeform === 1 ? "Person hat" : "Personen haben"} keine Teilnahmeform hinterlegt und ${
              ohneTeilnahmeform === 1 ? "wurde" : "wurden"
            } ausgelassen — bitte in der Akte nachtragen.`
          : ""),
    });
    router.refresh();
  }

  return (
    <div className="mt-6 rounded-lg border border-border bg-credo-gelb/15 px-4 py-4 text-sm">
      <p>
        {anzahl} {anzahl === 1 ? "aufgenommene Person ist" : "aufgenommene Personen sind"} diesem Semester
        noch nicht zugeordnet und {anzahl === 1 ? "fehlt" : "fehlen"} deshalb in der Liste.
      </p>

      <button
        type="button"
        onClick={uebernehmen}
        disabled={laeuft}
        className="mt-3 min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {laeuft ? "Wird übernommen …" : "Ins laufende Semester übernehmen"}
      </button>

      <MeldungsBox meldung={meldung} className="mt-3" />
    </div>
  );
}
