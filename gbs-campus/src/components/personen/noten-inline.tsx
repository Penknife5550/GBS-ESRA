"use client";

/**
 * GBS Campus — Noteneingabe auf der Personen-Detailakte
 *
 * Die Akte zeigt die Noten lesend; „Noten eintragen“ öffnet diesen Editor im
 * Blatt (Oberflächenplan 09/2026: Lesen und Bearbeiten trennen). Vorher stand
 * er als Tabelle in einer halben Spalte, die Spalte „Punkte“ war rechts
 * abgeschnitten. Jetzt ist jedes Fach eine Zeile, die am Handy untereinander
 * umbricht (Ergebnis, darunter Punkte und Note) — ohne waagrechtes Scrollen.
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
 * Wer das Blatt schließt, verliert nichts: Ungespeicherte Zeilen bleiben markiert
 * stehen, bis sie gespeichert oder zurückgedreht sind.
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
import { Blatt } from "@/components/ui/blatt";
import { knopf } from "@/components/ui/knopf";
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

const feldKlasse = "min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm lg:min-h-10";
/** Spalten ab sm: Fach · Ergebnis · Punkte · Note (Kopfzeile und Zeilen teilen sie). */
const spalten = "sm:grid-cols-[minmax(0,1fr)_12rem_5.5rem_8rem]";

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
  titel,
}: {
  semesterId: string;
  teilnahmeId: string;
  kurseinheiten: Kurs[];
  /** Titel des Blatts, z. B. „Noten · Herbstsemester 2026“. */
  titel: string;
}) {
  const router = useRouter();
  const [offen, setOffen] = useState(false);
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

  // Ohne Fächer gibt es nichts einzutragen — den Grund nennt die Akte selbst.
  if (kurseinheiten.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOffen(true)}
        className="-my-3 inline-flex min-h-11 items-center rounded-md px-1.5 hover:bg-muted lg:-my-1.5 lg:min-h-8"
      >
        Noten eintragen
      </button>
      <Blatt
        offen={offen}
        onSchliessen={() => setOffen(false)}
        titel={titel}
        breit
        fuss={
          <>
            <button type="button" onClick={() => setOffen(false)} className={knopf("sekundaer")}>
              Schließen
            </button>
            <button
              type="button"
              onClick={speichern}
              disabled={laeuft || zuSichern.length === 0}
              className={knopf("primaer")}
            >
              {laeuft ? "Wird gespeichert …" : "Noten speichern"}
            </button>
          </>
        }
      >
        {/* Das Blatt steht im Kopf des Abschnitts — Schrift hier ausdrücklich zurücksetzen. */}
        <div className="text-sm font-normal text-foreground">
          <p id={hinweisId} className="text-[13px] text-muted-foreground">
            Pflicht ist nur das Ergebnis; Punkte und Note sind optional (nur wo benotet wird). Eine gesetzte Bewertung
            lässt sich ändern, aber nicht entfernen.
          </p>
          <div
            aria-hidden="true"
            className={`mt-4 hidden gap-3 border-b border-linie pb-2 text-xs font-medium text-muted-foreground sm:grid ${spalten}`}
          >
            <span>Fach</span>
            <span>Ergebnis</span>
            <span>Punkte</span>
            <span>Note</span>
          </div>
          <ul className="divide-y divide-linie">
            {kurseinheiten.map((k) => {
              const jetzt = angezeigt(k, entwurf);
              const geaendert = jetzt.ergebnis !== "" && !gleich(jetzt, ausWert(k.wert));
              const bewertet = Boolean(k.wert?.ergebnis);
              return (
                <li key={k.kurseinheitId} className={`grid gap-3 py-3.5 sm:items-center ${spalten}`}>
                  <div className="min-w-0">
                    <p className="font-medium">{k.fach}</p>
                    <p className="text-[13px] text-muted-foreground">{k.titel}</p>
                    {geaendert && (
                      <span className="mt-1 inline-flex rounded-full bg-credo-gelb/25 px-2 py-0.5 text-xs font-medium text-foreground">
                        ungespeichert
                      </span>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground sm:sr-only" htmlFor={`erg-${k.kurseinheitId}`}>
                      Ergebnis<span className="sr-only"> {k.fach}</span>
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
                  </div>
                  {/* Am Handy Punkte und Note nebeneinander, ab sm eigene Spalten. */}
                  <div className="grid grid-cols-2 gap-3 sm:contents">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground sm:sr-only" htmlFor={`pkt-${k.kurseinheitId}`}>
                        Punkte<span className="sr-only"> {k.fach}</span>
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
                        className={`${feldKlasse} disabled:opacity-50`}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground sm:sr-only" htmlFor={`note-${k.kurseinheitId}`}>
                        Note<span className="sr-only"> {k.fach}</span>
                      </label>
                      <input
                        id={`note-${k.kurseinheitId}`}
                        type="text"
                        maxLength={NOTE_MAX_LAENGE}
                        value={jetzt.note}
                        onChange={(e) => setzen(k, { note: e.target.value })}
                        disabled={jetzt.ergebnis === ""}
                        placeholder="z. B. gut"
                        className={`${feldKlasse} disabled:opacity-50`}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <MeldungsBox meldung={meldung} className="mt-3 break-words" />
        </div>
      </Blatt>
    </>
  );
}
