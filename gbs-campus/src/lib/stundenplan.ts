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

/**
 * Zählt als versäumt (drückt die Quote): gefehlt oder entschuldigt — für die
 * 80-%-Schwelle ist auch eine entschuldigte Abwesenheit keine Teilnahme. Ein
 * Abend ohne Eintrag (`null`) ist weder teilgenommen noch versäumt, sondern offen.
 * Gegenstück zu `zaehltAlsTeilgenommen`, damit die Klassifikationsregel an einem
 * Ort im Kern liegt (nicht inline im IO-Layer).
 */
export function zaehltAlsVersaeumt(status: string | null | undefined): boolean {
  return status === "GEFEHLT" || status === "ENTSCHULDIGT";
}

/**
 * Die Zustände, die ein Dozent für seine eigenen Abende setzen darf: anwesend,
 * gefehlt oder nachgearbeitet. „Entschuldigt" ist bewusst NICHT dabei — ob eine
 * Abwesenheit entschuldigt ist, entscheidet die Schule, nicht der Dozent im Raum
 * (dieselbe Grenze wie bei der Selbstbestätigung des Teilnehmers).
 */
export const DOZENT_STATUS = ["ANWESEND", "GEFEHLT", "NACHGEARBEITET"] as const;
export type DozentStatus = (typeof DOZENT_STATUS)[number];

export function istDozentStatusErlaubt(status: string): status is DozentStatus {
  return (DOZENT_STATUS as readonly string[]).includes(status);
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

/** Der Ampel-Zustand der eigenen Quote in der Schüler-Sicht. */
export type QuoteZustand = "ERFUELLT" | "OFFEN" | "NICHT_ERREICHBAR";

export type QuoteModellA = {
  /** Alle Abende des Semesters (vergangene + künftige). */
  gesamt: number;
  /** Vergangene Abende mit ANWESEND/NACHGEARBEITET. */
  teilgenommen: number;
  /** Vergangene Abende mit GEFEHLT/ENTSCHULDIGT. */
  versaeumt: number;
  /** Rest: künftige Abende und noch nicht erfasste vergangene — zählen nicht gegen den Schüler. */
  offen: number;
  /** Wie viele Teilnahmen die Schwelle über alle Abende verlangt. */
  benoetigt: number;
  /** Wie viele der offenen Abende noch versäumt werden dürfen (kann negativ sein, wenn schon zu viele fehlen). */
  darfNochFehlen: number;
  /** teilgenommen / gesamt, gerundet (Teil des Kennzahl-Objekts; die Schüler-Zeile
   * zeigt „X von Y" statt eines Prozentwerts). */
  prozent: number;
  /** Die zugrunde gelegte Schwelle in Prozent — nur zur Anzeige. */
  schwelleProzent: number;
  zustand: QuoteZustand;
};

/**
 * Anwesenheitsquote aus Sicht des Schülers, gemessen über ALLE Abende des
 * Semesters (Modell A) — anders als `anwesenheitsquote`, die nur über die
 * übergebenen (erfassten) Stati rechnet.
 *
 * Die drei Zustände tragen die eigentliche Aussage „bin ich auf Kurs für die
 * Prüfungsberechtigung":
 *  - **ERFUELLT**: schon jetzt genug Teilnahmen — vergangene Teilnahme ist nicht
 *    mehr verlierbar, die Schwelle steht sicher (`teilgenommen >= benoetigt`).
 *  - **NICHT_ERREICHBAR**: schon so viele Abende versäumt, dass selbst mit allen
 *    verbleibenden Abenden die Schwelle nicht mehr zu schaffen ist.
 *  - **OFFEN**: noch erreichbar, aber noch nicht gesichert — mit dem Klartext
 *    „du darfst noch `darfNochFehlen` Abende fehlen".
 *
 * Unerfasste vergangene Abende bleiben bewusst `offen` (weder teilgenommen noch
 * versäumt): Die Erfassung passiert real oft verspätet, ein noch nicht
 * eingetragener Abend soll die Quote nicht fälschlich senken.
 *
 * Der Schwellenvergleich läuft ganzzahlig, konsistent mit `anwesenheitsquote`:
 * `benoetigt` ist die kleinste Zahl n mit `n*100 >= schwelle*gesamt`.
 */
export function quoteModellA(
  gesamt: number,
  teilgenommen: number,
  versaeumt: number,
  schwelleProzent: number,
): QuoteModellA {
  // Ohne Abende gibt es noch nichts zu erfüllen — wie bei `anwesenheitsquote`.
  if (gesamt <= 0) {
    return { gesamt: 0, teilgenommen: 0, versaeumt: 0, offen: 0, benoetigt: 0, darfNochFehlen: 0, prozent: 100, schwelleProzent, zustand: "ERFUELLT" };
  }
  const offen = Math.max(0, gesamt - teilgenommen - versaeumt);
  const benoetigt = Math.ceil((schwelleProzent * gesamt) / 100);
  const erlaubteFehl = gesamt - benoetigt;
  const darfNochFehlen = erlaubteFehl - versaeumt;
  const prozent = Math.round((teilgenommen / gesamt) * 100);

  // Reihenfolge ist bewusst: „schon gesichert" schlägt „nicht mehr erreichbar"
  // (beides zugleich ist rechnerisch unmöglich, da teilgenommen >= benoetigt
  // bereits versaeumt <= erlaubteFehl erzwingt).
  let zustand: QuoteZustand;
  if (teilgenommen >= benoetigt) zustand = "ERFUELLT";
  else if (versaeumt > erlaubteFehl) zustand = "NICHT_ERREICHBAR";
  else zustand = "OFFEN";

  return { gesamt, teilgenommen, versaeumt, offen, benoetigt, darfNochFehlen, prozent, schwelleProzent, zustand };
}

/**
 * Einstieg für die Schüler-Sicht: klassifiziert die Stati der bereits vergangenen
 * Abende in teilgenommen/versäumt (`null`/unerfasst bleibt beides nicht → landet
 * über den Nenner in `offen`) und rechnet daraus die Quote über ALLE `gesamt`
 * Abende des Semesters. Bewusst als reine Funktion, damit die Ableitung
 * Status → Zahl DB-frei prüfbar bleibt — der IO-Layer reicht nur die Stati-Liste
 * und die Gesamtzahl herein.
 */
export function quoteAusVergangenen(
  vergangeneStati: (string | null)[],
  gesamt: number,
  schwelleProzent: number,
): QuoteModellA {
  const teilgenommen = vergangeneStati.filter(zaehltAlsTeilgenommen).length;
  const versaeumt = vergangeneStati.filter(zaehltAlsVersaeumt).length;
  return quoteModellA(gesamt, teilgenommen, versaeumt, schwelleProzent);
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
