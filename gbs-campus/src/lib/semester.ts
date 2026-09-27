/**
 * GBS Campus — Semesterlogik
 *
 * Hier steht alles, was ohne Datenbank entscheidbar ist: Datumsprüfung, die
 * Plausibilität eines Semesters und die Frage, für welches Semester eine
 * eingehende Anmeldung gilt. Das ist Absicht — so lässt es sich in
 * `scripts/pruefe-semesterlogik.ts` ohne laufenden Postgres gegenprüfen.
 *
 * Zwei Fallen, die diese Datei bewusst umgeht:
 *
 *  1. **Zeitzonen.** Ein Semesterdatum ist ein Kalendertag, kein Zeitpunkt.
 *     `new Date("2026-09-15")` ist UTC-Mitternacht; wer daraus mit
 *     `toLocaleDateString()` in Europe/Berlin zurückrechnet, bekommt im Sommer
 *     denselben Tag, im Winter je nach Rechnerzeitzone auch den 14. Deshalb
 *     wird durchgängig in UTC gerechnet und der „heutige Tag" ausdrücklich aus
 *     der ÖRTLICHEN Kalenderangabe gebildet (Container läuft auf
 *     Europe/Berlin).
 *  2. **Der letzte Tag zählt ganz.** Ein Anmeldeschluss am 01.09. bedeutet: am
 *     01.09. um 23:59 ist die Anmeldung noch offen. Verglichen wird deshalb
 *     Tag gegen Tag, nie Zeitpunkt gegen Mitternacht.
 */

import { ABMELDEGRUND, KURSRASTER, TAG_MS } from "@/lib/constants";
import { alsTagesdatum } from "@/lib/datum";

export type Pruefmeldung = { feld?: string; meldung: string };

/** Höchstlänge eines Semesters. Ein Tippfehler im Jahr fällt damit sofort auf. */
const MAX_DAUER_TAGE = 366 * 2;

/**
 * „JJJJ-MM-TT" → Kalendertag (UTC-Mitternacht) oder null. Liegt in datum.ts
 * (auch das Anmeldeformular nutzt sie); hier weitergereicht, damit bestehende
 * Importe aus `@/lib/semester` gültig bleiben.
 */
export { alsTagesdatum };

/** Kalendertag als „JJJJ-MM-TT" — für Formularfelder vom Typ `date`. */
export function alsTagText(datum: Date | null | undefined): string {
  return datum ? datum.toISOString().slice(0, 10) : "";
}

/**
 * Der heutige Kalendertag als UTC-Mitternacht. Gebildet aus der örtlichen
 * Zeitangabe, damit am 15.09. um 01:00 Berliner Zeit auch der 15.09. gilt und
 * nicht der 14.09.
 */
export function alsHeutigerTag(jetzt: Date): Date {
  return new Date(Date.UTC(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate()));
}

export type SemesterEingabe = {
  code: string;
  bezeichnung: string;
  start: string;
  ende: string;
  anmeldungVon?: string | null;
  anmeldungBis?: string | null;
  /** Verortung im Kursraster: 1-3. Fehlt der Schlüssel (undefined), bleibt ein
   * gespeicherter Wert beim Ändern unberührt; null leert ihn. */
  lehrjahr?: number | null;
  /** 1 = Herbst, 2 = Frühling. Gleiche Regel wie `lehrjahr`. */
  halbjahr?: number | null;
};

/** Das dreijährige Kursraster: Lehrjahr 1-3, je zwei Halbjahre (constants.ts). */
const LEHRJAHR_MAX = KURSRASTER.LEHRJAHRE;
const HALBJAHR_MAX = KURSRASTER.HALBJAHRE;

/** Meldung, wenn beim Ändern ein anderes Kürzel ankommt — siehe `pruefeKuerzelUnveraendert`. */
export const KUERZEL_FEST = "Das Kürzel lässt sich nach dem Anlegen nicht mehr ändern.";

/**
 * Prüft die Eingabe des Semesterformulars. Liefert eine leere Liste, wenn alles
 * stimmt — sonst je Fehler eine Meldung mit Feldbezug.
 *
 * Die Eindeutigkeit des Codes prüft die Datenbank (Unique-Index), nicht diese
 * Funktion: Zwischen einer Abfrage hier und dem Schreiben läge ein Zeitfenster,
 * in dem ein zweiter Vorgang denselben Code anlegt.
 */
export function pruefeSemester(eingabe: SemesterEingabe): Pruefmeldung[] {
  const meldungen: Pruefmeldung[] = [];

  const code = eingabe.code?.trim() ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{1,19}$/.test(code)) {
    meldungen.push({
      feld: "code",
      meldung: "Das Kürzel darf nur Buchstaben, Ziffern und Bindestriche enthalten (2 bis 20 Zeichen), z. B. 2026-H.",
    });
  }

  const bezeichnung = eingabe.bezeichnung?.trim() ?? "";
  if (bezeichnung.length < 2 || bezeichnung.length > 80) {
    meldungen.push({ feld: "bezeichnung", meldung: "Bitte eine Bezeichnung mit 2 bis 80 Zeichen angeben." });
  }

  const start = alsTagesdatum(eingabe.start);
  const ende = alsTagesdatum(eingabe.ende);
  if (!start) meldungen.push({ feld: "start", meldung: "Bitte einen gültigen Semesterbeginn angeben." });
  if (!ende) meldungen.push({ feld: "ende", meldung: "Bitte ein gültiges Semesterende angeben." });

  if (start && ende) {
    if (ende.getTime() <= start.getTime()) {
      meldungen.push({ feld: "ende", meldung: "Das Semester muss nach seinem Beginn enden." });
    } else if (ende.getTime() - start.getTime() > MAX_DAUER_TAGE * TAG_MS) {
      meldungen.push({ feld: "ende", meldung: "Ein Semester dauert höchstens zwei Jahre. Bitte das Jahr prüfen." });
    }
  }

  // Das Anmeldefenster ist freiwillig — aber wenn es angegeben ist, muss es
  // stimmen. Ein Anmeldeschluss nach Semesterende ist immer ein Tippfehler.
  const von = eingabe.anmeldungVon ? alsTagesdatum(eingabe.anmeldungVon) : null;
  const bis = eingabe.anmeldungBis ? alsTagesdatum(eingabe.anmeldungBis) : null;
  if (eingabe.anmeldungVon && !von) {
    meldungen.push({ feld: "anmeldungVon", meldung: "Bitte ein gültiges Datum für den Anmeldebeginn angeben." });
  }
  if (eingabe.anmeldungBis && !bis) {
    meldungen.push({ feld: "anmeldungBis", meldung: "Bitte ein gültiges Datum für den Anmeldeschluss angeben." });
  }
  if (von && bis && bis.getTime() < von.getTime()) {
    meldungen.push({ feld: "anmeldungBis", meldung: "Der Anmeldeschluss darf nicht vor dem Anmeldebeginn liegen." });
  }
  if (bis && ende && bis.getTime() > ende.getTime()) {
    meldungen.push({ feld: "anmeldungBis", meldung: "Der Anmeldeschluss darf nicht nach dem Semesterende liegen." });
  }

  // Die Verortung im Kursraster ist freiwillig (Sondersemester) — aber wenn,
  // dann vollständig: An (lehrjahr, halbjahr) hängen die Fächer des Semesters
  // und die Sperre des Abschluss-Sammellaufs, und ein halber Wert wäre an
  // beiden Stellen lautlos wirkungslos.
  const lehrjahr = eingabe.lehrjahr ?? null;
  const halbjahr = eingabe.halbjahr ?? null;
  if (lehrjahr !== null && !(Number.isInteger(lehrjahr) && lehrjahr >= 1 && lehrjahr <= LEHRJAHR_MAX)) {
    meldungen.push({ feld: "lehrjahr", meldung: "Das Lehrjahr ist 1, 2 oder 3." });
  }
  if (halbjahr !== null && !(Number.isInteger(halbjahr) && halbjahr >= 1 && halbjahr <= HALBJAHR_MAX)) {
    meldungen.push({ feld: "halbjahr", meldung: "Das Halbjahr ist 1 (Herbst) oder 2 (Frühling)." });
  }
  if ((lehrjahr === null) !== (halbjahr === null)) {
    meldungen.push({
      feld: lehrjahr === null ? "lehrjahr" : "halbjahr",
      meldung: "Lehrjahr und Halbjahr bitte beide angeben oder beide leer lassen.",
    });
  }

  return meldungen;
}

/**
 * Das Kürzel ist nach dem Anlegen fest. Es steht in jedem Audit-Eintrag rund um
 * das Semester (Anlage, Export, Überleitung, Erinnerungen), als Blattname in der
 * Excel-Datei und in deren Dateiname — ein umbenanntes Kürzel machte diese
 * Spuren mehrdeutig, sobald ein anderes Semester das alte Kürzel bekommt.
 * Verglichen wird wie beim Speichern: ohne Randleerzeichen, in Großbuchstaben.
 * Null = unverändert.
 */
export function pruefeKuerzelUnveraendert(bisher: string, eingabe: string): Pruefmeldung | null {
  return eingabe.trim().toUpperCase() === bisher.trim().toUpperCase()
    ? null
    : { feld: "code", meldung: KUERZEL_FEST };
}

/** Die geprüften Werte, wie sie in der Datenbank stehen. */
export type SemesterDaten = {
  code: string;
  bezeichnung: string;
  start: Date;
  ende: Date;
  anmeldungVon: Date | null;
  anmeldungBis: Date | null;
  /** Nur vorhanden, wenn die Eingabe den Schlüssel trug — sonst bleibt der
   * gespeicherte Wert beim Ändern stehen (ein älterer Aufrufer ohne diese
   * Felder löscht die Rasterverortung nicht). */
  lehrjahr?: number | null;
  halbjahr?: number | null;
};

/**
 * Formt die Eingabe des Semesterformulars in Datenbankwerte um: Kürzel in
 * Großbuchstaben, Text ohne Randleerzeichen, die vier Datumsangaben als
 * Kalendertage.
 *
 * **Nur nach einem leeren `pruefeSemester` aufrufen.** Die beiden `!` sind
 * genau diese Bedingung: Ein ungültiges Datum ist dort bereits gemeldet worden.
 * Der Block stand vorher wortgleich in `POST /api/semester` und in
 * `PUT /api/semester/[id]` — und eine an nur einer der beiden Stellen
 * nachgezogene Regel wäre lautlos halb wirksam gewesen.
 */
export function semesterDaten(eingabe: SemesterEingabe): SemesterDaten {
  return {
    code: eingabe.code.trim().toUpperCase(),
    bezeichnung: eingabe.bezeichnung.trim(),
    start: alsTagesdatum(eingabe.start)!,
    ende: alsTagesdatum(eingabe.ende)!,
    anmeldungVon: eingabe.anmeldungVon ? alsTagesdatum(eingabe.anmeldungVon) : null,
    anmeldungBis: eingabe.anmeldungBis ? alsTagesdatum(eingabe.anmeldungBis) : null,
    ...(eingabe.lehrjahr !== undefined ? { lehrjahr: eingabe.lehrjahr } : {}),
    ...(eingabe.halbjahr !== undefined ? { halbjahr: eingabe.halbjahr } : {}),
  };
}

// -----------------------------------------------------------------------------
// Welches Semester gilt für eine eingehende Anmeldung?
// -----------------------------------------------------------------------------

export type SemesterKandidat = {
  id: string;
  start: Date;
  anmeldungVon: Date | null;
  anmeldungBis: Date | null;
  istAktuell: boolean;
};

/**
 * Ein Semester ist „offen", wenn ein Anmeldefenster hinterlegt ist und der
 * heutige Tag hineinfällt. Ohne jede Fensterangabe gilt es NICHT als offen —
 * sonst wäre jedes je angelegte Semester dauerhaft offen und die Zuordnung
 * beliebig.
 */
function istFensterOffen(semester: SemesterKandidat, heute: Date): boolean {
  if (!semester.anmeldungVon && !semester.anmeldungBis) return false;
  if (semester.anmeldungVon && heute.getTime() < semester.anmeldungVon.getTime()) return false;
  if (semester.anmeldungBis && heute.getTime() > semester.anmeldungBis.getTime()) return false;
  return true;
}

/**
 * Liefert die Id des Semesters, für das eine jetzt eingehende Anmeldung gilt.
 *
 * Reihenfolge: erst ein Semester mit offenem Anmeldefenster (bei mehreren das
 * mit dem frühesten Beginn), sonst das laufende Semester, sonst nichts.
 *
 * Warum nicht einfach immer das laufende: Wer sich im Juli für den Jahrgang ab
 * September anmeldet, meint nicht das Semester, das gerade läuft. Genau dafür
 * gibt es das Anmeldefenster.
 */
export function semesterFuerAnmeldung(kandidaten: SemesterKandidat[], jetzt: Date): string | null {
  const heute = alsHeutigerTag(jetzt);

  const offen = kandidaten
    .filter((s) => istFensterOffen(s, heute))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  if (offen.length > 0) return offen[0].id;

  return kandidaten.find((s) => s.istAktuell)?.id ?? null;
}

// -----------------------------------------------------------------------------
// Teilnehmerliste — Spalten des Excel-Exports
// -----------------------------------------------------------------------------

export type ExportZeile = {
  nachname: string;
  vorname: string;
  email: string;
  telefon: string | null;
  strasse: string | null;
  plz: string | null;
  ort: string | null;
  geburtsdatum: Date | null;
  gemeinde: string | null;
  teilnahmeform: string | null;
  status: string;
  ermaessigung: string | null;
};

/**
 * Die Spalten der Excel-Datei — als Daten, damit Oberfläche, Export und
 * Prüfskript dieselbe Liste benutzen.
 *
 * **Die Bankverbindung fehlt hier mit Absicht.** Eine Exportdatei wandert auf
 * Notebooks, in Mailanhänge und in Cloud-Ordner; die IBAN liegt verschlüsselt
 * in der Datenbank und ist über die Anmeldeansicht einzeln und protokolliert
 * abrufbar. Sie hier mitzugeben würde diese Verschlüsselung aushebeln —
 * derselbe Fehler, der im Review schon einmal in `anmeldungen.antworten`
 * gefunden wurde. `scripts/pruefe-semesterlogik.ts` prüft das nach.
 */
export const EXPORT_SPALTEN: { titel: string; breite: number; wert: (zeile: ExportZeile) => string }[] = [
  { titel: "Nachname", breite: 18, wert: (z) => z.nachname },
  { titel: "Vorname", breite: 16, wert: (z) => z.vorname },
  { titel: "E-Mail", breite: 30, wert: (z) => z.email },
  { titel: "Telefon", breite: 18, wert: (z) => z.telefon ?? "" },
  { titel: "Straße", breite: 26, wert: (z) => z.strasse ?? "" },
  { titel: "PLZ", breite: 8, wert: (z) => z.plz ?? "" },
  { titel: "Ort", breite: 18, wert: (z) => z.ort ?? "" },
  { titel: "Geburtsdatum", breite: 14, wert: (z) => deutscherTag(z.geburtsdatum) },
  { titel: "Gemeinde", breite: 22, wert: (z) => z.gemeinde ?? "" },
  { titel: "Teilnahme", breite: 12, wert: (z) => teilnahmeformName(z.teilnahmeform) },
  { titel: "Status", breite: 16, wert: (z) => z.status },
  { titel: "Ermäßigung", breite: 16, wert: (z) => z.ermaessigung ?? "" },
];

export function teilnahmeformName(form: string | null | undefined): string {
  if (form === "SCHUELER") return "Schüler";
  if (form === "HOERER") return "Hörer";
  return "";
}

/**
 * Kalendertag in deutscher Schreibweise — für Spalten vom Typ `date`
 * (Geburtsdatum, Semesterbeginn). Bewusst in UTC gerechnet: Diese Werte SIND
 * Kalendertage, `toLocaleDateString()` würde sie je nach Rechnerzeitzone um
 * einen Tag verschieben.
 */
export function deutscherTag(datum: Date | null | undefined): string {
  if (!datum) return "";
  return `${String(datum.getUTCDate()).padStart(2, "0")}.${String(datum.getUTCMonth() + 1).padStart(2, "0")}.${datum.getUTCFullYear()}`;
}

/** Ein Semester-Zeitraum als Text „15.09.2026 – 01.12.2026" für Mails und Listen. */
export function semesterZeitraum(start: Date | null | undefined, ende: Date | null | undefined): string {
  const a = deutscherTag(start);
  const b = deutscherTag(ende);
  if (a && b) return `${a} – ${b}`;
  return a || b;
}

// -----------------------------------------------------------------------------
// Semesterüberleitung (Re-Enrollment) — DB-freie Kernlogik
// -----------------------------------------------------------------------------

export type Erinnerungsstufe = 1 | 2 | 3;

/**
 * Welche Erinnerungsstufe ist heute fällig — gegeben Semesterbeginn und die drei
 * Offsets (Tage vor Beginn, z. B. [14, 7, 3])? Verglichen wird Tag gegen Tag in
 * UTC: eine Stufe ist fällig, wenn `heute === start − offset`. Liefert 1, 2, 3
 * oder null (heute ist kein Stichtag).
 *
 * `heute` kommt aus der örtlichen Wanduhr (Container auf Europe/Berlin), `start`
 * ist ein Kalendertag (@db.Date, UTC-Mitternacht) — dieselbe Tag-gegen-Tag-Logik
 * wie `istFensterOffen`. Bei mehreren passenden Offsets gewinnt die frühere
 * Stufe; der Aufrufer verschickt ohnehin nur an noch nicht angeschriebene
 * Teilnahmen, also entsteht kein Doppelversand.
 */
export function faelligeErinnerungsstufe(
  start: Date,
  jetzt: Date,
  offsetsTage: [number, number, number],
): Erinnerungsstufe | null {
  const heute = alsHeutigerTag(jetzt).getTime();
  const startTag = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  for (let i = 0; i < offsetsTage.length; i++) {
    const stichtag = startTag - offsetsTage[i] * TAG_MS;
    if (stichtag === heute) return (i + 1) as Erinnerungsstufe;
  }
  return null;
}

export type UeberleitungKandidat = {
  personId: string;
  teilnahmeform: "SCHUELER" | "HOERER";
  istAktiv: boolean;
};

/**
 * Wer wird ins Folgesemester übernommen? Nur aktive Teilnehmer (`istAktiv`), die
 * im Zielsemester noch keine Teilnahme haben. Die Teilnahmeform wird aus dem
 * Vorsemester übernommen, nie geraten — sie bestimmt Prüfungspflicht und Zeugnis.
 * Genau dieselbe „führende Quelle" (Status.istAktiv) wie die Teilnehmerliste.
 */
export function waehleUeberzuleitende(
  quelle: UeberleitungKandidat[],
  bereitsImZiel: ReadonlySet<string>,
): { personId: string; teilnahmeform: "SCHUELER" | "HOERER" }[] {
  return quelle
    .filter((k) => k.istAktiv && !bereitsImZiel.has(k.personId))
    .map((k) => ({ personId: k.personId, teilnahmeform: k.teilnahmeform }));
}

/** Feldname der Erinnerungs-Zeitspalte auf `Teilnahme` zu einer Stufe. */
export function erinnerungsFeld(stufe: Erinnerungsstufe): "erinnertStufe1Am" | "erinnertStufe2Am" | "erinnertStufe3Am" {
  return (["erinnertStufe1Am", "erinnertStufe2Am", "erinnertStufe3Am"] as const)[stufe - 1];
}

// -----------------------------------------------------------------------------
// Semesterüberleitung — „bin dabei" / „bin raus" und Herausfallen (M10)
// -----------------------------------------------------------------------------

/** Kalendertag eines @db.Date-Werts als UTC-Mitternacht in Millisekunden. */
function tagMs(datum: Date): number {
  return Date.UTC(datum.getUTCFullYear(), datum.getUTCMonth(), datum.getUTCDate());
}

/**
 * Hat das Semester begonnen? Tag gegen Tag wie überall in dieser Datei: `heute`
 * aus der örtlichen Wanduhr (Container auf Europe/Berlin), `start` als
 * Kalendertag. Am Starttag selbst gilt es als begonnen.
 *
 * An dieser EINEN Grenze hängen drei Regeln der Überleitung, damit sie nie
 * auseinanderlaufen: Bis zum Vortag lässt sich über den Link antworten und die
 * Antwort ändern; ab dem Starttag setzt der Worker Eingeladene ohne Antwort auf
 * „keine Rückmeldung"; und in ein begonnenes Semester lädt keine Überleitung
 * mehr ein (dessen Links wären sofort abgelaufen).
 */
export function semesterHatBegonnen(start: Date, jetzt: Date): boolean {
  return alsHeutigerTag(jetzt).getTime() >= tagMs(start);
}

/**
 * Welche Erinnerungsstufen erledigt die Einladung gleich mit? Jede, deren
 * Stichtag (T-14/-7/-3, Offsets aus den Einstellungen) heute oder früher liegt.
 * Sonst schickte der stündliche Lauf am selben Tag eine Erinnerung hinterher —
 * und weil jede zugestellte Erinnerung einen frischen Link trägt, wäre der Link
 * der gerade verschickten Einladung binnen einer Stunde ungültig. Das gilt für
 * jeden Stichtag, nicht nur für T-14: Wer genau an T-7 einlädt, erledigt Stufe 1
 * und 2, wer an T-3 einlädt, alle drei.
 *
 * Wer früher einlädt, bekommt die Erinnerungen weiterhin; die Regler
 * SEMESTER_ERINNERUNG_*_TAGE behalten damit ihre Bedeutung. Tag gegen Tag wie
 * `faelligeErinnerungsstufe`.
 */
export function erledigteStufenBeiEinladung(
  start: Date,
  jetzt: Date,
  offsetsTage: [number, number, number],
): Erinnerungsstufe[] {
  const heute = alsHeutigerTag(jetzt).getTime();
  const stufen: Erinnerungsstufe[] = [];
  offsetsTage.forEach((offset, i) => {
    if (heute >= tagMs(start) - offset * TAG_MS) stufen.push((i + 1) as Erinnerungsstufe);
  });
  return stufen;
}

/**
 * Der letzte Tag, an dem sich über den Link antworten lässt: der Vortag des
 * Semesterstarts (Kalendertag, UTC-Mitternacht). Ab dem Starttag ist die
 * Rückmeldung geschlossen (`semesterHatBegonnen`). Mail und Seite nennen deshalb
 * dieses Datum („bis einschließlich …") statt „bis zum Semesterstart" — wer am
 * ersten Abend noch zusagen wollte, stand sonst vor einer geschlossenen Tür.
 */
export function rueckmeldeFrist(start: Date): Date {
  return new Date(tagMs(start) - TAG_MS);
}

export type RueckmeldeAntwort = "dabei" | "raus";

export type RueckmeldeZustand = {
  bestaetigtAm: Date | null;
  abgemeldetAm: Date | null;
  abmeldeGrund: string | null;
};

/**
 * Was bewirkt eine Antwort über den Link? `setzen` = die Antwort ändert den
 * Zustand, `schon` = sie steht bereits so (idempotent, kein zweiter
 * Audit-Eintrag), `gesperrt` = die Antwort ist nicht mehr zulässig.
 *
 * Eine spätere Antwort darf die frühere ändern — „raus" nach „dabei" und
 * umgekehrt —, solange das Semester nicht begonnen hat (das prüft der Aufrufer
 * mit `semesterHatBegonnen`). Vor dem Start hängt an der Antwort noch nichts
 * (keine Anwesenheit, keine Noten), und wer es sich anders überlegt, soll dafür
 * nicht bei der Verwaltung anrufen müssen. Eine vom Worker gesetzte „keine
 * Rückmeldung" hebt dagegen nur die Schulleitung auf („Wieder aufnehmen"):
 * Dann läuft das Semester schon, und ein stilles Wiederauftauchen in den Listen
 * der Dozenten wäre eine Überraschung.
 */
export function rueckmeldungsWirkung(
  zustand: RueckmeldeZustand,
  antwort: RueckmeldeAntwort,
): "setzen" | "schon" | "gesperrt" {
  if (antwort === "raus") return zustand.abgemeldetAm ? "schon" : "setzen";
  if (zustand.abmeldeGrund === ABMELDEGRUND.KEINE_RUECKMELDUNG) return "gesperrt";
  if (zustand.bestaetigtAm && !zustand.abgemeldetAm) return "schon";
  return "setzen";
}

export type RueckmeldeStand = "bestaetigt" | "offen" | "abgemeldet" | "ohne_einladung";

/**
 * Stand einer Teilnahme für die Übersicht der Überleitung — gebildet aus den
 * Zeitstempeln, NICHT aus dem Token (den der Aufräumlauf nach Semesterstart
 * löscht). Die drei Zustände schließen sich aus: Abgemeldet schlägt alles,
 * danach bestätigt, danach offen (eingeladen, keine Antwort).
 */
export function rueckmeldeStand(t: {
  eingeladenAm: Date | null;
  bestaetigtAm: Date | null;
  abgemeldetAm: Date | null;
}): RueckmeldeStand {
  if (t.abgemeldetAm) return "abgemeldet";
  if (t.bestaetigtAm) return "bestaetigt";
  if (t.eingeladenAm) return "offen";
  return "ohne_einladung";
}

/** Klartext zum Abmeldegrund für die Übersicht der Schulleitung. */
export function abmeldegrundText(grund: string | null | undefined): string {
  if (grund === ABMELDEGRUND.BIN_RAUS) return "hat abgesagt („Ich bin raus“)";
  if (grund === ABMELDEGRUND.KEINE_RUECKMELDUNG) return "keine Rückmeldung bis Semesterstart";
  return "abgemeldet";
}
