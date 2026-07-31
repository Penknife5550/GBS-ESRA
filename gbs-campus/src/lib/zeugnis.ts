/**
 * GBS Campus — Zeugnisse & Bescheinigungen: DB-freie Kernlogik
 *
 * Reine Funktionen ohne Datenbank, damit `scripts/pruefe-zeugnis.ts` sie ohne
 * Postgres gegenprüfen kann: die Typ-Wahl (Hörer bekommen eine Bescheinigung,
 * Schüler ein Zeugnis), die Beleg-Nummer und der eingefrorene Snapshot der
 * gedruckten Daten.
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

export const ZEUGNISTYP = {
  SEMESTER: "SEMESTER",
  ABSCHLUSS: "ABSCHLUSS",
  BESCHEINIGUNG: "BESCHEINIGUNG",
} as const;
export type Zeugnistypwert = (typeof ZEUGNISTYP)[keyof typeof ZEUGNISTYP];

/** Ausstellungsort auf allen Dokumenten. */
export const ZEUGNIS_ORT = "Minden";

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

/** Beleg-Nummern-Präfix: Bescheinigung „BESCH", sonst „ZEU". */
export function belegNrPraefix(typ: string): string {
  return typ === "BESCHEINIGUNG" ? "BESCH" : "ZEU";
}

/**
 * Beleg-Nummer, z. B. „ZEU-2026-07-30-1A2B3C4D". Der Zufallsteil wird
 * hereingereicht (der IO-Teil gibt `randomUUID().slice(0, 8)`), damit die
 * Formatregel DB-frei prüfbar bleibt.
 */
export function neueBelegNr(typ: string, am: Date, zufall: string): string {
  return `${belegNrPraefix(typ)}-${am.toISOString().slice(0, 10)}-${zufall.toUpperCase()}`;
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
