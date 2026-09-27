/**
 * GBS Campus — Zeugnisse & Bescheinigungen: DB-freie Kernlogik
 *
 * Reine Funktionen ohne Datenbank, damit `scripts/pruefe-zeugnis.ts` sie ohne
 * Postgres gegenprüfen kann: die Typ-Wahl (Hörer bekommen eine Bescheinigung,
 * Schüler ein Zeugnis), die Fächer der Hörer-Bescheinigung (nur besuchte), die
 * Beleg-Nummer, der eingefrorene Snapshot der gedruckten Daten und die Regeln
 * des Stornos ohne Ersatz (Grund, Status-Klartext, Download-Sperre).
 *
 * Der Snapshot wird beim Ausstellen festgeschrieben und trägt bereits die
 * Klartexte (z. B. „bestanden") — so bleibt ein ausgestelltes Zeugnis auch dann
 * unverändert, wenn sich später Noten, Namen oder gar die Formatierungslogik
 * ändern. Bewusst KEINE besonderen Daten im Snapshot: keine IBAN und keine
 * Art.-9-Angaben (insbesondere NICHT die Gemeindezugehörigkeit — sie ist eine
 * besondere Kategorie nach Art. 9 DSGVO und gehört nicht in ein eingefrorenes,
 * von der Anonymisierung nicht mehr erreichbares Dokument).
 */

import { ergebnisName } from "@/lib/leistung";
import { belegNummer } from "@/lib/beleg-nr";
import { EINRICHTUNG } from "@/lib/constants";
import { zaehltAlsTeilgenommen } from "@/lib/stundenplan";

export const ZEUGNISTYP = {
  SEMESTER: "SEMESTER",
  ABSCHLUSS: "ABSCHLUSS",
  BESCHEINIGUNG: "BESCHEINIGUNG",
} as const;
export type Zeugnistypwert = (typeof ZEUGNISTYP)[keyof typeof ZEUGNISTYP];

/** Ausstellungsort auf allen Dokumenten. */
export const ZEUGNIS_ORT = EINRICHTUNG.ort;

/** Version des Snapshot-Formats — mitgeschrieben, damit sich Altbestände bei
 * künftigen Erweiterungen erkennen lassen. */
export const SNAPSHOT_VERSION = 1;

/** Der von der Schulleitung gewählte Typ eines Serien-/Einzeldrucks. */
export const GEWAEHLTE_TYPEN = ["SEMESTER", "ABSCHLUSS"] as const;
export type GewaehlterTyp = (typeof GEWAEHLTE_TYPEN)[number];

export function istGewaehlterTyp(wert: string): wert is GewaehlterTyp {
  return (GEWAEHLTE_TYPEN as readonly string[]).includes(wert);
}

/**
 * Welchen Zeugnistyp eine Teilnahme bekommt: Ein **Hörer** bekommt immer eine
 * Teilnahmebescheinigung (kein Zeugnis, keine Prüfungspflicht — Domänen-Regel),
 * ein **Schüler** den von der Schulleitung gewählten Typ (Semester bzw. Abschluss).
 */
export function zeugnistypFuer(teilnahmeform: string, gewaehlt: GewaehlterTyp): Zeugnistypwert {
  return teilnahmeform === "HOERER" ? "BESCHEINIGUNG" : gewaehlt;
}

/** Überschrift des Dokuments je Typ. */
export function zeugnisTitel(typ: string): string {
  switch (typ) {
    case "SEMESTER":
      return "Zeugnis";
    case "ABSCHLUSS":
      return "Abschlusszeugnis";
    case "BESCHEINIGUNG":
      return "Teilnahmebescheinigung";
    default:
      return "Zeugnis";
  }
}

/** Klartext des Zeugnisstatus — dieselben Wörter in Detailakte, Zeugnisseite
 * und Datenauskunft. */
export function zeugnisStatusName(status: string): string {
  switch (status) {
    case "GUELTIG":
      return "gültig";
    case "ERSETZT":
      return "ersetzt";
    case "STORNIERT":
      return "storniert";
    default:
      return "unbekannt";
  }
}

/** Beleg-Nummern-Präfix: Bescheinigung „BESCH", sonst „ZEU". */
export function belegNrPraefix(typ: string): string {
  return typ === "BESCHEINIGUNG" ? "BESCH" : "ZEU";
}

/**
 * Beleg-Nummer, z. B. „ZEU-2026-07-30-1A2B3C4D", mit dem Berliner Kalendertag
 * der Ausstellung — wie das Ausstellungsdatum im Snapshot (`datum()`). Der
 * Zufallsteil wird hereingereicht (der IO-Teil gibt `randomUUID().slice(0, 8)`),
 * damit die Formatregel DB-frei prüfbar bleibt; die Regel selbst steht für alle
 * Belege in `beleg-nr.ts`.
 */
export function neueBelegNr(typ: string, am: Date, zufall: string): string {
  return belegNummer(belegNrPraefix(typ), am, zufall);
}

/** Eine Fach-Zeile, wie sie der IO-Teil in den Snapshot hereinreicht (ohne den
 * abgeleiteten Klartext — den setzt `baueZeugnisSnapshot`). */
export type ZeugnisLeistungEingabe = {
  fach: string;
  titel: string;
  ergebnis: string;
  punkte: number | null;
  note: string | null;
};

/** Eine Fach-Zeile im fertigen Snapshot (mit eingefrorenem Klartext). */
export type ZeugnisLeistung = ZeugnisLeistungEingabe & { ergebnisText: string };

// -----------------------------------------------------------------------------
// Teilnahmebescheinigung (Hörer): nur besuchte Fächer
// -----------------------------------------------------------------------------

/** Ein erfasster Abend der Person im Semester, wie ihn der IO-Teil hereinreicht:
 * der Anwesenheitsstatus und die Kurseinheit des Termins (null = Abend ohne Fach). */
export type ErfassterAbend = {
  status: string;
  kurseinheit: { id: string; titel: string; sortierung: number; fach: string } | null;
};

/**
 * Die Fächer der Teilnahmebescheinigung eines Hörers: jede Kurseinheit, an deren
 * Terminen die Person im Semester mindestens einmal teilgenommen hat — anwesend
 * oder nachgearbeitet (`zaehltAlsTeilgenommen`, wie die Anwesenheitsquote) —,
 * einmal und als „teilgenommen". Bewusst KEINE Quote: Ein besuchter Abend genügt
 * (Fachentscheidung, die Schulleitung will Hörer nicht kontrollieren). Entschuldigt,
 * gefehlt und Abende ohne Fach zählen nicht. Sortiert wie die Leistungen eines
 * Zeugnisses (Kurseinheit, dann Fach).
 */
export function bescheinigungsFaecher(abende: readonly ErfassterAbend[]): ZeugnisLeistungEingabe[] {
  const besucht = new Map<string, { titel: string; sortierung: number; fach: string }>();
  for (const abend of abende) {
    if (!abend.kurseinheit || !zaehltAlsTeilgenommen(abend.status)) continue;
    if (!besucht.has(abend.kurseinheit.id)) besucht.set(abend.kurseinheit.id, abend.kurseinheit);
  }
  return [...besucht.values()]
    .sort((a, b) => a.sortierung - b.sortierung || a.fach.localeCompare(b.fach, "de"))
    .map((k) => ({ fach: k.fach, titel: k.titel, ergebnis: "TEILGENOMMEN", punkte: null, note: null }));
}

/** Keine Bescheinigung ohne besuchten Abend: Ein Hörer, für den keine Fächer
 * zusammenkommen (`bescheinigungsFaecher` leer), bekommt kein Dokument — die
 * Einzel-Ausstellung lehnt ab (409), der Sammellauf überspringt ihn und zählt ihn
 * als „ohne Anwesenheit". Zeugnisse der Schüler betrifft das nicht. */
export function ohneBesuchtenAbend(typ: string, faecher: readonly unknown[]): boolean {
  return typ === "BESCHEINIGUNG" && faecher.length === 0;
}

export const MELDUNG_OHNE_ANWESENHEIT =
  "Für diese Person ist in diesem Semester kein besuchter Abend in einem Fach erfasst (anwesend oder nachgearbeitet). " +
  "Ohne einen solchen Abend wird keine Teilnahmebescheinigung ausgestellt. " +
  "Hat die Person teilgenommen, tragen Sie bitte zuerst ihre Anwesenheit ein.";

/** Der eingefrorene Zustand eines Zeugnisses — genau das, was gedruckt wird. */
export type ZeugnisSnapshot = {
  snapshotVersion: number;
  belegNr: string;
  typ: Zeugnistypwert;
  titel: string;
  version: number;
  /** Beleg-Nr des ersetzten Zeugnisses (Storno-Vermerk), sonst null. */
  ersetztBelegNr: string | null;
  person: { name: string; geburtsdatum: string | null };
  /** „Herbstsemester 2026" bzw. „Gesamte Ausbildung". */
  abschnitt: string;
  leistungen: ZeugnisLeistung[];
  ausgestelltAm: string;
  ausgestelltVon: string | null;
  ort: string;
};

export type SnapshotEingabe = {
  belegNr: string;
  typ: Zeugnistypwert;
  version: number;
  ersetztBelegNr: string | null;
  personName: string;
  geburtsdatum: string | null;
  abschnitt: string;
  leistungen: ZeugnisLeistungEingabe[];
  ausgestelltAm: string;
  ausgestelltVon: string | null;
  ort: string;
};

/**
 * Baut den einzufrierenden Snapshot. Reine Funktion: der IO-Teil reicht bereits
 * aufgelöste Primitive herein (Name, formatierte Daten, Leistungen), hier wird
 * nur zusammengesetzt und der Ergebnis-Klartext festgeschrieben.
 */
export function baueZeugnisSnapshot(e: SnapshotEingabe): ZeugnisSnapshot {
  return {
    snapshotVersion: SNAPSHOT_VERSION,
    belegNr: e.belegNr,
    typ: e.typ,
    titel: zeugnisTitel(e.typ),
    version: e.version,
    ersetztBelegNr: e.ersetztBelegNr,
    person: { name: e.personName, geburtsdatum: e.geburtsdatum },
    abschnitt: e.abschnitt,
    leistungen: e.leistungen.map((l) => ({
      fach: l.fach,
      titel: l.titel,
      ergebnis: l.ergebnis,
      ergebnisText: ergebnisName(l.ergebnis),
      punkte: l.punkte,
      note: l.note,
    })),
    ausgestelltAm: e.ausgestelltAm,
    ausgestelltVon: e.ausgestelltVon,
    ort: e.ort,
  };
}

// -----------------------------------------------------------------------------
// Storno ohne Ersatz (Status STORNIERT)
// -----------------------------------------------------------------------------

/** Höchstlänge des Storno-Grundes (nach dem Trimmen). */
export const STORNO_GRUND_MAX_LAENGE = 500;

export type StornoGrundErgebnis = { ok: true; grund: string } | { ok: false; meldung: string };

/**
 * Der Grund eines Stornos ist Pflicht: getrimmt nicht leer, höchstens
 * `STORNO_GRUND_MAX_LAENGE` Zeichen. Er ist Freitext der Schulleitung und kann
 * Personenbezug tragen — er steht nur am Zeugnis (dort erfasst ihn die
 * Anonymisierung), nie im Audit-Log, im PDF oder im Storno-Vermerk an das DMS.
 */
export function pruefeStornoGrund(eingabe: string | null | undefined): StornoGrundErgebnis {
  const grund = typeof eingabe === "string" ? eingabe.trim() : "";
  if (grund.length === 0) return { ok: false, meldung: "Bitte geben Sie einen Grund für den Storno an." };
  if (grund.length > STORNO_GRUND_MAX_LAENGE) {
    return { ok: false, meldung: `Der Grund ist zu lang (höchstens ${STORNO_GRUND_MAX_LAENGE} Zeichen).` };
  }
  return { ok: true, grund };
}

/** Die Rückfrage vor dem Storno — mit Artikel je Typ, damit auch die
 * Teilnahmebescheinigung richtig benannt ist. */
export function stornoRueckfrage(e: { typ: string; belegNr: string; name: string }): string {
  const [bezeichnung, pronomen] =
    e.typ === "BESCHEINIGUNG"
      ? ["Die Teilnahmebescheinigung", "Sie"]
      : e.typ === "ABSCHLUSS"
        ? ["Das Abschlusszeugnis", "Es"]
        : ["Das Zeugnis", "Es"];
  return (
    `${bezeichnung} ${e.belegNr} von ${e.name} wird ungültig und für die Person nicht mehr abrufbar. ` +
    `${pronomen} bleibt als Nachweis gespeichert. Eine neue Ausstellung ist danach nur einzeln über „Ausstellen“ möglich. Fortfahren?`
  );
}

/** Warum die Person selbst ein nicht (mehr) gültiges Dokument nicht mehr
 * herunterladen darf (410). Die Schulleitung bekommt es als Nachweis — mit
 * Vermerk (`zeugnis-beleg.ts`). */
export function ungueltigMeldung(status: string): string {
  if (status === "STORNIERT") {
    return "Dieses Zeugnis wurde storniert und ist nicht mehr gültig. Bei Fragen wenden Sie sich bitte an die Schulverwaltung.";
  }
  return "Dieses Zeugnis wurde durch eine neue Ausfertigung ersetzt und ist nicht mehr gültig. Die gültige Ausfertigung steht unter „Meine Daten“.";
}

/** Dateiname des Einzeldrucks — ein nicht gültiges Dokument trägt seinen Stand
 * im Namen, damit ein Nachdruck nie wie das Original abgelegt wird. */
export function zeugnisDateiname(belegNr: string, status: string): string {
  if (status === "GUELTIG") return `${belegNr}.pdf`;
  if (status === "STORNIERT") return `${belegNr}-STORNIERT.pdf`;
  return `${belegNr}-UNGUELTIG.pdf`;
}
