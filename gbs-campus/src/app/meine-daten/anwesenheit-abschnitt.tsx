"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { anwesenheitName } from "@/lib/stundenplan";

type Termin = {
  id: string;
  text: string;
  fach: string | null;
  status: string | null;
  darfBestaetigen: boolean;
};
type Gruppe = { semesterBezeichnung: string; teilnahmeId: string; termine: Termin[] };

// Bewusst Knöpfe statt eines <select>: Ein Klick ist eine eindeutige, gewollte
// Aktion. Ein Auswahlfeld dagegen speichert bei Tastaturbedienung schon beim
// Durchtippen jeden übersprungenen Wert (WCAG 3.2.2) — hier soll nur gespeichert
// werden, was der Teilnehmer wirklich anklickt.
const OPTIONEN = [
  { wert: "ANWESEND", label: "anwesend" },
  { wert: "NACHGEARBEITET", label: "nachgearbeitet" },
] as const;

export function AnwesenheitAbschnitt({ gruppen }: { gruppen: Gruppe[] }) {
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
        Bestätige hier selbst, an welchen vergangenen Abenden du da warst oder den Stoff nachgearbeitet
        hast. Beides zählt als Teilnahme. Was die Schule schon erfasst hat, steht fest und ist hier nur
        zum Nachlesen.
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
          <ul className="mt-3 space-y-2">
            {gruppe.termine.map((termin) => (
              <li
                key={termin.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium">{termin.text}</span>
                  {termin.fach && <span className="ml-2 text-sm text-muted-foreground">· {termin.fach}</span>}
                </div>

                {termin.darfBestaetigen ? (
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
                ) : (
                  <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    von der Schule erfasst: {anwesenheitName(termin.status)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
