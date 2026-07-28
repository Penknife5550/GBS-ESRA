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

export type Pruefmeldung = { feld?: string; meldung: string };

/** Höchstlänge eines Semesters. Ein Tippfehler im Jahr fällt damit sofort auf. */
const MAX_DAUER_TAGE = 366 * 2;
const TAG_MS = 24 * 60 * 60 * 1000;

/**
 * Wandelt „JJJJ-MM-TT" in einen Kalendertag um (UTC-Mitternacht) oder liefert
 * null. Die Gegenprobe über `toISOString()` ist nötig, weil JavaScript den
 * 31.02. stillschweigend zum 03.03. macht — dieselbe Prüfung steht aus
 * demselben Grund in `formular.ts`.
 */
export function alsTagesdatum(text: unknown): Date | null {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text.trim())) return null;
  const sauber = text.trim();
  const datum = new Date(`${sauber}T00:00:00.000Z`);
  if (Number.isNaN(datum.getTime())) return null;
  if (datum.toISOString().slice(0, 10) !== sauber) return null;
  return datum;
}

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
};

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

  return meldungen;
}

/** Die geprüften Werte, wie sie in der Datenbank stehen. */
export type SemesterDaten = {
  code: string;
  bezeichnung: string;
  start: Date;
  ende: Date;
  anmeldungVon: Date | null;
  anmeldungBis: Date | null;
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
