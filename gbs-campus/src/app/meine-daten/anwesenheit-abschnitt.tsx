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

const selectKlasse = "min-h-10 rounded-lg border border-input bg-background px-3 py-1.5 text-sm";

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
    if (!neu) return;
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
                  <select
                    aria-label={`Meine Anwesenheit am ${termin.text}`}
                    value={status[termin.id] ?? ""}
                    disabled={laeuft === termin.id}
                    onChange={(e) => bestaetigen(termin.id, e.target.value)}
                    className={selectKlasse}
                  >
                    <option value="" disabled>
                      — bitte wählen —
                    </option>
                    <option value="ANWESEND">anwesend</option>
                    <option value="NACHGEARBEITET">nachgearbeitet</option>
                  </select>
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
