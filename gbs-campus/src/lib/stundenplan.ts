/**
 * GBS Campus — Stundenplan & Anwesenheit: DB-freie Kernlogik
 *
 * Reine Funktionen ohne Datenbank, damit `scripts/pruefe-stundenplan.ts` sie
 * ohne Postgres gegenprüfen kann: die Anwesenheitsquote und der Generator für
 * die Dienstagabende eines Semesters.
 */

/** Die vier Anwesenheits-Stati als Werte (parallel zum Prisma-Enum). */
export const ANWESENHEIT = {
  ANWESEND: "ANWESEND",
  ENTSCHULDIGT: "ENTSCHULDIGT",
  GEFEHLT: "GEFEHLT",
  NACHGEARBEITET: "NACHGEARBEITET",
} as const;

export type Anwesenheitswert = (typeof ANWESENHEIT)[keyof typeof ANWESENHEIT];

/** Klartext für die Anzeige. */
export function anwesenheitName(status: string | null | undefined): string {
  switch (status) {
    case "ANWESEND":
      return "anwesend";
    case "ENTSCHULDIGT":
      return "entschuldigt";
    case "GEFEHLT":
      return "gefehlt";
    case "NACHGEARBEITET":
      return "nachgearbeitet";
    default:
      return "—";
  }
}

/** Zählt als teilgenommen: anwesend oder nachgearbeitet (Schulordnung). */
export function zaehltAlsTeilgenommen(status: string | null | undefined): boolean {
  return status === "ANWESEND" || status === "NACHGEARBEITET";
}

export type QuoteErgebnis = {
  gesamt: number;
  teilgenommen: number;
  prozent: number;
  erfuellt: boolean;
};

/**
 * Anwesenheitsquote aus einer Liste von Stati. „Teilgenommen" ist ANWESEND oder
 * NACHGEARBEITET. Ohne Termine (gesamt 0) gilt die Quote als erfüllt — es gab
 * noch nichts zu versäumen.
 *
 * Der Schwellenvergleich läuft ganzzahlig (`teilgenommen * 100 >= schwelle *
 * gesamt`), nicht über eine gerundete Prozentzahl: 4 von 5 (= 80 %) sollen die
 * 80-%-Schwelle erfüllen, 3 von 4 (= 75 %) nicht — ohne Rundungs-Grauzone.
 */
export function anwesenheitsquote(status: string[], schwelleProzent: number): QuoteErgebnis {
  const gesamt = status.length;
  const teilgenommen = status.filter(zaehltAlsTeilgenommen).length;
  if (gesamt === 0) return { gesamt: 0, teilgenommen: 0, prozent: 100, erfuellt: true };
  return {
    gesamt,
    teilgenommen,
    prozent: Math.round((teilgenommen / gesamt) * 100),
    erfuellt: teilgenommen * 100 >= schwelleProzent * gesamt,
  };
}

/**
 * Die Dienstagabende eines Semesters: der erste Dienstag ab dem Semesterbeginn
 * (der Beginn selbst, wenn er ein Dienstag ist), dann wöchentlich, `anzahl` Mal,
 * jeweils um `stunde:minute` Ortszeit (Container Europe/Berlin) — die GBS
 * unterrichtet dienstags 19:00–21:30.
 *
 * `start` ist ein Kalendertag (@db.Date, UTC-Mitternacht); der Wochentag wird
 * deshalb in UTC bestimmt. Die Abende werden mit dem ÖRTLICHEN Konstruktor
 * gebaut (19:00 vor Ort), damit keine Zeitzonenverschiebung entsteht.
 */
/** Ein Termin als Text „Di., 15.09.2026, 19:00" — in Europe/Berlin, weil `beginn`
 * ein echter Zeitpunkt ist (kein Kalendertag). */
export function terminText(d: Date): string {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function dienstagstermine(start: Date, anzahl: number, stunde = 19, minute = 0): Date[] {
  const jahr = start.getUTCFullYear();
  const monat = start.getUTCMonth();
  const tag = start.getUTCDate();
  const startWochentag = new Date(Date.UTC(jahr, monat, tag)).getUTCDay(); // 0=So … 2=Di … 6=Sa
  const bisDienstag = (2 - startWochentag + 7) % 7; // Tage bis zum nächsten Dienstag (0, wenn Start = Di)

  const termine: Date[] = [];
  for (let i = 0; i < anzahl; i++) {
    // Tagüberlauf (tag + Offset > Monatslänge) rechnet der Date-Konstruktor
    // korrekt weiter in den Folgemonat.
    termine.push(new Date(jahr, monat, tag + bisDienstag + i * 7, stunde, minute));
  }
  return termine;
}
