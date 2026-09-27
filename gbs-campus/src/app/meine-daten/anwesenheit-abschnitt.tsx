"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { ANWESENHEIT, ANWESENHEIT_OPTIONEN, anwesenheitName, zaehltAlsTeilgenommen, type QuoteModellA } from "@/lib/stundenplan";
import { istSelbstStatusErlaubt } from "@/lib/selbstbestaetigung";
import { QuoteAmpel } from "@/components/ui/quote-ampel";
import { Abschnitt, Gruppe } from "@/components/ui/liste";
import { MeldungsBox, type Meldung } from "@/components/ui/meldung";
import { StatusPunkt, type StatusTon } from "@/components/ui/status-punkt";

export type AbendEinheit = {
  id: string;
  /** „19:00“ */
  zeit: string;
  fach: string | null;
  /** Kurzes Thema, z. B. „Genesis 12–50“. */
  thema: string | null;
  istVergangen: boolean;
  status: string | null;
  /** Ist er false, hat die Schule den Abend erfasst — für den Teilnehmer nur zum Nachlesen. */
  darfBestaetigen: boolean;
};
export type AbendTag = {
  schluessel: string;
  /** „Dienstag, 22. September“ */
  titel: string;
  einheiten: AbendEinheit[];
};
export type AnwesenheitGruppe = {
  semesterBezeichnung: string;
  teilnahmeId: string;
  /** Die eigene Quote (Modell A); null, solange im Semester noch kein Abend gehalten ist. */
  quote: QuoteModellA | null;
  tage: AbendTag[];
};

// Bewusst Knöpfe statt eines <select>: Ein Klick ist eine eindeutige, gewollte
// Aktion. Ein Auswahlfeld dagegen speichert bei Tastaturbedienung schon beim
// Durchtippen jeden übersprungenen Wert (WCAG 3.2.2) — hier soll nur gespeichert
// werden, was der Teilnehmer wirklich anklickt.
// Nur, was ein Teilnehmer selbst bestätigen darf (SELBST_STATUS).
const OPTIONEN = ANWESENHEIT_OPTIONEN.filter((o) => istSelbstStatusErlaubt(o.wert));

/** Farbe des Punkts: teilgenommen grün, entschuldigt gelb, gefehlt rot, offen grau. */
function anwesenheitPunkt(status: string | null): StatusTon {
  if (!status) return "grau";
  if (zaehltAlsTeilgenommen(status)) return "gruen";
  return status === ANWESENHEIT.ENTSCHULDIGT ? "gelb" : "rot";
}

function grossAnfang(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Alle Abende des Teilnehmers mit Stand und Selbstbestätigung (Seite „Abende“).
 * Über jedem Semester die Quote (Modell A) als Ampel, darunter je Dienstag die
 * Einheiten: gehaltene mit Status, offene mit „Anwesend · Nachgearbeitet“,
 * kommende als „geplant“.
 */
export function AnwesenheitAbschnitt({
  gruppen,
  darfBearbeiten,
}: {
  gruppen: AnwesenheitGruppe[];
  /** Nur mit PERSON_BEARBEITEN_EIGENE erscheinen die Selbstbestätigungs-Knöpfe;
   * die Quote sieht auch ein reines Lese-Konto (PERSON_LESEN_EIGENE). */
  darfBearbeiten: boolean;
}) {
  const router = useRouter();
  // Lokaler Stand je Abend, damit die Auswahl nach dem Speichern stehen bleibt,
  // ohne auf ein Neuladen zu warten.
  const [status, setStatus] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(gruppen.flatMap((g) => g.tage.flatMap((t) => t.einheiten.map((e) => [e.id, e.status])))),
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
    setMeldung({ art: "ok", text: "Danke, Ihre Bestätigung ist gespeichert." });
    router.refresh();
  }

  return (
    <div>
      <MeldungsBox meldung={meldung} className="mb-4" />

      {gruppen.map((gruppe, i) => (
        <section key={gruppe.teilnahmeId} className={i > 0 ? "mt-10" : ""}>
          {gruppen.length > 1 && <h2 className="mb-3 text-lg font-semibold text-foreground">{gruppe.semesterBezeichnung}</h2>}

          {gruppe.quote && <QuoteAmpel quote={gruppe.quote} sicht="schueler" />}

          {gruppe.tage.length === 0 && (
            <p className="mt-4 text-sm text-muted-foreground">Für dieses Semester stehen noch keine Abende fest.</p>
          )}

          {gruppe.tage.map((tag) => (
            <div key={tag.schluessel} className="mt-6">
              <Abschnitt titel={tag.titel} />
              <Gruppe>
                {tag.einheiten.map((einheit) => {
                  const aktuell = status[einheit.id] ?? null;
                  const zeigeKnoepfe = darfBearbeiten && einheit.darfBestaetigen;
                  const herkunft = !einheit.istVergangen || !aktuell ? null : einheit.darfBestaetigen ? "selbst bestätigt" : "von der Schule erfasst";
                  const unterzeile = [einheit.thema, herkunft].filter(Boolean).join(" · ");
                  return (
                    <div key={einheit.id} className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
                      <div className="min-w-0 flex-1 basis-44">
                        <p className="text-[15px] font-medium text-foreground lg:text-sm">
                          {[einheit.zeit, einheit.fach ?? "Unterricht"].join(" · ")}
                        </p>
                        {unterzeile && <p className="text-[13px] text-muted-foreground">{unterzeile}</p>}
                      </div>
                      {!einheit.istVergangen ? (
                        <span className="shrink-0 text-[13px] text-muted-foreground">geplant</span>
                      ) : zeigeKnoepfe ? (
                        <div
                          role="group"
                          aria-label={`Meine Anwesenheit am ${tag.titel}, ${einheit.zeit}`}
                          className="flex w-full rounded-[10px] bg-feld p-0.5 sm:w-auto"
                        >
                          {OPTIONEN.map((o) => {
                            const aktiv = aktuell === o.wert;
                            return (
                              <button
                                key={o.wert}
                                type="button"
                                onClick={() => bestaetigen(einheit.id, o.wert)}
                                disabled={laeuft === einheit.id}
                                aria-pressed={aktiv}
                                className={`h-10 flex-1 rounded-lg px-3 text-sm font-medium disabled:opacity-60 sm:flex-none ${
                                  aktiv
                                    ? "bg-background text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.1)]"
                                    : "text-muted-foreground hover:text-foreground"
                                }`}
                              >
                                {grossAnfang(o.label)}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <StatusPunkt ton={anwesenheitPunkt(aktuell)}>
                          {aktuell ? anwesenheitName(aktuell) : "noch offen"}
                        </StatusPunkt>
                      )}
                    </div>
                  );
                })}
              </Gruppe>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
