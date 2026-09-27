/**
 * GBS Campus — Datenauskunft nach Art. 15 DSGVO: reine Inhaltslogik
 *
 * Bewusst getrennt von `auskunft.ts` (Datenbank, Token, PDF-Erzeugung): Dieses
 * Modul importiert zur Laufzeit nichts aus der Datenbank — nur so lässt es sich
 * per Pruefskript ohne DB und mutationssicher testen (Projektregel 2). Der
 * FeldTyp wird nur als Typ importiert (zur Laufzeit entfernt). Die Klartexte zu
 * Abmeldegrund, Leistungsergebnis, Anwesenheit und Zeugnistyp kommen aus den
 * ebenfalls DB-freien Fachmodulen — dieselben Wörter wie in der Oberfläche.
 */

import type { FeldTyp } from "@prisma/client";
import type { PdfBlock } from "@/lib/pdf";
import { abmeldegrundText } from "@/lib/semester";
import { anmeldestatusName } from "@/lib/anmeldestatus";
import { ergebnisName } from "@/lib/leistung";
import { abendWort, anwesenheitName, terminText } from "@/lib/stundenplan";
import { zeugnisStatusName, zeugnisTitel } from "@/lib/zeugnis";
import { euro } from "@/lib/honorar";

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
import { EINRICHTUNG } from "@/lib/constants";

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
    default:
      // Annahme, Ablehnung und Unbekanntes: derselbe Wortlaut wie in der Verwaltung.
      return anmeldestatusName(status);
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
    /** Ein Ablehnungsgrund (Freitext der Schulleitung) liegt vor — wie der
     * interne Vermerk nur benannt, nicht abgedruckt. */
    ablehnungsgrundVorhanden: boolean;
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
  /**
   * Auch abgemeldete Teilnahmen — sie zählen für das Semester nicht, sind aber
   * gespeichert. `abmeldeGrund` ist der rohe Code (`ABMELDEGRUND`), den Klartext
   * liefert `abmeldegrundText`.
   */
  teilnahmen: {
    semester: string;
    teilnahmeform: string;
    eingeladenAm: Date | null;
    bestaetigtAm: Date | null;
    abgemeldetAm: Date | null;
    abmeldeGrund: string | null;
  }[];
  /** `status` roh (Anwesenheitsstatus); `vermerk`: ein Freitext der Schule liegt vor (wie `internerVermerkVorhanden`). */
  anwesenheiten: { beginn: Date; fach: string | null; status: string; selbstBestaetigt: boolean; vermerk: boolean }[];
  /** `ergebnis` roh (Leistungsergebnis). */
  leistungen: { semester: string; fach: string; titel: string; ergebnis: string; punkte: number | null; note: string | null }[];
  /** `typ` und `status` roh (Zeugnistyp, Zeugnisstatus). Bei STORNIERT der
   * Zeitpunkt; der Grund (Freitext der Schule) wird wie der interne Vermerk nur
   * benannt, nicht abgedruckt. */
  zeugnisse: {
    belegNr: string;
    typ: string;
    status: string;
    version: number;
    semester: string;
    ausgestelltAm: Date;
    dmsGesendetAm: Date | null;
    storniertAm: Date | null;
    stornoGrundVorhanden: boolean;
  }[];
  /** Unterrichtsabende, denen die Person als Dozent zugeordnet ist. */
  unterrichtsabende: { beginn: Date; semester: string; fach: string | null }[];
  honorarAbrechnungen: {
    semester: string;
    statusText: string;
    summe: number;
    belegNr: string | null;
    erstelltAm: Date;
    freigegebenAm: Date | null;
    ausgezahltAm: Date | null;
    /** Übermittlung des Zahlungsbelegs (mit IBAN) an das DMS. */
    dmsGesendetAm: Date | null;
    vermerk: boolean;
    posten: { datum: Date; fach: string | null; betrag: number }[];
  }[];
};

const ART9_HINWEIS = " (besondere Kategorie nach Art. 9 DSGVO)";

/** Ein Freitext der Schule an einem Eintrag — wie der interne Vermerk an der Person nur benannt, nicht abgedruckt. */
const VERMERK_HINWEIS = "mit Freitext-Vermerk der Schule (wird nach Einzelprüfung gesondert herausgegeben)";

/**
 * Eine Teilnahme als Zeile: Form, Rückmeldung zur Semesterüberleitung und —
 * wenn abgemeldet — Datum und Grund. Eine abgemeldete Teilnahme darf nicht wie
 * eine gewöhnliche aussehen.
 */
export function teilnahmeText(t: AuskunftDaten["teilnahmen"][number]): string {
  const teile = [t.teilnahmeform];
  if (t.eingeladenAm) teile.push(`zur Rückmeldung eingeladen am ${datum(t.eingeladenAm)}`);
  if (t.bestaetigtAm) teile.push(`bestätigt am ${datum(t.bestaetigtAm)}`);
  if (t.abgemeldetAm) teile.push(`abgemeldet am ${datum(t.abgemeldetAm)}, Grund: ${abmeldegrundText(t.abmeldeGrund)}`);
  return teile.join(" · ");
}

/** Eine erfasste Anwesenheit als Zeile — mit der Angabe, ob die Person sie selbst bestätigt hat. */
export function anwesenheitText(a: AuskunftDaten["anwesenheiten"][number]): string {
  const teile = [anwesenheitName(a.status)];
  if (a.fach) teile.push(a.fach);
  teile.push(a.selbstBestaetigt ? "von Ihnen selbst bestätigt" : "von der Schule erfasst");
  if (a.vermerk) teile.push(VERMERK_HINWEIS);
  return teile.join(" · ");
}

/** Eine Bewertung als Zeile: Titel der Kurseinheit, Ergebnis, optionale Punkte und Note. */
export function leistungText(l: AuskunftDaten["leistungen"][number]): string {
  return (
    `${l.titel}: ${ergebnisName(l.ergebnis)}` +
    (l.punkte != null ? ` · ${l.punkte} Punkte` : "") +
    (l.note ? ` · Note ${l.note}` : "")
  );
}

/**
 * Ein Zeugnis als Zeile: Typ, Semester, Datum, Fassung/Stand (gültig, ersetzt
 * oder storniert — der Storno mit Datum, sein Grund nur benannt) und die
 * Übermittlung an das DMS. Den eingefrorenen Inhalt (Name, Geburtsdatum,
 * Ergebnisse im Stand der Ausstellung) benennt der Hinweis unter dem Abschnitt.
 */
export function zeugnisText(z: AuskunftDaten["zeugnisse"][number]): string {
  const stand =
    z.status === "ERSETZT"
      ? `Fassung ${z.version}, durch eine Neuausstellung ersetzt`
      : z.status === "STORNIERT"
        ? `Fassung ${z.version}, ${zeugnisStatusName(z.status)} am ${datum(z.storniertAm)} und damit ungültig` +
          (z.stornoGrundVorhanden ? ` · ${VERMERK_HINWEIS}` : "")
        : `Fassung ${z.version}, ${zeugnisStatusName(z.status)}`;
  return (
    `${zeugnisTitel(z.typ)} · ${z.semester} · ausgestellt am ${datum(z.ausgestelltAm)} · ${stand}` +
    (z.dmsGesendetAm ? ` · an das Dokumentenarchiv (DMS) übermittelt am ${datum(z.dmsGesendetAm)}` : "")
  );
}

/** Baut aus den gesammelten Daten die PDF-Bausteine. Rein, ohne Datenbank. */
export function baueAuskunftBloecke(daten: AuskunftDaten): PdfBlock[] {
  const b: PdfBlock[] = [];

  b.push({ art: "titel", text: "Datenauskunft nach Art. 15 DSGVO" });
  b.push({ art: "klein", text: `Erstellt am ${datumZeit(daten.erstelltAm)} · ${EINRICHTUNG.name} · ${EINRICHTUNG.traeger}` });
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
    if (a.ablehnungsgrundVorhanden) b.push({ art: "kv", label: "Ablehnungsgrund", wert: VERMERK_HINWEIS });
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
    b.push({ art: "kv", label: t.semester, wert: teilnahmeText(t) });
  }
  if (daten.teilnahmen.some((t) => t.abgemeldetAm)) {
    b.push({
      art: "klein",
      text:
        "Eine abgemeldete Teilnahme zählt für ihr Semester nicht: Sie steht in keiner Liste dieses Semesters, " +
        "und es werden dafür keine Anwesenheit, keine Noten und kein Zeugnis erfasst.",
    });
  }

  b.push({ art: "h2", text: "6. Anwesenheit" });
  if (daten.anwesenheiten.length === 0) {
    b.push({ art: "absatz", text: "Es ist keine Anwesenheit gespeichert." });
  }
  for (const a of daten.anwesenheiten) {
    b.push({ art: "kv", label: terminText(a.beginn), wert: anwesenheitText(a) });
  }

  b.push({ art: "h2", text: "7. Leistungen und Noten" });
  if (daten.leistungen.length === 0) {
    b.push({ art: "absatz", text: "Es ist keine Bewertung gespeichert." });
  }
  for (const l of daten.leistungen) {
    b.push({ art: "kv", label: `${l.semester} · ${l.fach}`, wert: leistungText(l) });
  }

  b.push({ art: "h2", text: "8. Zeugnisse und Bescheinigungen" });
  if (daten.zeugnisse.length === 0) {
    b.push({ art: "absatz", text: "Es ist kein Zeugnis und keine Bescheinigung gespeichert." });
  }
  for (const z of daten.zeugnisse) {
    b.push({ art: "kv", label: `Beleg-Nr. ${z.belegNr}`, wert: zeugnisText(z) });
  }
  if (daten.zeugnisse.length > 0) {
    b.push({
      art: "klein",
      text:
        "Ein Zeugnis hält Name, Geburtsdatum und die Ergebnisse im Stand der Ausstellung fest. Eine Kopie gültiger " +
        "Zeugnisse und Bescheinigungen erhalten Sie auf Anfrage bei der Schulverwaltung; solange Ihr Portalzugang " +
        "besteht, auch als PDF unter „Meine Daten“." +
        (daten.zeugnisse.some((z) => z.status === "STORNIERT")
          ? " Ein storniertes Dokument wurde ohne Ersatz zurückgezogen und ist ungültig; es bleibt nur als Nachweis gespeichert."
          : ""),
    });
  }

  b.push({ art: "h2", text: "9. Unterricht als Dozent und Honorarabrechnungen" });
  if (daten.unterrichtsabende.length === 0) {
    b.push({ art: "absatz", text: "Sie sind keinem Unterrichtsabend als Dozent zugeordnet." });
  }
  for (const u of daten.unterrichtsabende) {
    b.push({ art: "kv", label: terminText(u.beginn), wert: `${u.semester}${u.fach ? " · " + u.fach : ""}` });
  }
  if (daten.honorarAbrechnungen.length === 0) {
    b.push({ art: "absatz", text: "Es ist keine Honorarabrechnung gespeichert." });
  }
  for (const h of daten.honorarAbrechnungen) {
    b.push({ art: "leer" });
    b.push({ art: "kv", label: "Honorarabrechnung", wert: h.semester });
    b.push({ art: "kv", label: "Stand", wert: h.statusText });
    if (h.belegNr) b.push({ art: "kv", label: "Beleg-Nr.", wert: h.belegNr });
    b.push({ art: "kv", label: "Erstellt am", wert: datumZeit(h.erstelltAm) });
    if (h.freigegebenAm) b.push({ art: "kv", label: "Freigegeben am", wert: datumZeit(h.freigegebenAm) });
    if (h.ausgezahltAm) b.push({ art: "kv", label: "Ausgezahlt am", wert: datum(h.ausgezahltAm) });
    if (h.dmsGesendetAm) {
      b.push({ art: "kv", label: "An das Dokumentenarchiv (DMS) übermittelt am", wert: datum(h.dmsGesendetAm) });
    }
    if (h.vermerk) b.push({ art: "kv", label: "Vermerk", wert: VERMERK_HINWEIS });
    for (const p of h.posten) {
      b.push({ art: "kv", label: `${datum(p.datum)}${p.fach ? " · " + p.fach : ""}`, wert: euro(p.betrag) });
    }
    b.push({ art: "kv", label: `Summe (${h.posten.length} ${abendWort(h.posten.length)})`, wert: euro(h.summe) });
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
  { art: "h2", text: "10. Angaben nach Art. 15 Abs. 1 DSGVO" },
  {
    art: "kv",
    label: "Verantwortlicher",
    wert: `${EINRICHTUNG.traeger} (Träger der ${EINRICHTUNG.name}). Fragen zum Datenschutz richten Sie bitte an die Schulverwaltung.`,
  },
  {
    art: "kv",
    label: "Zwecke der Verarbeitung",
    wert: "Anmeldung, Aufnahme und Verwaltung der Teilnahme an der Gemeindebibelschule, Anwesenheit, Leistungsnachweise und Zeugnisse, Kommunikation mit den Teilnehmern, Verwaltung des Semesterbeitrags sowie Einsatzplanung und Honorarabrechnung der Dozenten.",
  },
  {
    art: "kv",
    label: "Kategorien personenbezogener Daten",
    wert: "Stammdaten, Kontaktdaten, Bankverbindung, Angaben zu Glaube und Gemeindezugehörigkeit (Art. 9), Anmeldeangaben, Einwilligungen, Verwaltungsverlauf, Teilnahmen, Anwesenheit, Leistungen und Zeugnisse sowie bei Dozenten Unterrichtsabende und Honorarabrechnungen — wie oben aufgeführt.",
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
    wert: "Die Daten stammen aus Ihren eigenen Angaben (Anmeldeformular, Selbstpflege im Portal, selbst bestätigte Anwesenheit) sowie aus der Erfassung durch Schulleitung, Verwaltung und Dozenten innerhalb dieser Software.",
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
