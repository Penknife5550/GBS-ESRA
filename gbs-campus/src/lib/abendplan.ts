/**
 * GBS Campus — Unterrichtsabende als Plan (DB-frei)
 *
 * Die Seite „Unterricht“ (Oberflächenplan 09/2026) zeigt den Stundenplan als
 * Liste nach Abenden: links das Datum, rechts je Einheit Uhrzeit, Fach, Thema,
 * Dozent und der Stand der Anwesenheit. Hier steht, wie aus den Terminen eines
 * Semesters Abende werden (ein Abend = ein Berliner Kalendertag), welcher Abend
 * der nächste ist, wo eine längere Pause liegt und wie der Stand einer Einheit
 * heißt — ohne Datenbank und ohne JSX, damit die Seite nur noch zeichnet.
 */

import { TAG_MS } from "@/lib/constants";
import { berlinerTag, uhrzeit } from "@/lib/datum";

const ABEND_TITEL = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  weekday: "short",
  day: "numeric",
  month: "long",
});

/** „Di, 15. September“ — die Überschrift eines Abends (Wochentag ohne Punkt, wie im Plan). */
export function abendTitel(d: Date): string {
  const teile = ABEND_TITEL.formatToParts(d);
  const teil = (typ: Intl.DateTimeFormatPartTypes) => teile.find((t) => t.type === typ)?.value ?? "";
  return `${teil("weekday").replace(".", "")}, ${teil("day")}. ${teil("month")}`;
}

const TAG_MONAT = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit" });

/** „01.12.“ — Tag und Monat eines Zeitpunkts in Europe/Berlin, für Hinweise im laufenden Jahr. */
export function tagMonat(d: Date): string {
  return TAG_MONAT.format(d);
}

/** „19:00–20:30“, ohne Ende nur „19:00“. */
export function zeitspanne(beginn: Date, ende: Date | null): string {
  return ende ? `${uhrzeit(beginn)}–${uhrzeit(ende)}` : uhrzeit(beginn);
}

/**
 * Der Titel einer Kurseinheit ohne den Fachnamen davor: „Kirchengeschichte:
 * Antike und Mittelalter“ wird unter dem Fach „Kirchengeschichte“ zu „Antike und
 * Mittelalter“ — der Fachname steht in der Zeile ja schon. Heißt die Einheit wie
 * das Fach („Dogmatik“), gibt es nichts zu ergänzen: null.
 */
export function kurzTitel(fach: string, titel: string): string | null {
  const praefix = `${fach}: `;
  const kurz = titel.startsWith(praefix) && titel.length > praefix.length ? titel.slice(praefix.length) : titel;
  return kurz === fach ? null : kurz;
}

const ZAHLWORT = ["Eine", "Zwei", "Drei", "Vier", "Fünf", "Sechs", "Sieben", "Acht", "Neun", "Zehn", "Elf", "Zwölf"];

/** „Zwei Wochen ohne Unterricht“ — die leise Zeile zwischen zwei Abenden. */
export function pauseText(wochen: number): string {
  const wort = ZAHLWORT[wochen - 1] ?? String(wochen);
  return `${wort} ${wochen === 1 ? "Woche" : "Wochen"} ohne Unterricht`;
}

/** Tage zwischen zwei Kalendertagen „JJJJ-MM-TT“ (in UTC gerechnet, also ohne Zeitumstellung). */
function tageZwischen(von: string, bis: string): number {
  return Math.round((Date.parse(`${bis}T00:00:00Z`) - Date.parse(`${von}T00:00:00Z`)) / TAG_MS);
}

export type Abend<T> = {
  /** Berliner Kalendertag „JJJJ-MM-TT“. */
  tag: string;
  /** Beginn der ersten Einheit — für Überschrift und Kurzform. */
  datum: Date;
  /** Laufende Nummer im Semester („Abend 3“). */
  nummer: number;
  einheiten: T[];
  /** Heute ist Unterricht bzw. dies ist der nächste Abend — genau einer ist markiert. */
  markierung: "heute" | "naechster" | null;
  /** Wochen ohne Unterricht direkt vor diesem Abend (0 = die übliche Woche). */
  pauseDavor: number;
};

/**
 * Fasst die Termine eines Semesters zu Abenden zusammen: alle Einheiten desselben
 * Berliner Kalendertags bilden einen Abend, sortiert nach Beginn. Markiert wird
 * der heutige Abend oder — ohne Unterricht heute — der nächste. Liegen mehr als
 * sieben Tage zwischen zwei Abenden, steht davor die Zahl der ausgefallenen
 * Wochen (15.09. → 29.09. ist eine Woche Pause).
 */
export function gruppiereAbende<T extends { beginn: Date }>(termine: readonly T[], jetzt: Date): Abend<T>[] {
  const sortiert = [...termine].sort((a, b) => a.beginn.getTime() - b.beginn.getTime());
  const abende: Abend<T>[] = [];
  for (const termin of sortiert) {
    const tag = berlinerTag(termin.beginn);
    const letzter = abende[abende.length - 1];
    if (letzter && letzter.tag === tag) {
      letzter.einheiten.push(termin);
      continue;
    }
    const abstand = letzter ? tageZwischen(letzter.tag, tag) : 0;
    abende.push({
      tag,
      datum: termin.beginn,
      nummer: abende.length + 1,
      einheiten: [termin],
      markierung: null,
      pauseDavor: abstand > 7 ? Math.floor((abstand - 1) / 7) : 0,
    });
  }
  const heute = berlinerTag(jetzt);
  const kommender = abende.find((a) => a.tag >= heute);
  if (kommender) kommender.markierung = kommender.tag === heute ? "heute" : "naechster";
  return abende;
}

export type EinheitStand = { ton: "gruen" | "gelb" | "grau"; text: string; offen: boolean };

/**
 * Der Stand der Anwesenheit einer Einheit: künftig „geplant“, danach „erfasst ·
 * 20 von 20“ oder — solange nicht für jeden etwas eingetragen ist — „offen · 5
 * von 20“ (dann mit „Erfassen“ daneben). Dieselbe Grenze wie die offenen
 * Aufgaben der Dozenten (`offeneErfassung`): vergangen und nicht für alle erfasst.
 */
export function einheitStand(e: { vergangen: boolean; erfasst: number; gesamt: number }): EinheitStand {
  if (!e.vergangen) return { ton: "grau", text: "geplant", offen: false };
  if (e.gesamt === 0) return { ton: "grau", text: "ohne Teilnehmer", offen: false };
  if (e.erfasst >= e.gesamt) return { ton: "gruen", text: `erfasst · ${e.erfasst} von ${e.gesamt}`, offen: false };
  return { ton: "gelb", text: `offen · ${e.erfasst} von ${e.gesamt}`, offen: true };
}
