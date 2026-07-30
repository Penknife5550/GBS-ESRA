"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";

type Termin = { id: string; text: string; fach: string | null; istVergangen: boolean };
type Teilnehmer = { teilnahmeId: string; name: string };
type Gruppe = {
  semesterBezeichnung: string;
  teilnehmer: Teilnehmer[];
  termine: Termin[];
  anwesenheit: Record<string, Record<string, string>>;
};

// „— (nicht erfasst)" heißt: kein Status. Ein bereits gesetzter Status lässt sich
// ändern, aber nicht wieder leeren — der Dozent erfasst nur anwesend/gefehlt/
// nachgearbeitet, „entschuldigt" entscheidet die Schule.
const OPTIONEN = [
  { wert: "", label: "— (nicht erfasst)" },
  { wert: "ANWESEND", label: "anwesend" },
  { wert: "GEFEHLT", label: "gefehlt" },
  { wert: "NACHGEARBEITET", label: "nachgearbeitet" },
] as const;

export function StundenplanDozent({
  gruppen,
  darfErfassen,
}: {
  gruppen: Gruppe[];
  /** Nur mit ANWESENHEIT_ERFASSEN_EIGENE erscheint das Erfassungs-Panel; der
   * Stundenplan selbst sieht schon, wer EIGENE_TERMINE_LESEN hat. */
  darfErfassen: boolean;
}) {
  const router = useRouter();
  const [offen, setOffen] = useState<string | null>(null);
  // Overlay der ungespeicherten Änderungen (terminId → teilnahmeId → Status).
  // Bewusst NICHT aus den Props vorbelegt: die Anzeige nimmt den gespeicherten
  // Stand aus `gruppe.anwesenheit` und legt das Overlay darüber. Nach dem
  // Speichern wird das Overlay des Abends geleert, sodass `router.refresh()` den
  // frischen Server-Stand zeigt (kein veralteter Lokal-Stand, kein falscher Zähler).
  const [overlay, setOverlay] = useState<Record<string, Record<string, string>>>({});
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<{ terminId: string; art: "ok" | "fehler"; text: string } | null>(null);

  function wert(gruppe: Gruppe, terminId: string, teilnahmeId: string): string {
    return overlay[terminId]?.[teilnahmeId] ?? gruppe.anwesenheit[terminId]?.[teilnahmeId] ?? "";
  }
  function setWert(terminId: string, teilnahmeId: string, neu: string) {
    setOverlay((o) => ({ ...o, [terminId]: { ...o[terminId], [teilnahmeId]: neu } }));
  }

  async function speichern(terminId: string) {
    const eintraege = Object.entries(overlay[terminId] ?? {})
      .filter(([, s]) => s !== "")
      .map(([teilnahmeId, status]) => ({ teilnahmeId, status }));
    if (eintraege.length === 0) {
      setMeldung({ terminId, art: "fehler", text: "Es gibt keine Änderung zum Speichern." });
      return;
    }
    setLaeuft(terminId);
    setMeldung(null);
    const antwort = await sendeAnfrage<{ gesetzt: number }>("/api/dozent/anwesenheit", {
      methode: "POST",
      rumpf: { terminId, eintraege },
    });
    setLaeuft(null);
    if (!antwort.ok) {
      setMeldung({ terminId, art: "fehler", text: antwort.meldung });
      return;
    }
    // Overlay dieses Abends leeren → die Anzeige fällt auf den frischen Server-Stand.
    setOverlay((o) => {
      const rest = { ...o };
      delete rest[terminId];
      return rest;
    });
    const n = antwort.daten.gesetzt;
    setMeldung({ terminId, art: "ok", text: `Anwesenheit gespeichert (${n} ${n === 1 ? "Eintrag" : "Einträge"}).` });
    router.refresh();
  }

  return (
    <div>
      {gruppen.map((gruppe) => (
        <div key={gruppe.semesterBezeichnung} className="mt-6 first:mt-0">
          <h2 className="text-sm font-semibold">{gruppe.semesterBezeichnung}</h2>
          <ul className="mt-3 space-y-2">
            {gruppe.termine.map((termin) => {
              const kannErfassen = darfErfassen && termin.istVergangen;
              const istOffen = offen === termin.id;
              const erfasst = Object.keys(gruppe.anwesenheit[termin.id] ?? {}).length;
              return (
                <li key={termin.id} className="rounded-lg border border-border bg-card p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-sm font-medium">{termin.text}</span>
                      {termin.fach && (
                        <span className="ml-2 text-sm text-muted-foreground">· {termin.fach}</span>
                      )}
                    </div>

                    {!termin.istVergangen ? (
                      <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                        noch nicht stattgefunden
                      </span>
                    ) : kannErfassen ? (
                      <button
                        type="button"
                        onClick={() => setOffen(istOffen ? null : termin.id)}
                        aria-expanded={istOffen}
                        className="min-h-11 rounded-lg border border-border px-3 py-1.5 text-sm hover:border-primary"
                      >
                        Anwesenheit ({erfasst} von {gruppe.teilnehmer.length})
                      </button>
                    ) : (
                      <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                        {erfasst} von {gruppe.teilnehmer.length} erfasst
                      </span>
                    )}
                  </div>

                  {kannErfassen && istOffen && (
                    <div className="mt-3 border-t border-border pt-3">
                      {gruppe.teilnehmer.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Für dieses Semester sind keine aktiven Teilnehmer eingetragen.
                        </p>
                      ) : (
                        <>
                          <ul className="space-y-2">
                            {gruppe.teilnehmer.map((t) => (
                              <li key={t.teilnahmeId} className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-sm">{t.name}</span>
                                <select
                                  aria-label={`Anwesenheit von ${t.name} am ${termin.text}`}
                                  value={wert(gruppe, termin.id, t.teilnahmeId)}
                                  onChange={(e) => setWert(termin.id, t.teilnahmeId, e.target.value)}
                                  className="min-h-11 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                                >
                                  {OPTIONEN.map((o) => (
                                    <option key={o.wert} value={o.wert}>
                                      {o.label}
                                    </option>
                                  ))}
                                </select>
                              </li>
                            ))}
                          </ul>
                          <p className="mt-2 text-xs text-muted-foreground">
                            Ein gesetzter Status kann geändert, aber nicht wieder geleert werden.
                          </p>
                          <button
                            type="button"
                            onClick={() => speichern(termin.id)}
                            disabled={laeuft === termin.id}
                            className="mt-3 min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                          >
                            {laeuft === termin.id ? "Wird gespeichert …" : "Speichern"}
                          </button>
                          {/* Rückmeldung direkt an der Aktion; Region dauerhaft im DOM,
                              damit Screenreader den Statuswechsel zuverlässig ansagen. */}
                          <p
                            role={meldung?.terminId === termin.id && meldung.art === "fehler" ? "alert" : "status"}
                            aria-live="polite"
                            className={
                              meldung?.terminId === termin.id
                                ? `mt-3 rounded-lg px-3 py-2 text-sm ${meldung.art === "ok" ? "bg-credo-gruen/10" : "bg-credo-rot/10"}`
                                : "sr-only"
                            }
                          >
                            {meldung?.terminId === termin.id ? meldung.text : ""}
                          </p>
                        </>
                      )}
                    </div>
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
