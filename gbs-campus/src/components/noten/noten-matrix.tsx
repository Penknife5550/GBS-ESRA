"use client";

import { startTransition, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { kurzTitel } from "@/lib/abendplan";
import {
  ERGEBNIS_OPTIONEN,
  NOTE_MAX_LAENGE,
  PUNKTE_MAX,
  PUNKTE_MIN,
  punkteGueltig,
  type LeistungWert,
} from "@/lib/leistung";
import { Blatt } from "@/components/ui/blatt";
import { LeererZustand } from "@/components/ui/hinweis";
import { knopf } from "@/components/ui/knopf";
import { MeldungsBox, type Meldung } from "@/components/ui/meldung";
import { StatusPunkt } from "@/components/ui/status-punkt";

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

const feldKlasse = "h-11 rounded-lg border border-input bg-background px-3 text-sm lg:h-9";

type Zeile = { ergebnis: string; punkte: string; note: string };

/**
 * Noten je Kurseinheit, geteilt von Dozent (`/api/dozent/note`) und
 * Schulleitung (`/api/noten`) — dieselbe Rumpfform { kurseinheitId, semesterId,
 * eintraege }. Oberflächenplan 09/2026: je Kurseinheit eine Zeile mit dem Stand
 * („3 von 15 bewertet“) und „Noten eintragen“; die Matrix öffnet sich im Blatt.
 *
 * Overlay-Muster wie beim Stundenplan des Dozenten: die Anzeige nimmt den
 * gespeicherten Stand und legt die ungespeicherten Änderungen darüber. Schließen
 * verwirft den Entwurf nicht (die Zeile zeigt „ungespeichert“); nach dem Speichern
 * wird das Overlay der Kurseinheit geleert und der Server-Stand neu geladen.
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
  const [laeuft, setLaeuft] = useState(false);
  // Fehler bleiben im Blatt (die Eingaben stehen noch), Erfolg steht über der Liste.
  const [fehler, setFehler] = useState<Meldung | null>(null);
  const [meldung, setMeldung] = useState<Meldung | null>(null);

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

  // Hat diese Kurseinheit ungespeicherte Änderungen? Schließen verwirft den
  // Entwurf nicht — ein Seitenwechsel schon; deshalb wird der Zustand an der
  // Zeile sichtbar markiert, und vor dem Verlassen fragt die Seite nach (unten).
  function istGeaendert(k: Kurseinheit): boolean {
    const beruehrt = entwurf[k.kurseinheitId];
    if (!beruehrt) return false;
    return Object.entries(beruehrt).some(([teilnahmeId, z]) => {
      const g = gespeicherteZeile(k, teilnahmeId);
      return z.ergebnis !== g.ergebnis || z.punkte !== g.punkte || z.note !== g.note;
    });
  }

  // Ungespeicherte Noten nicht still verwerfen: Neuladen und Schließen fragen
  // über `beforeunload` nach. Ein Link innerhalb der App (Semesterwahl, Umschalter,
  // Leiste) löst das Ereignis nicht aus — dafür fängt ein Klick-Wächter ihn ab und
  // fragt selbst, bevor die Seite wechselt.
  const hatUngespeichertes = kurseinheiten.some((k) => istGeaendert(k));
  useEffect(() => {
    if (!hatUngespeichertes) return;
    function warnen(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Ältere Browser zeigen die Rückfrage nur mit gesetztem returnValue.
      e.returnValue = "";
    }
    function linkWaechter(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank" || link.hasAttribute("download")) return;
      const ziel = new URL(link.href, window.location.href);
      if (ziel.origin !== window.location.origin || ziel.pathname + ziel.search === window.location.pathname + window.location.search) {
        return;
      }
      if (window.confirm("Es gibt ungespeicherte Noten. Seite trotzdem verlassen? Die Eingaben gehen dabei verloren.")) return;
      e.preventDefault();
      e.stopPropagation();
    }
    window.addEventListener("beforeunload", warnen);
    document.addEventListener("click", linkWaechter, true);
    return () => {
      window.removeEventListener("beforeunload", warnen);
      document.removeEventListener("click", linkWaechter, true);
    };
  }, [hatUngespeichertes]);

  const aktuell = kurseinheiten.find((k) => k.kurseinheitId === offen) ?? null;

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

    if (punkteFehler) return setFehler({ art: "fehler", text: punkteFehler });
    if (eintraege.length === 0) return setFehler({ art: "fehler", text: "Es gibt keine Bewertung zum Speichern." });

    setLaeuft(true);
    setFehler(null);
    const antwort = await sendeAnfrage<{ gesetzt: number }>(endpunkt, {
      methode: "POST",
      rumpf: { kurseinheitId: k.kurseinheitId, semesterId, eintraege },
    });
    setLaeuft(false);
    if (!antwort.ok) return setFehler({ art: "fehler", text: antwort.meldung });
    const n = antwort.daten.gesetzt;
    setMeldung({ art: "ok", text: `${k.fach}: Noten gespeichert (${n} ${n === 1 ? "Eintrag" : "Einträge"}).` });
    setOffen(null);
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
      <LeererZustand icon="abschluss" titel="Noch keine Fächer mit Unterricht">
        Für dieses Semester sind noch keine Fächer mit Unterrichtsabenden zugeordnet — erst dann lassen sich Noten
        erfassen.
      </LeererZustand>
    );
  }

  return (
    <>
      <MeldungsBox meldung={meldung} className="mb-4" />
      <ul className="divide-y divide-linie overflow-hidden rounded-xl border border-linie bg-card">
        {kurseinheiten.map((k) => {
          const bewertet = k.teilnehmer.filter((t) => k.leistungen[t.teilnahmeId]?.ergebnis).length;
          const gesamt = k.teilnehmer.length;
          return (
            <li key={k.kurseinheitId} className="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1 basis-48">
                <p className="text-sm font-semibold text-foreground">{k.fach}</p>
                {kurzTitel(k.fach, k.titel) && (
                  <p className="truncate text-[13px] text-muted-foreground">{kurzTitel(k.fach, k.titel)}</p>
                )}
              </div>
              {istGeaendert(k) && (
                <span className="inline-flex rounded-full bg-credo-gelb/25 px-2.5 py-0.5 text-xs font-medium text-foreground">
                  ungespeichert
                </span>
              )}
              <StatusPunkt ton={gesamt === 0 ? "grau" : bewertet === gesamt ? "gruen" : "gelb"} className="sm:w-40">
                {gesamt === 0 ? "keine Schüler" : `${bewertet} von ${gesamt} bewertet`}
              </StatusPunkt>
              <button
                type="button"
                onClick={() => {
                  setFehler(null);
                  setMeldung(null);
                  setOffen(k.kurseinheitId);
                }}
                aria-haspopup="dialog"
                aria-label={`Noten für ${k.fach} eintragen`}
                className={knopf("sekundaer", "klein")}
              >
                Noten eintragen
              </button>
            </li>
          );
        })}
      </ul>

      <Blatt
        breit
        offen={aktuell !== null}
        onSchliessen={() => setOffen(null)}
        titel={aktuell ? `Noten · ${aktuell.fach}` : "Noten"}
        fuss={
          aktuell && aktuell.teilnehmer.length > 0 ? (
            <>
              <button type="button" onClick={() => setOffen(null)} className={knopf("sekundaer")}>
                Schließen
              </button>
              <button type="button" onClick={() => speichern(aktuell)} disabled={laeuft} className={knopf("primaer")}>
                {laeuft ? "Wird gespeichert …" : "Noten speichern"}
              </button>
            </>
          ) : undefined
        }
      >
        {aktuell &&
          (aktuell.teilnehmer.length === 0 ? (
            <p className="text-sm text-muted-foreground">Für dieses Semester sind keine aktiven Teilnehmer eingetragen.</p>
          ) : (
            <>
              <p className="mb-3 text-[13px] text-muted-foreground">
                {`${aktuell.titel} · ${aktuell.teilnehmer.length} Schüler (Hörer werden nicht benotet). Pflicht ist nur das Ergebnis, Punkte und Note sind freiwillig (nur wo benotet wird, z. B. Bibelkunde). Gespeichert werden nur bewertete Zeilen.`}
              </p>
              <ul className="divide-y divide-linie overflow-hidden rounded-xl border border-linie">
                {aktuell.teilnehmer.map((t) => {
                  const z = angezeigteZeile(aktuell, t.teilnahmeId);
                  return (
                    <li
                      key={t.teilnahmeId}
                      className="grid grid-cols-2 items-center gap-x-2 gap-y-1.5 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_200px_96px_110px]"
                    >
                      <span className="col-span-2 truncate text-sm sm:col-span-1">{t.name}</span>
                      <select
                        aria-label={`Ergebnis von ${t.name}`}
                        value={z.ergebnis}
                        onChange={(e) => setFeld(aktuell, t.teilnahmeId, "ergebnis", e.target.value)}
                        className={`col-span-2 min-w-0 sm:col-span-1 ${feldKlasse}`}
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
                        aria-label={`Punkte von ${t.name} (freiwillig)`}
                        value={z.punkte}
                        onChange={(e) => setFeld(aktuell, t.teilnahmeId, "punkte", e.target.value)}
                        className={`min-w-0 ${feldKlasse}`}
                      />
                      <input
                        type="text"
                        maxLength={NOTE_MAX_LAENGE}
                        placeholder="Note"
                        aria-label={`Note von ${t.name} (freiwillig)`}
                        value={z.note}
                        onChange={(e) => setFeld(aktuell, t.teilnahmeId, "note", e.target.value)}
                        className={`min-w-0 ${feldKlasse}`}
                      />
                    </li>
                  );
                })}
              </ul>
              <MeldungsBox meldung={fehler} className="mt-3" />
            </>
          ))}
      </Blatt>
    </>
  );
}
