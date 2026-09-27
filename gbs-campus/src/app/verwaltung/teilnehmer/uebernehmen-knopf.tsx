"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { Hinweis } from "@/components/ui/hinweis";
import { knopf } from "@/components/ui/knopf";
import { MeldungsBox, type Meldung } from "@/components/ui/meldung";

type Ergebnis = { uebernommen: number; ohneTeilnahmeform: number; zuletztAbgemeldet: number };

/**
 * Übernimmt aufgenommene Personen, die dem laufenden Semester noch nicht
 * zugeordnet sind. Das Ergebnis wird ausdrücklich gemeldet — auch die
 * Ausgelassenen, damit niemand glaubt, die Liste sei jetzt vollständig.
 * Zuletzt Abgemeldete („bin raus" oder keine Rückmeldung im Vorsemester) lässt
 * der Server bewusst aus; sie stehen darunter zum einzelnen Übernehmen.
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

    const { uebernommen, ohneTeilnahmeform, zuletztAbgemeldet } = antwort.daten;
    setMeldung({
      art: "ok",
      text:
        // „0 Personen wurden übernommen" liest sich wie ein Fehlschlag, ist aber
        // der Normalfall beim zweiten Klick — oder wenn jemand zeitgleich
        // dasselbe getan hat.
        (uebernommen === 0
          ? ohneTeilnahmeform === 0 && zuletztAbgemeldet === 0
            ? "Es war niemand (mehr) zu übernehmen — die Liste ist vollständig."
            : "Es war niemand (mehr) zu übernehmen."
          : `${uebernommen} ${uebernommen === 1 ? "Person wurde" : "Personen wurden"} übernommen.`) +
        (ohneTeilnahmeform > 0
          ? ` ${ohneTeilnahmeform} ${ohneTeilnahmeform === 1 ? "Person hat" : "Personen haben"} keine Teilnahmeform hinterlegt und ${
              ohneTeilnahmeform === 1 ? "wurde" : "wurden"
            } ausgelassen — bitte in der Akte nachtragen.`
          : "") +
        (zuletztAbgemeldet > 0
          ? ` ${zuletztAbgemeldet} zuletzt ${zuletztAbgemeldet === 1 ? "abgemeldete Person wurde" : "abgemeldete Personen wurden"} bewusst ausgelassen — Sie können sie unten einzeln übernehmen.`
          : ""),
    });
    router.refresh();
  }

  return (
    <div className="mb-5">
      <Hinweis
        icon="personen"
        titel={`${anzahl} ${anzahl === 1 ? "aufgenommene Person fehlt" : "aufgenommene Personen fehlen"} noch.`}
        aktion={
          <button type="button" onClick={uebernehmen} disabled={laeuft} className={knopf("sekundaer")}>
            {laeuft ? "Wird übernommen …" : "Ins Semester übernehmen"}
          </button>
        }
      >
        {anzahl === 1 ? "Sie ist" : "Sie sind"} diesem Semester noch nicht zugeordnet und {anzahl === 1 ? "steht" : "stehen"} deshalb
        nicht in der Liste.
      </Hinweis>
      <MeldungsBox meldung={meldung} className="mt-2" />
    </div>
  );
}
