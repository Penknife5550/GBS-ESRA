"use client";

/**
 * GBS Campus — Inline-Noteneingabe auf der Personen-Detailakte
 *
 * Eine Zeile je Fach der laufenden Kurseinheiten, für GENAU diese Person. Anders
 * als die Matrix (viele Teilnehmer × ein Fach) ist das hier ein Teilnehmer × viele
 * Fächer — dasselbe Erfassungs-Payload (`/api/noten`, ein Eintrag je Kurseinheit),
 * nur die Achse ist gedreht. Overlay-/Entwurf-Muster wie in der Matrix: nur
 * geänderte Zeilen werden gesendet, „ungespeichert"/„gespeichert" sichtbar.
 *
 * Recht: nur Schulleitung (NOTEN_VERWALTEN) sieht diese Komponente überhaupt.
 */

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { LEISTUNG_ERGEBNISSE, ergebnisName } from "@/lib/leistung";

type LeistungWert = { ergebnis: string; punkte: number | null; note: string | null };

type Kurs = {
  kurseinheitId: string;
  fach: string;
  titel: string;
  wert: LeistungWert | null;
};

type Entwurf = { ergebnis: string; punkte: string; note: string };

const feldKlasse = "min-h-11 rounded-lg border border-input bg-background px-2 py-1.5 text-sm";

function ausWert(wert: LeistungWert | null): Entwurf {
  return {
    ergebnis: wert?.ergebnis ?? "",
    punkte: wert?.punkte != null ? String(wert.punkte) : "",
    note: wert?.note ?? "",
  };
}

function gleich(a: Entwurf, b: Entwurf): boolean {
  return a.ergebnis === b.ergebnis && a.punkte.trim() === b.punkte.trim() && a.note.trim() === b.note.trim();
}

export function NotenInline({
  semesterId,
  teilnahmeId,
  kurseinheiten,
}: {
  semesterId: string;
  teilnahmeId: string;
  kurseinheiten: Kurs[];
}) {
  const router = useRouter();
  const ausgangswerte: Record<string, Entwurf> = Object.fromEntries(
    kurseinheiten.map((k) => [k.kurseinheitId, ausWert(k.wert)]),
  );
  const [entwurf, setEntwurf] = useState<Record<string, Entwurf>>(ausgangswerte);
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<{ art: "ok" | "fehler"; text: string } | null>(null);

  function setzen(id: string, teil: Partial<Entwurf>) {
    setEntwurf((e) => ({ ...e, [id]: { ...e[id], ...teil } }));
    setMeldung(null);
  }

  // Zu sichern sind geänderte Zeilen MIT gesetztem Ergebnis (ohne Ergebnis gibt es
  // nichts zu speichern — Punkte/Note allein sind keine Bewertung).
  const zuSichern = kurseinheiten.filter((k) => {
    const jetzt = entwurf[k.kurseinheitId];
    return jetzt.ergebnis !== "" && !gleich(jetzt, ausgangswerte[k.kurseinheitId]);
  });

  async function speichern() {
    if (zuSichern.length === 0) return;

    // Erst ALLE Eingaben prüfen (Ganzzahl + Bereich 0–100), bevor ein Fach
    // committet wird. Sonst bliebe bei einem ungültigen späteren Fach ein Teil
    // gespeichert und der Rest nicht — inkonsistenter Zwischenstand.
    const fertig: { fach: string; kurseinheitId: string; ergebnis: string; punkte: number | null; note: string | null }[] = [];
    for (const k of zuSichern) {
      const jetzt = entwurf[k.kurseinheitId];
      const punkteText = jetzt.punkte.trim();
      let punkte: number | null = null;
      if (punkteText !== "") {
        const n = Number(punkteText);
        if (!Number.isInteger(n) || n < 0 || n > 100) {
          setMeldung({ art: "fehler", text: `„${k.fach}": Punkte müssen eine ganze Zahl von 0 bis 100 sein.` });
          return;
        }
        punkte = n;
      }
      fertig.push({
        fach: k.fach,
        kurseinheitId: k.kurseinheitId,
        ergebnis: jetzt.ergebnis,
        punkte,
        note: jetzt.note.trim() === "" ? null : jetzt.note.trim(),
      });
    }

    setLaeuft(true);
    setMeldung(null);

    let gesetzt = 0;
    for (const f of fertig) {
      const antwort = await sendeAnfrage<{ gesetzt: number }>("/api/noten", {
        methode: "POST",
        rumpf: {
          kurseinheitId: f.kurseinheitId,
          semesterId,
          eintraege: [{ teilnahmeId, ergebnis: f.ergebnis, punkte: f.punkte, note: f.note }],
        },
      });
      if (!antwort.ok) {
        setLaeuft(false);
        // Die schon gespeicherten Fächer sind committet — die Anzeige mit dem
        // Server versöhnen, damit ihre „ungespeichert"-Markierung verschwindet,
        // und die Teil-Speicherung offen benennen.
        setMeldung({
          art: "fehler",
          text:
            gesetzt > 0
              ? `${gesetzt} ${gesetzt === 1 ? "Fach" : "Fächer"} gespeichert. Bei „${f.fach}": ${antwort.meldung}`
              : `„${f.fach}": ${antwort.meldung}`,
        });
        startTransition(() => router.refresh());
        return;
      }
      gesetzt += antwort.daten.gesetzt;
    }

    setLaeuft(false);
    setMeldung({ art: "ok", text: `Noten gespeichert (${gesetzt} ${gesetzt === 1 ? "Fach" : "Fächer"}).` });
    startTransition(() => router.refresh());
  }

  if (kurseinheiten.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">
        Für das laufende Semester sind noch keine Fächer (Kurseinheiten) hinterlegt.
      </p>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <caption className="sr-only">Noten je Fach für diese Person</caption>
          <thead className="bg-muted/60 text-xs uppercase tracking-[0.04em] text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Fach</th>
              <th scope="col" className="px-4 py-2 font-medium">Ergebnis</th>
              <th scope="col" className="px-4 py-2 font-medium">Punkte</th>
              <th scope="col" className="px-4 py-2 font-medium">Note</th>
            </tr>
          </thead>
          <tbody>
            {kurseinheiten.map((k) => {
              const jetzt = entwurf[k.kurseinheitId];
              const geaendert = jetzt.ergebnis !== "" && !gleich(jetzt, ausgangswerte[k.kurseinheitId]);
              return (
                <tr key={k.kurseinheitId} className="border-t border-border align-top">
                  <td className="px-4 py-2.5">
                    <span className="font-medium">{k.fach}</span>
                    <span className="block text-xs text-muted-foreground">{k.titel}</span>
                    {geaendert && (
                      <span className="mt-1 inline-flex rounded-full bg-credo-gelb/25 px-2 py-0.5 text-xs font-medium text-foreground">
                        ungespeichert
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <label className="sr-only" htmlFor={`erg-${k.kurseinheitId}`}>
                      Ergebnis {k.fach}
                    </label>
                    <select
                      id={`erg-${k.kurseinheitId}`}
                      value={jetzt.ergebnis}
                      onChange={(e) => setzen(k.kurseinheitId, { ergebnis: e.target.value })}
                      className={feldKlasse}
                    >
                      <option value="">— nicht bewertet</option>
                      {LEISTUNG_ERGEBNISSE.map((erg) => (
                        <option key={erg} value={erg}>
                          {ergebnisName(erg)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5">
                    <label className="sr-only" htmlFor={`pkt-${k.kurseinheitId}`}>
                      Punkte {k.fach}
                    </label>
                    <input
                      id={`pkt-${k.kurseinheitId}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={100}
                      value={jetzt.punkte}
                      onChange={(e) => setzen(k.kurseinheitId, { punkte: e.target.value })}
                      disabled={jetzt.ergebnis === ""}
                      className={`${feldKlasse} w-20 disabled:opacity-50`}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <label className="sr-only" htmlFor={`note-${k.kurseinheitId}`}>
                      Note {k.fach}
                    </label>
                    <input
                      id={`note-${k.kurseinheitId}`}
                      type="text"
                      maxLength={40}
                      value={jetzt.note}
                      onChange={(e) => setzen(k.kurseinheitId, { note: e.target.value })}
                      disabled={jetzt.ergebnis === ""}
                      placeholder="z. B. gut"
                      className={`${feldKlasse} w-28 disabled:opacity-50`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3">
        <button
          type="button"
          onClick={speichern}
          disabled={laeuft || zuSichern.length === 0}
          className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {laeuft ? "Wird gespeichert …" : "Noten speichern"}
        </button>
        <span className="text-xs text-muted-foreground">
          Pflicht ist nur das Ergebnis; Punkte und Note sind optional (nur wo benotet wird).
        </span>
        {meldung && (
          <p
            role={meldung.art === "ok" ? "status" : "alert"}
            className={`w-full rounded-lg px-3 py-2 text-sm ${meldung.art === "ok" ? "bg-credo-gruen/10" : "bg-credo-rot/10"}`}
          >
            {meldung.text}
          </p>
        )}
      </div>
    </div>
  );
}
