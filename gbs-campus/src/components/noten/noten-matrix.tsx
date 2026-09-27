"use client";

import { startTransition, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import {
  ERGEBNIS_OPTIONEN,
  NOTE_MAX_LAENGE,
  PUNKTE_MAX,
  PUNKTE_MIN,
  punkteGueltig,
  type LeistungWert,
} from "@/lib/leistung";

type Teilnehmer = { teilnahmeId: string; name: string };
type Kurseinheit = {
  kurseinheitId: string;
  fach: string;
  titel: string;
  teilnehmer: Teilnehmer[];
  leistungen: Record<string, LeistungWert>;
};

// Reihenfolge wie im Modell (`ERGEBNIS_OPTIONEN` aus leistung.ts); "" = nicht
// erfasst (eine bereits gesetzte Bewertung lässt sich ändern, aber über die
// Matrix nicht wieder leeren).
const AUSWAHL = [{ wert: "", label: "— nicht erfasst —" }, ...ERGEBNIS_OPTIONEN];

const selectKlasse = "min-h-11 rounded-lg border border-input bg-background px-2 py-1.5 text-sm";
const inputKlasse = "min-h-11 rounded-lg border border-input bg-background px-2 py-1.5 text-sm";

type Zeile = { ergebnis: string; punkte: string; note: string };

/**
 * Noten-Matrix je Kurseinheit, geteilt von Dozent (`/api/dozent/note`) und
 * Schulleitung (`/api/noten`) — dieselbe Rumpfform { kurseinheitId, semesterId,
 * eintraege }. Overlay-Muster wie beim Stundenplan des Dozenten: die Anzeige
 * nimmt den gespeicherten Stand und legt die ungespeicherten Änderungen darüber;
 * nach dem Speichern wird das Overlay der Kurseinheit geleert und der
 * Server-Stand neu geladen.
 */
export function NotenMatrix({
  semesterId,
  kurseinheiten,
  endpunkt,
}: {
  semesterId: string;
  kurseinheiten: Kurseinheit[];
  /** Ziel-Route der POST-Anfrage (Dozent bzw. Schulleitung). */
  endpunkt: string;
}) {
  const router = useRouter();
  const [offen, setOffen] = useState<string | null>(null);
  // kurseinheitId → teilnahmeId → Zeilen-Entwurf (nur berührte Zeilen).
  const [entwurf, setEntwurf] = useState<Record<string, Record<string, Zeile>>>({});
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<{ kurseinheitId: string; art: "ok" | "fehler"; text: string } | null>(null);

  function gespeicherteZeile(k: Kurseinheit, teilnahmeId: string): Zeile {
    const l = k.leistungen[teilnahmeId];
    return {
      ergebnis: l?.ergebnis ?? "",
      punkte: l?.punkte != null ? String(l.punkte) : "",
      note: l?.note ?? "",
    };
  }

  function angezeigteZeile(k: Kurseinheit, teilnahmeId: string): Zeile {
    return entwurf[k.kurseinheitId]?.[teilnahmeId] ?? gespeicherteZeile(k, teilnahmeId);
  }

  function setFeld(k: Kurseinheit, teilnahmeId: string, feld: keyof Zeile, wert: string) {
    setEntwurf((prev) => {
      const vorhanden = prev[k.kurseinheitId]?.[teilnahmeId] ?? gespeicherteZeile(k, teilnahmeId);
      const neu = { ...vorhanden, [feld]: wert };
      return { ...prev, [k.kurseinheitId]: { ...prev[k.kurseinheitId], [teilnahmeId]: neu } };
    });
  }

  // Hat diese Kurseinheit ungespeicherte Änderungen? (Zuklappen verwirft den
  // Entwurf nicht — ein Seitenwechsel schon; deshalb wird der Zustand sichtbar
  // markiert, und der Browser fragt vorher nach, siehe unten.)
  function istGeaendert(k: Kurseinheit): boolean {
    const beruehrt = entwurf[k.kurseinheitId];
    if (!beruehrt) return false;
    return Object.entries(beruehrt).some(([teilnahmeId, z]) => {
      const g = gespeicherteZeile(k, teilnahmeId);
      return z.ergebnis !== g.ergebnis || z.punkte !== g.punkte || z.note !== g.note;
    });
  }

  // Ungespeicherte Noten nicht still verwerfen: Neuladen, Schließen und die
  // Semesterwahl (ein GET-Formular, also ein echter Seitenwechsel) fragen über
  // `beforeunload` nach. Ein Link innerhalb der App (Client-Navigation) löst das
  // Ereignis nicht aus — dafür bleibt die „ungespeichert“-Markierung.
  const hatUngespeichertes = kurseinheiten.some((k) => istGeaendert(k));
  useEffect(() => {
    if (!hatUngespeichertes) return;
    function warnen(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Ältere Browser zeigen die Rückfrage nur mit gesetztem returnValue.
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", warnen);
    return () => window.removeEventListener("beforeunload", warnen);
  }, [hatUngespeichertes]);

  async function speichern(k: Kurseinheit) {
    const beruehrt = entwurf[k.kurseinheitId] ?? {};
    const nameVon = new Map(k.teilnehmer.map((t) => [t.teilnahmeId, t.name]));
    const eintraege: { teilnahmeId: string; ergebnis: string; punkte: number | null; note: string | null }[] = [];
    let punkteFehler: string | null = null;
    // Nur die in dieser Sitzung berührten Zeilen senden — nicht die bereits
    // gespeicherten unverändert mitschreiben. Sonst zählte die Erfolgsmeldung zu
    // hoch und die Provenienz (erfasstVonId) unveränderter Zeilen würde auf den
    // aktuellen Erfasser überschrieben.
    for (const [teilnahmeId, z] of Object.entries(beruehrt)) {
      if (z.ergebnis === "") continue; // „nicht erfasst" wird nicht gespeichert
      const punkteRoh = z.punkte.trim();
      let punkte: number | null = null;
      if (punkteRoh !== "") {
        const zahl = Number(punkteRoh);
        if (!punkteGueltig(zahl)) {
          punkteFehler = `Punkte bei ${nameVon.get(teilnahmeId) ?? "einem Teilnehmer"} müssen eine ganze Zahl zwischen ${PUNKTE_MIN} und ${PUNKTE_MAX} sein.`;
          break;
        }
        punkte = zahl;
      }
      eintraege.push({
        teilnahmeId,
        ergebnis: z.ergebnis,
        punkte,
        note: z.note.trim() === "" ? null : z.note.trim(),
      });
    }

    if (punkteFehler) {
      setMeldung({ kurseinheitId: k.kurseinheitId, art: "fehler", text: punkteFehler });
      return;
    }
    if (eintraege.length === 0) {
      setMeldung({ kurseinheitId: k.kurseinheitId, art: "fehler", text: "Es gibt keine Bewertung zum Speichern." });
      return;
    }

    setLaeuft(k.kurseinheitId);
    setMeldung(null);
    const antwort = await sendeAnfrage<{ gesetzt: number }>(endpunkt, {
      methode: "POST",
      rumpf: { kurseinheitId: k.kurseinheitId, semesterId, eintraege },
    });
    setLaeuft(null);
    if (!antwort.ok) {
      setMeldung({ kurseinheitId: k.kurseinheitId, art: "fehler", text: antwort.meldung });
      return;
    }
    const n = antwort.daten.gesetzt;
    setMeldung({
      kurseinheitId: k.kurseinheitId,
      art: "ok",
      text: `Noten gespeichert (${n} ${n === 1 ? "Eintrag" : "Einträge"}).`,
    });
    // Overlay der Kurseinheit leeren + Server-Daten neu laden gemeinsam als
    // Transition — hält die Ansicht, bis die frischen Props da sind.
    startTransition(() => {
      setEntwurf((prev) => {
        const rest = { ...prev };
        delete rest[k.kurseinheitId];
        return rest;
      });
      router.refresh();
    });
  }

  if (kurseinheiten.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
        Für dieses Semester sind noch keine Fächer mit Unterrichtsabenden zugeordnet — erst dann lassen sich
        Noten erfassen.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {kurseinheiten.map((k) => {
        const istOffen = offen === k.kurseinheitId;
        const erfasst = k.teilnehmer.filter((t) => k.leistungen[t.teilnahmeId]?.ergebnis).length;
        const zeigtMeldung = meldung?.kurseinheitId === k.kurseinheitId;
        return (
          <li key={k.kurseinheitId} className="rounded-lg border border-border bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="text-sm font-medium">{k.fach}</span>
                <span className="ml-2 text-sm text-muted-foreground">· {k.titel}</span>
              </div>
              <div className="flex items-center gap-2">
                {istGeaendert(k) && (
                  <span className="inline-flex rounded-full bg-credo-gelb/25 px-2.5 py-0.5 text-xs font-medium text-foreground">
                    ungespeichert
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setMeldung(null);
                    setOffen(istOffen ? null : k.kurseinheitId);
                  }}
                  aria-expanded={istOffen}
                  className="min-h-11 rounded-lg border border-border px-3 py-1.5 text-sm hover:border-primary"
                >
                  Noten ({erfasst} von {k.teilnehmer.length})
                </button>
              </div>
            </div>

            {istOffen && (
              <div className="mt-3 border-t border-border pt-3">
                {k.teilnehmer.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Für dieses Semester sind keine aktiven Teilnehmer eingetragen.
                  </p>
                ) : (
                  <>
                    <ul className="space-y-2">
                      {k.teilnehmer.map((t) => {
                        const z = angezeigteZeile(k, t.teilnahmeId);
                        return (
                          <li key={t.teilnahmeId} className="flex flex-wrap items-center gap-2">
                            <span className="min-w-[8rem] flex-1 text-sm">{t.name}</span>
                            <select
                              aria-label={`Ergebnis von ${t.name}`}
                              value={z.ergebnis}
                              onChange={(e) => setFeld(k, t.teilnahmeId, "ergebnis", e.target.value)}
                              className={selectKlasse}
                            >
                              {AUSWAHL.map((o) => (
                                <option key={o.wert} value={o.wert}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                            <input
                              type="number"
                              inputMode="numeric"
                              min={PUNKTE_MIN}
                              max={PUNKTE_MAX}
                              step={1}
                              placeholder="Punkte"
                              aria-label={`Punkte von ${t.name} (optional)`}
                              value={z.punkte}
                              onChange={(e) => setFeld(k, t.teilnahmeId, "punkte", e.target.value)}
                              className={`w-24 ${inputKlasse}`}
                            />
                            <input
                              type="text"
                              maxLength={NOTE_MAX_LAENGE}
                              placeholder="Note"
                              aria-label={`Note von ${t.name} (optional)`}
                              value={z.note}
                              onChange={(e) => setFeld(k, t.teilnahmeId, "note", e.target.value)}
                              className={`w-28 ${inputKlasse}`}
                            />
                          </li>
                        );
                      })}
                    </ul>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Pflicht ist nur das Ergebnis. Punkte und Note sind optional (nur wo benotet wird, z. B.
                      Bibelkunde). Nur bewertete Zeilen werden gespeichert.
                    </p>
                    <button
                      type="button"
                      onClick={() => speichern(k)}
                      disabled={laeuft === k.kurseinheitId}
                      className="mt-3 min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                    >
                      {laeuft === k.kurseinheitId ? "Wird gespeichert …" : "Noten speichern"}
                    </button>
                    <p
                      role={zeigtMeldung && meldung?.art === "fehler" ? "alert" : "status"}
                      className={
                        zeigtMeldung
                          ? `mt-3 rounded-lg px-3 py-2 text-sm ${meldung?.art === "ok" ? "bg-credo-gruen/10" : "bg-credo-rot/10"}`
                          : "sr-only"
                      }
                    >
                      {zeigtMeldung ? meldung?.text : ""}
                    </p>
                  </>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
