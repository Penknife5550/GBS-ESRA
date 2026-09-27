"use client";

/**
 * GBS Campus — Inline-Noteneingabe auf der Personen-Detailakte
 *
 * Eine Zeile je Fach der laufenden Kurseinheiten, für GENAU diese Person. Anders
 * als die Matrix (viele Teilnehmer × ein Fach) ist das hier ein Teilnehmer × viele
 * Fächer — dasselbe Erfassungs-Payload (`/api/noten`, ein Eintrag je Kurseinheit),
 * nur die Achse ist gedreht. Overlay-Muster wie in der Matrix: Angezeigt wird der
 * gespeicherte Stand aus den Props, darüber liegen nur die berührten Zeilen. Nach
 * dem Speichern fallen die gesendeten Zeilen aus dem Overlay, und die Anzeige
 * zeigt wieder, was in der Datenbank steht. Vorher wurde der Entwurf nur beim
 * ersten Rendern gesetzt — nach `router.refresh()` konnte die Zeile „nicht
 * bewertet" zeigen, während die Datenbank „bestanden" hielt (Code-Review 4, M18).
 *
 * Eine gesetzte Bewertung lässt sich ändern, aber nicht entfernen — die API kennt
 * kein Leeren (`ergebnis` ist Pflicht). Die leere Option ist bei bewerteten
 * Fächern deshalb gesperrt, statt still verworfen zu werden.
 *
 * Recht: nur Schulleitung (NOTEN_VERWALTEN) sieht diese Komponente überhaupt.
 */

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { MeldungsBox, type Meldung } from "@/components/ui/meldung";
import {
  ERGEBNIS_OPTIONEN,
  NOTE_MAX_LAENGE,
  PUNKTE_MAX,
  PUNKTE_MIN,
  punkteGueltig,
  type LeistungWert,
} from "@/lib/leistung";

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

/**
 * Was die Zeile zeigt: der Overlay-Eintrag, sonst der gespeicherte Stand. Fehlt
 * der Eintrag — etwa weil nach dem Neuladen eine Kurseinheit dazugekommen ist —,
 * gilt einfach der gespeicherte Stand; ein fehlender Schlüssel darf das Rendern
 * nicht abbrechen.
 *
 * Ein bewertetes Fach zeigt nie „nicht bewertet": Ein leerer Overlay-Eintrag
 * (entstanden, solange das Fach noch unbewertet war) weicht dem gespeicherten
 * Ergebnis, sobald die Datenbank eines hat.
 */
function angezeigt(k: Kurs, overlay: Record<string, Entwurf>): Entwurf {
  const gespeichert = ausWert(k.wert);
  const eintrag = overlay[k.kurseinheitId];
  if (!eintrag) return gespeichert;
  if (eintrag.ergebnis === "" && gespeichert.ergebnis !== "") return gespeichert;
  return eintrag;
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
  // kurseinheitId → Zeilen-Entwurf, nur für berührte Zeilen (Overlay).
  const [entwurf, setEntwurf] = useState<Record<string, Entwurf>>({});
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<Meldung | null>(null);
  const hinweisId = `noten-hinweis-${teilnahmeId}`;

  function setzen(k: Kurs, teil: Partial<Entwurf>) {
    setEntwurf((e) => {
      const neu = { ...angezeigt(k, e), ...teil };
      const rest = { ...e };
      // Zurückgedreht auf den gespeicherten Stand? Dann gehört die Zeile nicht
      // mehr ins Overlay — sonst verdeckte sie einen späteren Server-Stand.
      if (gleich(neu, ausWert(k.wert))) delete rest[k.kurseinheitId];
      else rest[k.kurseinheitId] = neu;
      return rest;
    });
    setMeldung(null);
  }

  /** Nimmt genau die gesendeten Zeilen aus dem Overlay — außer, sie wurden während des Speicherns weiter bearbeitet. */
  function overlayLeeren(gesendet: Map<string, Entwurf>) {
    setEntwurf((e) => {
      const rest = { ...e };
      for (const [id, zeile] of gesendet) {
        if (rest[id] === zeile) delete rest[id];
      }
      return rest;
    });
  }

  // Zu sichern sind geänderte Zeilen MIT gesetztem Ergebnis (ohne Ergebnis gibt es
  // nichts zu speichern — Punkte/Note allein sind keine Bewertung).
  const zuSichern = kurseinheiten.filter((k) => {
    const jetzt = angezeigt(k, entwurf);
    return jetzt.ergebnis !== "" && !gleich(jetzt, ausWert(k.wert));
  });

  async function speichern() {
    if (zuSichern.length === 0) return;

    // Erst ALLE Eingaben prüfen (Ganzzahl + Bereich, `punkteGueltig`), bevor ein Fach
    // committet wird. Sonst bliebe bei einem ungültigen späteren Fach ein Teil
    // gespeichert und der Rest nicht — inkonsistenter Zwischenstand.
    const fertig: { fach: string; kurseinheitId: string; ergebnis: string; punkte: number | null; note: string | null }[] = [];
    // Der Overlay-Eintrag, so wie er gesendet wird — nach dem Speichern fällt er
    // nur heraus, wenn er inzwischen nicht weiter bearbeitet wurde.
    const gesendet = new Map<string, Entwurf>();
    for (const k of zuSichern) {
      const jetzt = angezeigt(k, entwurf);
      gesendet.set(k.kurseinheitId, jetzt);
      const punkteText = jetzt.punkte.trim();
      let punkte: number | null = null;
      if (punkteText !== "") {
        const n = Number(punkteText);
        if (!punkteGueltig(n)) {
          setMeldung({
            art: "fehler",
            text: `„${k.fach}": Punkte müssen eine ganze Zahl von ${PUNKTE_MIN} bis ${PUNKTE_MAX} sein.`,
          });
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
    const gespeichert = new Map<string, Entwurf>();
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
        startTransition(() => {
          overlayLeeren(gespeichert);
          router.refresh();
        });
        return;
      }
      gesetzt += antwort.daten.gesetzt;
      const zeile = gesendet.get(f.kurseinheitId);
      if (zeile) gespeichert.set(f.kurseinheitId, zeile);
    }

    setLaeuft(false);
    setMeldung({ art: "ok", text: `Noten gespeichert (${gesetzt} ${gesetzt === 1 ? "Fach" : "Fächer"}).` });
    // Overlay leeren und Server-Stand neu laden gemeinsam als Transition (wie in
    // der Matrix) — die Ansicht hält den alten Stand, bis die frischen Props da
    // sind, und zeigt danach genau das, was gespeichert ist.
    startTransition(() => {
      overlayLeeren(gespeichert);
      router.refresh();
    });
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
              const jetzt = angezeigt(k, entwurf);
              const geaendert = jetzt.ergebnis !== "" && !gleich(jetzt, ausWert(k.wert));
              const bewertet = Boolean(k.wert?.ergebnis);
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
                      onChange={(e) => setzen(k, { ergebnis: e.target.value })}
                      aria-describedby={bewertet ? hinweisId : undefined}
                      className={feldKlasse}
                    >
                      {/* Bei bewerteten Fächern gesperrt: Die API kann eine Bewertung
                          nicht leeren — wählbar wäre sie nur scheinbar. */}
                      <option value="" disabled={bewertet}>
                        — nicht bewertet
                      </option>
                      {ERGEBNIS_OPTIONEN.map((o) => (
                        <option key={o.wert} value={o.wert}>
                          {o.label}
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
                      min={PUNKTE_MIN}
                      max={PUNKTE_MAX}
                      value={jetzt.punkte}
                      onChange={(e) => setzen(k, { punkte: e.target.value })}
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
                      maxLength={NOTE_MAX_LAENGE}
                      value={jetzt.note}
                      onChange={(e) => setzen(k, { note: e.target.value })}
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
        <span id={hinweisId} className="text-xs text-muted-foreground">
          Pflicht ist nur das Ergebnis; Punkte und Note sind optional (nur wo benotet wird). Eine gesetzte Bewertung
          lässt sich ändern, aber nicht entfernen.
        </span>
        <MeldungsBox meldung={meldung} className="w-full" />
      </div>
    </div>
  );
}
