/**
 * GBS Campus — Datenauskunft nach Art. 15 DSGVO: reine Inhaltslogik
 *
 * Bewusst getrennt von `auskunft.ts` (Datenbank, Token, PDF-Erzeugung): Dieses
 * Modul importiert zur Laufzeit nichts aus der Datenbank — nur so lässt es sich
 * per Pruefskript ohne DB und mutationssicher testen (Projektregel 2). Der
 * FeldTyp wird nur als Typ importiert (zur Laufzeit entfernt).
 */

import type { FeldTyp } from "@prisma/client";
import type { PdfBlock } from "@/lib/pdf";

export type AntwortZeile = { label: string; wert: string; istArt9: boolean };
export type FeldInfo = { code: string; label: string; typ: FeldTyp; istArt9: boolean };

/** Formatiert einen gespeicherten Antwortwert je nach Feldtyp lesbar. */
export function formatiereWert(typ: FeldTyp, roh: unknown): string {
  if (roh === null || roh === undefined || roh === "") return "(leer)";
  if (typ === "JA_NEIN") {
    if (typeof roh === "boolean") return roh ? "Ja" : "Nein";
    return roh === "true" ? "Ja" : roh === "false" ? "Nein" : String(roh);
  }
  if (typ === "AUSWAHL_MEHRFACH" && Array.isArray(roh)) {
    return roh.length ? roh.map((e) => String(e)).join(", ") : "(leer)";
  }
  if (Array.isArray(roh)) return roh.map((e) => String(e)).join(", ");
  if (typeof roh === "object") return JSON.stringify(roh);
  return String(roh);
}

/**
 * Ordnet die gespeicherten Antworten den Feldern ihrer Formularfassung zu —
 * in der Reihenfolge des Formulars, mit Label und Art.-9-Kennzeichen. Felder
 * ohne Antwort werden uebersprungen, reine Hinweisfelder ebenso. Antworten zu
 * Codes, die es in der Fassung nicht (mehr) gibt, gehen NICHT verloren: Sie
 * werden am Ende mit ihrem rohen Code ausgewiesen — eine Auskunft soll den
 * gespeicherten Bestand zeigen, nicht nur, was das aktuelle Formular kennt.
 */
export function mappeAntworten(antworten: Record<string, unknown>, felder: FeldInfo[]): AntwortZeile[] {
  const zeilen: AntwortZeile[] = [];
  const gesehen = new Set<string>();

  for (const feld of felder) {
    if (feld.typ === "HINWEIS") continue;
    if (!(feld.code in antworten)) continue;
    gesehen.add(feld.code);
    zeilen.push({
      label: feld.label,
      wert: formatiereWert(feld.typ, antworten[feld.code]),
      istArt9: feld.istArt9,
    });
  }

  for (const [code, wert] of Object.entries(antworten)) {
    if (gesehen.has(code)) continue;
    zeilen.push({ label: `(${code})`, wert: formatiereWert("TEXT", wert), istArt9: false });
  }

  return zeilen;
}

// Die Datums-Formatierer liegen neutral in `@/lib/datum` (kein Fachmodul soll an
// einem anderen hängen). Hier re-exportiert, damit bestehende Importeure dieses
// Moduls (auskunft.ts) unverändert bleiben.
export { datum, datumZeit } from "@/lib/datum";
import { datum, datumZeit } from "@/lib/datum";

export function teilnahmeformText(f: string | null | undefined): string {
  if (f === "SCHUELER") return "Schüler (mit Prüfung und Zeugnis)";
  if (f === "HOERER") return "Hörer (ohne Prüfungspflicht, ohne Zeugnis)";
  return "—";
}

/**
 * Freundliches Label für den Bearbeitungsstand einer Anmeldung. Die PDF liest
 * ein Laie — ein roher Enum („EINGEREICHT") wirkt technisch und unfertig, und
 * der Rest der Auskunft übersetzt Status/Teilnahmeform ebenfalls in Klartext.
 */
export function anmeldungsstatusText(status: string): string {
  switch (status) {
    case "ENTWURF":
      return "Entwurf (noch nicht abgesendet)";
    case "EINGEREICHT":
      return "Eingereicht, wartet auf Entscheidung";
    case "ANGENOMMEN":
      return "Angenommen";
    case "ABGELEHNT":
      return "Abgelehnt";
    default:
      return status;
  }
}

export type AuskunftDaten = {
  erstelltAm: Date;
  stammdaten: { label: string; wert: string }[];
  rollen: string[];
  ehepartner: string | null;
  ermaessigung: string | null;
  internerVermerkVorhanden: boolean;
  anmeldungen: {
    semester: string | null;
    status: string;
    eingereichtAm: Date | null;
    entschiedenAm: Date | null;
    teilnahmeform: string | null;
    antworten: AntwortZeile[];
  }[];
  einwilligungen: {
    titel: string;
    version: number;
    istArt9: boolean;
    erteilt: boolean;
    zeitpunkt: Date;
    ipAdresse: string | null;
  }[];
  statusWechsel: { von: string | null; nach: string; grund: string | null; automatisch: boolean; zeitpunkt: Date }[];
  teilnahmen: { semester: string; teilnahmeform: string; bestaetigtAm: Date | null }[];
};

const ART9_HINWEIS = " (besondere Kategorie nach Art. 9 DSGVO)";

/** Baut aus den gesammelten Daten die PDF-Bausteine. Rein, ohne Datenbank. */
export function baueAuskunftBloecke(daten: AuskunftDaten): PdfBlock[] {
  const b: PdfBlock[] = [];

  b.push({ art: "titel", text: "Datenauskunft nach Art. 15 DSGVO" });
  b.push({ art: "klein", text: `Erstellt am ${datumZeit(daten.erstelltAm)} · Gemeindebibelschule Minden · Christliches Werk Esra e.V.` });
  b.push({
    art: "absatz",
    text:
      "Diese Auskunft enthält die zu Ihrer Person gespeicherten Daten sowie die nach Art. 15 Abs. 1 " +
      "DSGVO vorgeschriebenen Begleitangaben. Sie wurde auf Anforderung der Schulverwaltung erstellt und " +
      "über einen persönlichen, kurzlebigen Link ausschließlich Ihnen zum Abruf bereitgestellt.",
  });

  b.push({ art: "h2", text: "1. Stammdaten" });
  for (const s of daten.stammdaten) b.push({ art: "kv", label: s.label, wert: s.wert });
  b.push({ art: "kv", label: "Rollen im Portal", wert: daten.rollen.length ? daten.rollen.join(", ") : "—" });
  if (daten.ehepartner) b.push({ art: "kv", label: "Ehepartner-Kopplung", wert: daten.ehepartner });
  if (daten.ermaessigung) b.push({ art: "kv", label: "Ermäßigung", wert: daten.ermaessigung });
  b.push({
    art: "klein",
    text: daten.internerVermerkVorhanden
      ? "Zu Ihrem Datensatz besteht ein interner Freitext-Vermerk der Verwaltung. Er wird nach " +
        "Einzelprüfung (Schutz von Angaben über Dritte) gesondert herausgegeben."
      : "Ein interner Freitext-Vermerk der Verwaltung besteht zu Ihrem Datensatz nicht.",
  });

  b.push({ art: "h2", text: "2. Anmeldungen und Formularantworten" });
  if (daten.anmeldungen.length === 0) {
    b.push({ art: "absatz", text: "Zu Ihrer Person ist keine Anmeldung gespeichert." });
  }
  daten.anmeldungen.forEach((a, i) => {
    if (i > 0) b.push({ art: "leer" });
    b.push({ art: "kv", label: "Anmeldung", wert: `${i + 1} von ${daten.anmeldungen.length}` });
    b.push({ art: "kv", label: "Semester", wert: a.semester ?? "—" });
    b.push({ art: "kv", label: "Bearbeitungsstand", wert: anmeldungsstatusText(a.status) });
    b.push({ art: "kv", label: "Eingereicht am", wert: datumZeit(a.eingereichtAm) });
    b.push({ art: "kv", label: "Entschieden am", wert: datumZeit(a.entschiedenAm) });
    b.push({ art: "kv", label: "Teilnahmeform", wert: teilnahmeformText(a.teilnahmeform) });
    for (const z of a.antworten) {
      b.push({ art: "kv", label: z.label + (z.istArt9 ? ART9_HINWEIS : ""), wert: z.wert });
    }
  });

  b.push({ art: "h2", text: "3. Einwilligungen" });
  if (daten.einwilligungen.length === 0) {
    b.push({ art: "absatz", text: "Es ist keine Einwilligung gespeichert." });
  }
  for (const e of daten.einwilligungen) {
    b.push({
      art: "kv",
      label: e.titel + (e.istArt9 ? ART9_HINWEIS : ""),
      wert: `${e.erteilt ? "erteilt" : "widerrufen"} am ${datumZeit(e.zeitpunkt)} (Fassung ${e.version}${e.ipAdresse ? ", IP " + e.ipAdresse : ""})`,
    });
  }

  b.push({ art: "h2", text: "4. Statusverlauf" });
  if (daten.statusWechsel.length === 0) {
    b.push({ art: "absatz", text: "Es ist kein Statuswechsel gespeichert." });
  }
  for (const s of daten.statusWechsel) {
    b.push({
      art: "kv",
      label: datumZeit(s.zeitpunkt),
      wert: `${s.von ?? "(neu)"} → ${s.nach}${s.grund ? " · " + s.grund : ""}${s.automatisch ? " · automatisch" : ""}`,
    });
  }

  b.push({ art: "h2", text: "5. Teilnahmen" });
  if (daten.teilnahmen.length === 0) {
    b.push({ art: "absatz", text: "Es ist keine Semesterteilnahme gespeichert." });
  }
  for (const t of daten.teilnahmen) {
    b.push({
      art: "kv",
      label: t.semester,
      wert: `${t.teilnahmeform}${t.bestaetigtAm ? " · bestätigt am " + datum(t.bestaetigtAm) : ""}`,
    });
  }

  for (const block of BEGLEITANGABEN) b.push(block);

  return b;
}

/**
 * Die vorgeschriebenen Begleitangaben nach Art. 15 Abs. 1 lit. a–h. Bewusst als
 * fester Text im Code (nicht in der Datenbank) — er beschreibt die Verarbeitung
 * dieser Software und aendert sich nur mit ihr. Bei einer spaeteren Anpassung
 * (weitere Empfaenger ab Release 0.3, Optigem) hier nachziehen.
 */
const BEGLEITANGABEN: PdfBlock[] = [
  { art: "h2", text: "6. Angaben nach Art. 15 Abs. 1 DSGVO" },
  {
    art: "kv",
    label: "Verantwortlicher",
    wert: "Christliches Werk Esra e.V. (Träger der Gemeindebibelschule Minden). Fragen zum Datenschutz richten Sie bitte an die Schulverwaltung.",
  },
  {
    art: "kv",
    label: "Zwecke der Verarbeitung",
    wert: "Anmeldung, Aufnahme und Verwaltung der Teilnahme an der Gemeindebibelschule, Kommunikation mit den Teilnehmern und Verwaltung des Semesterbeitrags.",
  },
  {
    art: "kv",
    label: "Kategorien personenbezogener Daten",
    wert: "Stammdaten, Kontaktdaten, Bankverbindung, Angaben zu Glaube und Gemeindezugehörigkeit (Art. 9), Anmeldeangaben, Einwilligungen und Verwaltungsverlauf — wie oben aufgeführt.",
  },
  {
    art: "kv",
    label: "Empfänger",
    wert: "Schulleitung und Verwaltung der Gemeindebibelschule sowie der beauftragte technische Dienstleister für den Betrieb (Auftragsverarbeiter). Eine Weitergabe darüber hinaus findet nicht statt.",
  },
  {
    art: "kv",
    label: "Speicherdauer",
    wert: "Die Daten werden für die Dauer der Teilnahme und darüber hinaus so lange gespeichert, wie es gesetzliche Aufbewahrungspflichten oder die Nachweispflicht für erteilte Einwilligungen erfordern.",
  },
  {
    art: "kv",
    label: "Ihre Rechte",
    wert: "Sie haben das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) sowie auf Widerspruch (Art. 21). Eine erteilte Einwilligung können Sie jederzeit mit Wirkung für die Zukunft widerrufen.",
  },
  {
    art: "kv",
    label: "Beschwerderecht",
    wert: "Sie können sich bei einer Datenschutz-Aufsichtsbehörde beschweren, in Nordrhein-Westfalen bei der Landesbeauftragten für Datenschutz und Informationsfreiheit NRW.",
  },
  {
    art: "kv",
    label: "Herkunft der Daten",
    wert: "Die Daten stammen aus Ihren eigenen Angaben im Anmeldeformular sowie aus dem Verwaltungsverlauf innerhalb dieser Software.",
  },
  {
    art: "kv",
    label: "Automatisierte Entscheidungen",
    wert: "Eine automatisierte Entscheidungsfindung oder ein Profiling nach Art. 22 DSGVO findet nicht statt.",
  },
  { art: "leer" },
  {
    art: "klein",
    text: "Diese Auskunft wurde maschinell aus dem aktuellen Datenbestand erzeugt. Sollten Angaben unrichtig oder unvollständig sein, wenden Sie sich bitte an die Schulverwaltung.",
  },
];
