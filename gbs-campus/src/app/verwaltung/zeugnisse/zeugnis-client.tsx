"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { sammellaufMeldung, type SammellaufErgebnis } from "@/lib/zeugnis-sammellauf";

type Zeugnis = { id: string; belegNr: string; version: number; ausgestelltAm: string };
type Zeile = { personId: string; name: string; teilnahmeformText: string; typLabel: string; zeugnis: Zeugnis | null };
/** Vom Server ermittelt: Rückfragetext mit konkreten Zahlen, Sperrgrund (oder
 * null) und wie viele Dokumente der Lauf neu ausstellen würde. */
type Sammellauf = { rueckfrage: string; sperre: string | null; auszustellen: number };

const selectKlasse = "min-h-11 rounded-lg border border-input bg-background px-3 py-1.5 text-sm";
const knopfKlasse =
  "min-h-11 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60";
const nebenKlasse =
  "min-h-11 inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-sm hover:border-primary disabled:opacity-60";

const TYP_OPTIONEN = [
  { wert: "SEMESTER", label: "Semester-Zeugnis" },
  { wert: "ABSCHLUSS", label: "Abschlusszeugnis" },
] as const;

export function ZeugnisClient({
  semesters,
  gewaehltId,
  typ,
  zeilen,
  sammellauf,
}: {
  semesters: { id: string; bezeichnung: string }[];
  gewaehltId: string;
  typ: string;
  zeilen: Zeile[];
  sammellauf: Sammellauf;
}) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [einzeln, setEinzeln] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<{ art: "ok" | "fehler"; text: string } | null>(null);
  // Die Auswahl im Formular — gewechselt wird erst mit „Anzeigen“ (GET-Formular,
  // WCAG 3.2.2). Solange sie vom angezeigten Stand abweicht, bleibt „Alle
  // ausstellen“ aus: Der Knopf wirkt auf das ANGEZEIGTE Semester, nicht auf das
  // gerade in der Liste gewählte.
  const [auswahl, setAuswahl] = useState({ semester: gewaehltId, typ });
  const auswahlAngezeigt = auswahl.semester === gewaehltId && auswahl.typ === typ;

  async function alleAusstellen() {
    // Der Sammellauf erzeugt offizielle, sofort sichtbare Dokumente, die sich nicht
    // zurücknehmen lassen — deshalb die Rückfrage mit den Zahlen vom Server.
    if (!window.confirm(sammellauf.rueckfrage)) return;
    setLaeuft(true);
    setMeldung(null);
    const antwort = await sendeAnfrage<SammellaufErgebnis>("/api/zeugnisse/ausstellen", {
      methode: "POST",
      rumpf: { semesterId: gewaehltId, typ },
    });
    setLaeuft(false);
    if (!antwort.ok) return setMeldung({ art: "fehler", text: antwort.meldung });
    setMeldung(sammellaufMeldung(antwort.daten));
    router.refresh();
  }

  async function ausstellen(zeile: Zeile, neu: boolean) {
    if (
      neu &&
      !window.confirm(
        `Das Zeugnis ${zeile.zeugnis?.belegNr ?? ""} von ${zeile.name} wird storniert und durch eine neue Ausfertigung ersetzt. Frühere Ausdrucke werden damit ungültig. Fortfahren?`,
      )
    ) {
      return;
    }
    setEinzeln(zeile.personId);
    setMeldung(null);
    const antwort = await sendeAnfrage<{ belegNr: string; version: number }>("/api/zeugnisse/ausstellen", {
      methode: "POST",
      rumpf: { semesterId: gewaehltId, typ, personId: zeile.personId },
    });
    setEinzeln(null);
    if (!antwort.ok) return setMeldung({ art: "fehler", text: antwort.meldung });
    setMeldung({ art: "ok", text: `Zeugnis ${antwort.daten.belegNr} ausgestellt (Ausfertigung ${antwort.daten.version}).` });
    router.refresh();
  }

  const hatZeugnisse = zeilen.some((z) => z.zeugnis);
  const seriendruckHref = `/api/zeugnisse/seriendruck?semester=${gewaehltId}&typ=${typ}`;
  // Auswahl noch nicht angezeigt, gesperrt (Abschluss außerhalb des letzten
  // Rastersemesters) oder nichts mehr offen: der Knopf ist aus, der Grund steht
  // darunter.
  const sammelHinweis = !auswahlAngezeigt
    ? "Die geänderte Auswahl ist noch nicht angezeigt — bitte zuerst „Anzeigen“ wählen."
    : sammellauf.sperre ??
      (zeilen.length > 0 && sammellauf.auszustellen === 0 ? "Für alle Teilnehmer ist bereits ein Dokument ausgestellt." : null);
  const sammelAus = !auswahlAngezeigt || sammellauf.sperre !== null || sammellauf.auszustellen === 0;

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-end gap-4">
        {/* Ein GET-Formular wie die Personenliste: Die Auswahl steht in der
            Adresszeile, die Seite wechselt erst mit „Anzeigen“ — nicht schon beim
            Durchblättern der Liste (WCAG 3.2.2). */}
        <form method="get" action="/verwaltung/zeugnisse" className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="zeugnis-semester" className="block text-sm font-medium">
              Semester
            </label>
            <select
              id="zeugnis-semester"
              name="semester"
              value={auswahl.semester}
              onChange={(e) => setAuswahl({ ...auswahl, semester: e.target.value })}
              className={`mt-1.5 ${selectKlasse}`}
            >
              {semesters.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.bezeichnung}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="zeugnis-typ" className="block text-sm font-medium">
              Art
            </label>
            <select
              id="zeugnis-typ"
              name="typ"
              value={auswahl.typ}
              onChange={(e) => setAuswahl({ ...auswahl, typ: e.target.value })}
              className={`mt-1.5 ${selectKlasse}`}
            >
              {TYP_OPTIONEN.map((o) => (
                <option key={o.wert} value={o.wert}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={nebenKlasse}>
            Anzeigen
          </button>
        </form>
        <button
          type="button"
          onClick={alleAusstellen}
          disabled={laeuft || sammelAus}
          aria-describedby={sammelHinweis ? "zeugnis-sammel-hinweis" : undefined}
          className={knopfKlasse}
        >
          {laeuft ? "Moment …" : "Alle ausstellen"}
        </button>
        {/* Der Seriendruck-Link erscheint erst, wenn es etwas zu drucken gibt — sonst
            führte der reine Link (kein fetch) auf eine rohe JSON-404-Seite. */}
        {hatZeugnisse && (
          <a href={seriendruckHref} className={nebenKlasse}>
            Seriendruck (PDF)
          </a>
        )}
      </div>
      {sammelHinweis && (
        <p id="zeugnis-sammel-hinweis" className="mt-3 max-w-prose text-sm text-muted-foreground">
          {sammelHinweis}
        </p>
      )}

      {/* Live-Region dauerhaft im DOM (sr-only wenn leer), damit Screenreader die
          Meldung zuverlässig ankündigen. */}
      <p
        role={meldung?.art === "fehler" ? "alert" : "status"}
        className={
          meldung
            ? `mt-4 rounded-lg px-3 py-2 text-sm ${meldung.art === "ok" ? "bg-credo-gruen/10" : "bg-credo-rot/10"}`
            : "sr-only"
        }
      >
        {meldung?.text ?? ""}
      </p>

      <h2 className="mt-6 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Teilnehmer</h2>
      {zeilen.length === 0 ? (
        <p className="mt-3 rounded-lg border border-border bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
          Für dieses Semester sind keine aktiven Teilnehmer eingetragen.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {zeilen.map((z) => (
            <li key={z.personId} className="rounded-lg border border-border bg-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-sm font-medium">{z.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {z.teilnahmeformText} · {z.typLabel}
                  </span>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {z.zeugnis
                      ? `Beleg-Nr. ${z.zeugnis.belegNr} · Ausfertigung ${z.zeugnis.version} · ${z.zeugnis.ausgestelltAm}`
                      : "noch nicht ausgestellt"}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {z.zeugnis ? (
                    <>
                      <a
                        href={`/api/zeugnisse/${z.zeugnis.id}/pdf`}
                        aria-label={`${z.typLabel} von ${z.name} als PDF herunterladen`}
                        className={nebenKlasse}
                      >
                        PDF
                      </a>
                      <button
                        type="button"
                        onClick={() => ausstellen(z, true)}
                        disabled={einzeln === z.personId}
                        aria-label={`${z.typLabel} von ${z.name} neu ausstellen (altes storniert)`}
                        className={nebenKlasse}
                      >
                        {einzeln === z.personId ? "Moment …" : "Neu ausstellen"}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => ausstellen(z, false)}
                      disabled={einzeln === z.personId}
                      aria-label={`${z.typLabel} für ${z.name} ausstellen`}
                      className={knopfKlasse}
                    >
                      {einzeln === z.personId ? "Moment …" : "Ausstellen"}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
