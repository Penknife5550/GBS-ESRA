"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { anwesenheitName, type QuoteModellA, type QuoteZustand } from "@/lib/stundenplan";

type Termin = {
  id: string;
  text: string;
  fach: string | null;
  status: string | null;
  darfBestaetigen: boolean;
};
type Gruppe = { semesterBezeichnung: string; teilnahmeId: string; quote: QuoteModellA; termine: Termin[] };

// Bewusst Knöpfe statt eines <select>: Ein Klick ist eine eindeutige, gewollte
// Aktion. Ein Auswahlfeld dagegen speichert bei Tastaturbedienung schon beim
// Durchtippen jeden übersprungenen Wert (WCAG 3.2.2) — hier soll nur gespeichert
// werden, was der Teilnehmer wirklich anklickt.
const OPTIONEN = [
  { wert: "ANWESEND", label: "anwesend" },
  { wert: "NACHGEARBEITET", label: "nachgearbeitet" },
] as const;

// Ampel je Zustand — Tint aus der CREDO-Linie, Text durchgehend `text-foreground`
// (dunkel) für sicheren Kontrast auf den blassen Tints (roter Tint mit rotem Text
// verfehlt WCAG AA). Die Farbe unterscheidet, der Label-Text trägt die Aussage
// (WCAG 1.4.1 — nicht allein über Farbe).
const ZUSTAND_STIL: Record<QuoteZustand, { label: string; badge: string }> = {
  ERFUELLT: { label: "Erfüllt", badge: "bg-credo-gruen/15 text-foreground" },
  OFFEN: { label: "Noch offen", badge: "bg-credo-gelb/25 text-foreground" },
  NICHT_ERREICHBAR: { label: "Nicht mehr erreichbar", badge: "bg-credo-rot/15 text-foreground" },
};

function abendWort(n: number): string {
  return n === 1 ? "Abend" : "Abende";
}

function hinweisText(q: QuoteModellA): string {
  if (q.zustand === "ERFUELLT") {
    return "Die Anwesenheitspflicht ist damit gesichert — bereits erfasste Teilnahmen zählen fest.";
  }
  if (q.zustand === "NICHT_ERREICHBAR") {
    return "Die Anwesenheitspflicht ist in diesem Semester rechnerisch nicht mehr erreichbar. Bitte wende dich an die Schulleitung.";
  }
  if (q.darfNochFehlen <= 0) {
    return "Achtung: Du darfst keinen Abend mehr fehlen, sonst reißt die Grenze.";
  }
  return `Du darfst noch ${q.darfNochFehlen} ${abendWort(q.darfNochFehlen)} fehlen.`;
}

function QuoteZeile({ quote }: { quote: QuoteModellA }) {
  // Fällt ein unbekannter Zustand herein (Server/Client-Skew, künftiger vierter
  // Zustand), lieber neutral „offen" zeigen als die ganze Sektion crashen lassen.
  const stil = ZUSTAND_STIL[quote.zustand] ?? ZUSTAND_STIL.OFFEN;
  // Der handlungsrelevante Fall (nicht mehr erreichbar / kein Puffer mehr) darf
  // nicht der leiseste Text auf der Seite sein.
  const dringend =
    quote.zustand === "NICHT_ERREICHBAR" || (quote.zustand === "OFFEN" && quote.darfNochFehlen <= 0);
  return (
    <div className="mt-2 rounded-lg border border-border bg-muted px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">
          Teilgenommen: {quote.teilgenommen} von {quote.gesamt} Abenden
        </span>
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${stil.badge}`}>
          {stil.label}
        </span>
      </div>
      <p className={`mt-1 text-xs ${dringend ? "font-medium text-foreground" : "text-muted-foreground"}`}>
        Nötig sind {quote.benoetigt} von {quote.gesamt} Abenden ({quote.schwelleProzent}&nbsp;%). {hinweisText(quote)}
      </p>
    </div>
  );
}

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
  const [meldung, setMeldung] = useState<{ art: "ok" | "fehler"; text: string } | null>(null);

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

      {meldung && (
        <p
          role={meldung.art === "ok" ? "status" : "alert"}
          className={`mt-4 rounded-lg px-3 py-2 text-sm ${
            meldung.art === "ok" ? "bg-credo-gruen/10" : "bg-credo-rot/10"
          }`}
        >
          {meldung.text}
        </p>
      )}

      {gruppen.map((gruppe) => (
        <div key={gruppe.teilnahmeId} className="mt-6">
          <h3 className="text-sm font-semibold">{gruppe.semesterBezeichnung}</h3>

          <QuoteZeile quote={gruppe.quote} />

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
                    {termin.fach && <span className="ml-2 text-sm text-muted-foreground">· {termin.fach}</span>}
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
                    <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                      von der Schule erfasst: {anwesenheitName(termin.status)}
                    </span>
                  ) : (
                    <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                      {termin.status ? anwesenheitName(termin.status) : "noch offen"}
                    </span>
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
