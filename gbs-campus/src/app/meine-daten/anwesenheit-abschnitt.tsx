"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { ANWESENHEIT_OPTIONEN, type QuoteModellA } from "@/lib/stundenplan";
import { istSelbstStatusErlaubt } from "@/lib/selbstbestaetigung";
import { QuoteAmpel } from "@/components/ui/quote-ampel";
import { AnwesenheitBadge } from "@/components/ui/badges";
import { MeldungsBox, type Meldung } from "@/components/ui/meldung";

type Termin = {
  id: string;
  text: string;
  kurstitel: string | null;
  status: string | null;
  darfBestaetigen: boolean;
};
type Gruppe = { semesterBezeichnung: string; teilnahmeId: string; quote: QuoteModellA; termine: Termin[] };

// Bewusst Knöpfe statt eines <select>: Ein Klick ist eine eindeutige, gewollte
// Aktion. Ein Auswahlfeld dagegen speichert bei Tastaturbedienung schon beim
// Durchtippen jeden übersprungenen Wert (WCAG 3.2.2) — hier soll nur gespeichert
// werden, was der Teilnehmer wirklich anklickt.
// Nur, was ein Teilnehmer selbst bestätigen darf (SELBST_STATUS).
const OPTIONEN = ANWESENHEIT_OPTIONEN.filter((o) => istSelbstStatusErlaubt(o.wert));

export function AnwesenheitAbschnitt({
  gruppen,
  darfBearbeiten,
}: {
  gruppen: Gruppe[];
  /** Nur mit PERSON_BEARBEITEN_EIGENE erscheinen die Selbstbestätigungs-Knöpfe;
   * die Quote sieht auch ein reines Lese-Konto (PERSON_LESEN_EIGENE). */
  darfBearbeiten: boolean;
}) {
  const router = useRouter();
  // Lokaler Stand je Abend, damit die Auswahl nach dem Speichern stehen bleibt,
  // ohne auf ein Neuladen zu warten.
  const [status, setStatus] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(gruppen.flatMap((g) => g.termine.map((t) => [t.id, t.status]))),
  );
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<Meldung | null>(null);

  async function bestaetigen(terminId: string, neu: string) {
    if (status[terminId] === neu || laeuft) return; // schon so gesetzt oder gerade am Speichern
    const vorher = status[terminId] ?? null;
    setLaeuft(terminId);
    setMeldung(null);
    setStatus((s) => ({ ...s, [terminId]: neu })); // optimistisch
    const antwort = await sendeAnfrage<{ status: string }>("/api/meine-daten/anwesenheit", {
      methode: "POST",
      rumpf: { terminId, status: neu },
    });
    setLaeuft(null);
    if (!antwort.ok) {
      setStatus((s) => ({ ...s, [terminId]: vorher })); // Rücknahme
      setMeldung({ art: "fehler", text: antwort.meldung });
      return;
    }
    setMeldung({ art: "ok", text: "Danke, deine Bestätigung ist gespeichert." });
    router.refresh();
  }

  return (
    <div>
      <p className="max-w-prose text-sm text-muted-foreground">
        {darfBearbeiten
          ? "Bestätige hier selbst, an welchen vergangenen Abenden du da warst oder den Stoff nachgearbeitet hast. Beides zählt als Teilnahme. Was die Schule schon erfasst hat, steht fest und ist hier nur zum Nachlesen."
          : "Hier siehst du deinen Anwesenheitsstand je Semester. Erfasst und geändert wird er von der Schule."}
      </p>

      <MeldungsBox meldung={meldung} className="mt-4" />

      {gruppen.map((gruppe) => (
        <div key={gruppe.teilnahmeId} className="mt-6">
          <h3 className="text-sm font-semibold">{gruppe.semesterBezeichnung}</h3>

          <div className="mt-2">
            <QuoteAmpel quote={gruppe.quote} sicht="schueler" />
          </div>

          <ul className="mt-3 space-y-2">
            {gruppe.termine.map((termin) => {
              const zeigeKnoepfe = darfBearbeiten && termin.darfBestaetigen;
              return (
                <li
                  key={termin.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-medium">{termin.text}</span>
                    {termin.kurstitel && <span className="ml-2 text-sm text-muted-foreground">· {termin.kurstitel}</span>}
                  </div>

                  {zeigeKnoepfe ? (
                    <div
                      role="group"
                      aria-label={`Meine Anwesenheit am ${termin.text}`}
                      className="flex flex-wrap gap-1.5"
                    >
                      {OPTIONEN.map((o) => {
                        const aktiv = status[termin.id] === o.wert;
                        return (
                          <button
                            key={o.wert}
                            type="button"
                            onClick={() => bestaetigen(termin.id, o.wert)}
                            disabled={laeuft === termin.id}
                            aria-pressed={aktiv}
                            className={`min-h-10 rounded-lg px-3 py-1.5 text-sm disabled:opacity-60 ${
                              aktiv
                                ? "bg-primary font-medium text-primary-foreground"
                                : "border border-border hover:border-primary"
                            }`}
                          >
                            {o.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : darfBearbeiten && termin.status ? (
                    <AnwesenheitBadge status={termin.status} vorsatz="von der Schule erfasst: " />
                  ) : (
                    <AnwesenheitBadge status={termin.status} />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
