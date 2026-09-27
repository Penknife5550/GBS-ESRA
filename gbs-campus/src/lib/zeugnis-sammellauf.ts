/**
 * GBS Campus — Zeugnis-Sammellauf: DB-freie Regeln
 *
 * Reine Funktionen ohne Datenbank; importiert werden nur Typen und die
 * abhängigkeitsfreien Konstanten aus constants.ts, damit
 * Server-Seite, API-Route UND Client-Komponente sie nutzen können, ohne zod oder
 * Prisma ins Browser-Bundle zu ziehen — und damit `scripts/pruefe-zeugnis.ts` sie
 * ohne Postgres gegenprüft:
 *
 * - die Sperre des Sammellaufs für Abschlusszeugnisse außerhalb des letzten
 *   Rastersemesters (sonst bekämen auch Erstsemester ein Abschlusszeugnis),
 * - die Zahlen und der Text der Rückfrage vor dem Sammellauf (auch: wer noch gar
 *   keine Bewertung hat, wer beim Abschluss weniger Semester als das Raster hat),
 * - die Meldung nach dem Lauf, die Fehlschläge NICHT als Erfolg ausgibt,
 * - die Sperre der (Neu-)Ausstellung für anonymisierte Personen und Personen in
 *   einem Endzustand.
 */

import { KURSRASTER, type StatusCode } from "@/lib/constants";
import type { GewaehlterTyp, Zeugnistypwert } from "@/lib/zeugnis";

// -----------------------------------------------------------------------------
// Sperre: Abschlusszeugnisse gesammelt nur im letzten Semester des Rasters
// -----------------------------------------------------------------------------

/** Das letzte Semester des dreijährigen Kursrasters: 3. Lehrjahr, Frühling
 * (Raster aus constants.ts). */
export const LETZTES_LEHRJAHR = KURSRASTER.LEHRJAHRE;
export const LETZTES_HALBJAHR = KURSRASTER.HALBJAHRE;

/** Semester einer vollständigen Ausbildung im Raster: drei Lehrjahre zu je zwei
 * Halbjahren (Herbst, Frühling). */
export const RASTER_SEMESTER = LETZTES_LEHRJAHR * LETZTES_HALBJAHR;

export const ABSCHLUSS_SAMMELLAUF_GESPERRT =
  "Abschlusszeugnisse lassen sich gesammelt nur im letzten Semester der Ausbildung (3. Lehrjahr, Frühling) ausstellen. " +
  "Einzelne Abschlusszeugnisse lassen sich weiterhin je Teilnehmer über „Ausstellen“ erzeugen.";

/** Sperrtext für ein Semester ohne Platz im Kursraster: Der allgemeine Text („nur
 * im letzten Semester“) führte hier in die Irre — die Sperre lässt sich erst nach
 * der Zuordnung in der Semesterverwaltung aufheben. */
export const ABSCHLUSS_SAMMELLAUF_UNVERORTET =
  "Dieses Semester ist keinem Lehrjahr und Halbjahr des Kursrasters zugeordnet — deshalb lassen sich hier keine " +
  "Abschlusszeugnisse gesammelt ausstellen. Ist es das letzte Semester der Ausbildung (3. Lehrjahr, Frühling), " +
  "bitte zuerst unter Verwaltung → Semester Lehrjahr und Halbjahr eintragen. " +
  "Einzelne Abschlusszeugnisse lassen sich weiterhin je Teilnehmer über „Ausstellen“ erzeugen.";

/** Ob das Semester das letzte des Rasters ist. Ein nicht verortetes Semester
 * (lehrjahr/halbjahr leer) ist es nie. */
export function istLetztesRasterSemester(semester: { lehrjahr: number | null; halbjahr: number | null }): boolean {
  return semester.lehrjahr === LETZTES_LEHRJAHR && semester.halbjahr === LETZTES_HALBJAHR;
}

/** Null = der Sammellauf ist erlaubt, sonst die deutsche Begründung der Sperre.
 * Nur der Sammellauf für Abschlusszeugnisse ist begrenzt; die Einzel-Ausstellung
 * bleibt davon unberührt. Ein nicht verortetes Semester bekommt einen eigenen
 * Text mit dem Weg zur Zuordnung. */
export function sammellaufSperre(
  gewaehlt: GewaehlterTyp,
  semester: { lehrjahr: number | null; halbjahr: number | null },
): string | null {
  if (gewaehlt !== "ABSCHLUSS") return null;
  if (istLetztesRasterSemester(semester)) return null;
  if (semester.lehrjahr === null || semester.halbjahr === null) return ABSCHLUSS_SAMMELLAUF_UNVERORTET;
  return ABSCHLUSS_SAMMELLAUF_GESPERRT;
}

// -----------------------------------------------------------------------------
// Sperre je Person: keine (Neu-)Ausstellung nach Anonymisierung oder im Endzustand
// -----------------------------------------------------------------------------

/** Als Typ gebunden, damit ein umbenannter Status-Code hier nicht still
 * vorbeiläuft (die Datei bleibt ohne Laufzeit-Importe). */
const ANONYMISIERT: StatusCode = "ANONYMISIERT";

/**
 * Null = für diese Person darf ein Zeugnis (neu) ausgestellt werden, sonst die
 * deutsche Begründung. Gesperrt sind anonymisierte Personen — eine
 * Neuausstellung schriebe den überschriebenen Platzhalternamen in ein neues,
 * gültiges Dokument und stornierte das bisherige — und jeder Endzustand
 * (`istTerminal`): Aus ihm führt kein regulärer Weg zurück, also auch keine
 * neue Ausfertigung. Absolventen sind kein Endzustand (Fachentscheidung), sie
 * bekommen ihr Abschlusszeugnis weiterhin.
 */
export function zeugnisSperreFuerPerson(status: { code: string; bezeichnung: string; istTerminal: boolean }): string | null {
  if (status.code === ANONYMISIERT) {
    return "Diese Person ist anonymisiert. Für sie wird kein Zeugnis mehr ausgestellt.";
  }
  if (status.istTerminal) {
    return `Diese Person ist im Endzustand „${status.bezeichnung}“. Für sie wird kein Zeugnis mehr ausgestellt.`;
  }
  return null;
}

// -----------------------------------------------------------------------------
// Vorschau + Rückfrage
// -----------------------------------------------------------------------------

/** Wie viele der erwarteten Fächer (Kurseinheit-Ids) noch keine Bewertung haben.
 * Doppelte Einträge zählen einmal; Bewertungen außerhalb der Erwartung ziehen
 * nichts ab. */
export function zaehleOffeneFaecher(erwartet: Iterable<string>, bewertet: Iterable<string>): number {
  const vorhanden = new Set(bewertet);
  let offen = 0;
  for (const id of new Set(erwartet)) {
    if (!vorhanden.has(id)) offen++;
  }
  return offen;
}

export type VorschauZeile = {
  typ: Zeugnistypwert;
  ausgestellt: boolean;
  offeneFaecher: number;
  /** Erfasste Bewertungen, die ins Zeugnis kämen (Semester: dieses Semester,
   * Abschluss: alle zählenden Schüler-Semester). */
  bewertet: number;
  /** Zählende Schüler-Semester, die in die Berechnung eingehen — beim Abschluss
   * die Semester der „Gesamten Ausbildung“. */
  schuelerSemester: number;
};

export type SammelVorschau = {
  /** Neu entstehende Zeugnisse des gewählten Typs (Schüler). */
  zeugnisse: number;
  /** Neu entstehende Teilnahmebescheinigungen (Hörer). */
  bescheinigungen: number;
  /** Bereits gültig vorhanden — der Sammellauf lässt sie unverändert. */
  vorhanden: number;
  /** Auszustellende Schüler mit mindestens einem unbewerteten Fach. */
  mitOffenenFaechern: number;
  /** Auszustellende Schüler ganz ohne Bewertung — ihr Zeugnis enthielte keine
   * Fächer (auch: ein Semester ohne Unterrichtsabende mit Fach). */
  ohneBewertung: number;
  /** Auszustellende Abschlusszeugnisse mit weniger Schüler-Semestern als das
   * Raster (z. B. Quereinsteiger) — „Gesamte Ausbildung“ wäre dann unvollständig. */
  wenigerSemesterAlsRaster: number;
};

export function baueSammelVorschau(zeilen: VorschauZeile[]): SammelVorschau {
  const vorschau: SammelVorschau = {
    zeugnisse: 0,
    bescheinigungen: 0,
    vorhanden: 0,
    mitOffenenFaechern: 0,
    ohneBewertung: 0,
    wenigerSemesterAlsRaster: 0,
  };
  for (const z of zeilen) {
    if (z.ausgestellt) {
      vorschau.vorhanden++;
    } else if (z.typ === "BESCHEINIGUNG") {
      // Hörer: keine Prüfungspflicht — unbewertete Fächer sind hier kein Mangel.
      vorschau.bescheinigungen++;
    } else {
      vorschau.zeugnisse++;
      if (z.offeneFaecher > 0) vorschau.mitOffenenFaechern++;
      if (z.bewertet === 0) vorschau.ohneBewertung++;
      if (z.typ === "ABSCHLUSS" && z.schuelerSemester < RASTER_SEMESTER) vorschau.wenigerSemesterAlsRaster++;
    }
  }
  return vorschau;
}

const MENGENWORT: Record<Zeugnistypwert, [string, string]> = {
  SEMESTER: ["Semester-Zeugnis", "Semester-Zeugnisse"],
  ABSCHLUSS: ["Abschlusszeugnis", "Abschlusszeugnisse"],
  BESCHEINIGUNG: ["Teilnahmebescheinigung (Hörer)", "Teilnahmebescheinigungen (Hörer)"],
};

function menge(anzahl: number, typ: Zeugnistypwert): string {
  const [eins, viele] = MENGENWORT[typ];
  return `${anzahl} ${anzahl === 1 ? eins : viele}`;
}

/** Der Text der Rückfrage vor „Alle ausstellen“ — mit den konkreten Zahlen. */
export function sammellaufRueckfrage(vorschau: SammelVorschau, gewaehlt: GewaehlterTyp, semesterBezeichnung: string): string {
  const teile: string[] = [];
  if (vorschau.zeugnisse > 0) teile.push(menge(vorschau.zeugnisse, gewaehlt));
  if (vorschau.bescheinigungen > 0) teile.push(menge(vorschau.bescheinigungen, "BESCHEINIGUNG"));
  if (teile.length === 0) return `Für ${semesterBezeichnung} ist nichts mehr auszustellen.`;

  const absaetze = [`${teile.join(" und ")} für ${semesterBezeichnung} ausstellen?`];
  if (vorschau.mitOffenenFaechern > 0) {
    const n = vorschau.mitOffenenFaechern;
    absaetze.push(`${n} ${n === 1 ? "Teilnehmer hat" : "Teilnehmer haben"} noch unbewertete Fächer — diese Fächer fehlen dann im Zeugnis.`);
  }
  if (vorschau.ohneBewertung > 0) {
    const n = vorschau.ohneBewertung;
    absaetze.push(
      `${n} ${n === 1 ? "Teilnehmer hat" : "Teilnehmer haben"} noch überhaupt keine Bewertung — ` +
        `${n === 1 ? "sein Zeugnis enthält" : "ihre Zeugnisse enthalten"} dann keine Fächer.`,
    );
  }
  if (vorschau.wenigerSemesterAlsRaster > 0) {
    const n = vorschau.wenigerSemesterAlsRaster;
    absaetze.push(
      `${n} ${n === 1 ? "Teilnehmer war" : "Teilnehmer waren"} in weniger als ${RASTER_SEMESTER} Semestern als Schüler ` +
        `eingeschrieben (z. B. Quereinstieg) — das Abschlusszeugnis „Gesamte Ausbildung“ enthält dann nur diese Semester.`,
    );
  }
  if (vorschau.vorhanden > 0) {
    const n = vorschau.vorhanden;
    absaetze.push(
      `${n} ${n === 1 ? "Teilnehmer hat" : "Teilnehmer haben"} schon ein gültiges Dokument — ${n === 1 ? "es bleibt" : "sie bleiben"} unverändert.`,
    );
  }
  absaetze.push(
    "Ausgestellte Zeugnisse sind sofort für die Schüler sichtbar. Eine Ausstellung lässt sich nicht zurücknehmen, nur über „Neu ausstellen“ korrigieren.",
  );
  return absaetze.join("\n\n");
}

// -----------------------------------------------------------------------------
// Ergebnis des Laufs
// -----------------------------------------------------------------------------

/** Ergebnis des Sammellaufs. „vorhanden“ und „fehlgeschlagen“ sind bewusst
 * getrennt: ein Fehlschlag darf nie als „bereits vorhanden“ erscheinen. */
export type SammellaufErgebnis = { ausgestellt: number; vorhanden: number; fehlgeschlagen: number; gesamt: number };

function zeugnisWort(n: number): string {
  return n === 1 ? "Zeugnis" : "Zeugnisse";
}

/** Die Meldung nach dem Lauf. Sobald etwas fehlgeschlagen ist, ist es eine
 * Fehlermeldung — auch wenn ein Teil ausgestellt wurde. */
export function sammellaufMeldung(e: SammellaufErgebnis): { art: "ok" | "fehler"; text: string } {
  if (e.fehlgeschlagen > 0) {
    const n = e.fehlgeschlagen;
    return {
      art: "fehler",
      text:
        `${n} ${zeugnisWort(n)} ${n === 1 ? "konnte" : "konnten"} nicht ausgestellt werden` +
        (e.ausgestellt > 0 ? ` (${e.ausgestellt} ausgestellt)` : "") +
        ". Bitte „Alle ausstellen“ noch einmal starten — bereits ausgestellte werden dabei nicht doppelt erzeugt.",
    };
  }
  if (e.gesamt === 0) {
    return { art: "fehler", text: "Für dieses Semester sind keine aktiven Teilnehmer eingetragen." };
  }
  if (e.ausgestellt === 0) {
    return { art: "ok", text: "Alle Zeugnisse waren bereits ausgestellt." };
  }
  return {
    art: "ok",
    text: `${e.ausgestellt} ${zeugnisWort(e.ausgestellt)} ausgestellt${e.vorhanden > 0 ? `, ${e.vorhanden} bereits vorhanden` : ""}.`,
  };
}
