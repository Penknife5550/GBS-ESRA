"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";

type Zeugnis = { id: string; belegNr: string; version: number; ausgestelltAm: string };
type Zeile = { personId: string; name: string; teilnahmeformText: string; typLabel: string; zeugnis: Zeugnis | null };

const selectKlasse = "min-h-11 rounded-lg border border-input bg-background px-3 py-1.5 text-sm";
const knopfKlasse =
  "min-h-11 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60";
const nebenKlasse =
  "min-h-11 inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-sm hover:border-primary disabled:opacity-60";

const TYP_OPTIONEN = [
  { wert: "SEMESTER", label: "Semester-Zeugnis" },
  { wert: "ABSCHLUSS", label: "Abschlusszeugnis" },
] as const;

function zeugnisWort(n: number): string {
  return n === 1 ? "Zeugnis" : "Zeugnisse";
}

export function ZeugnisClient({
  semesters,
  gewaehltId,
  typ,
  zeilen,
}: {
  semesters: { id: string; bezeichnung: string }[];
  gewaehltId: string;
  typ: string;
  zeilen: Zeile[];
}) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [einzeln, setEinzeln] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<{ art: "ok" | "fehler"; text: string } | null>(null);

  function wechsle(semester: string, neuerTyp: string) {
    router.push(`/verwaltung/zeugnisse?semester=${semester}&typ=${neuerTyp}`);
  }

  async function alleAusstellen() {
    setLaeuft(true);
    setMeldung(null);
    const antwort = await sendeAnfrage<{ ausgestellt: number; uebersprungen: number; gesamt: number }>(
      "/api/zeugnisse/ausstellen",
      { methode: "POST", rumpf: { semesterId: gewaehltId, typ } },
    );
    setLaeuft(false);
    if (!antwort.ok) return setMeldung({ art: "fehler", text: antwort.meldung });
    const { ausgestellt, uebersprungen } = antwort.daten;
    setMeldung({
      art: "ok",
      text:
        ausgestellt === 0
          ? "Alle Zeugnisse waren bereits ausgestellt."
          : `${ausgestellt} ${zeugnisWort(ausgestellt)} ausgestellt${uebersprungen > 0 ? `, ${uebersprungen} bereits vorhanden` : ""}.`,
    });
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

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="zeugnis-semester" className="block text-sm font-medium">
            Semester
          </label>
          <select
            id="zeugnis-semester"
            value={gewaehltId}
            onChange={(e) => wechsle(e.target.value, typ)}
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
            value={typ}
            onChange={(e) => wechsle(gewaehltId, e.target.value)}
            className={`mt-1.5 ${selectKlasse}`}
          >
            {TYP_OPTIONEN.map((o) => (
              <option key={o.wert} value={o.wert}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <button type="button" onClick={alleAusstellen} disabled={laeuft} className={knopfKlasse}>
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
