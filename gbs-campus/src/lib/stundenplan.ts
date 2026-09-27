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

/** Alle vier Werte in der Reihenfolge der Auswahllisten — Quelle für das
 * `z.enum` der Verwaltungsroute und für `ANWESENHEIT_OPTIONEN`. */
export const ANWESENHEIT_WERTE = [
  ANWESENHEIT.ANWESEND,
  ANWESENHEIT.ENTSCHULDIGT,
  ANWESENHEIT.GEFEHLT,
  ANWESENHEIT.NACHGEARBEITET,
] as const;

/**
 * Wert und Klartext für jede Erfassungsoberfläche (Verwaltung, Dozent,
 * Selbstbestätigung). Jede filtert daraus, was sie setzen darf
 * (`istDozentStatusErlaubt`, `istSelbstStatusErlaubt`) — vorher stand dieselbe
 * Liste mit eigenen Klartexten in drei Client-Komponenten.
 */
export const ANWESENHEIT_OPTIONEN: readonly { wert: Anwesenheitswert; label: string }[] = ANWESENHEIT_WERTE.map(
  (wert) => ({ wert, label: anwesenheitName(wert) }),
);

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
 *
 * @deprecated Nicht für Anzeigen. Das ist die Quote über die ERFASSTEN Abende —
 * das zweite Quotenmodell, das Code-Review 4 (SEM-quote-stundenplan) beseitigt
 * hat: Mit ihr stünde „100 % erfüllt“ gegen „Noch offen“ in der Akte. Die
 * fachliche Quote ist Modell A (`quoteModellA` / `quoteAusVergangenen`, in der
 * Oberfläche QuoteChip und QuoteAmpel). Kein Produktivcode ruft diese Funktion
 * mehr auf; sie bleibt nur, weil `pruefe-stundenplan.ts` den ganzzahligen
 * Schwellenvergleich an ihr festhält.
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
 * Ist die Schwelle mit `teilgenommen` von `gesamt` Abenden erfüllt? Ganzzahliger
 * Vergleich, ohne Abende (gesamt 0) gilt sie als erfüllt.
 *
 * Die fachliche Quote ist Modell A (`quoteModellA` bzw. `quoteAusVergangenen`:
 * Teilnahmen der vergangenen Abende gegen ALLE Abende des Semesters) — so zeigen
 * sie Schüler-Akte, Detailakte, Personenliste und Stundenplan (QuoteChip bzw.
 * QuoteAmpel). `quoteErfuellt` ist genau deren Zustand ERFUELLT
 * (`teilgenommen >= benoetigt` ist derselbe Vergleich; die Prüfung in
 * `pruefe-stundenplan.ts` hält beide deckungsgleich). Die Oberfläche ruft sie
 * derzeit nicht mehr auf — sie bleibt als geprüfte Kurzform ohne die
 * Unterscheidung OFFEN/NICHT_ERREICHBAR.
 */
export function quoteErfuellt(teilgenommen: number, gesamt: number, schwelleProzent: number): boolean {
  if (gesamt <= 0) return true;
  return teilgenommen * 100 >= schwelleProzent * gesamt;
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
 *    „Es dürfen noch `darfNochFehlen` Abende fehlen." (`quoteHinweis`).
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
 * Modell-A-Quote einer Teilnahme aus der Anwesenheits-Matrix eines Semesters
 * (terminId → teilnahmeId → Status) — für die Stundenplan-Übersicht der
 * Verwaltung, die Abende und Anwesenheit ohnehin geladen hat. Dieselbe Rechnung
 * wie in der Schüler-Akte: gezählt werden die Stati der VERGANGENEN Abende
 * (ein im Voraus eingetragener künftiger Abend zählt noch nicht), der Nenner
 * sind ALLE Abende des Semesters.
 */
export function quoteJeTeilnahme(
  termine: { id: string; istVergangen: boolean }[],
  anwesenheit: Record<string, Record<string, string>>,
  teilnahmeId: string,
  schwelleProzent: number,
): QuoteModellA {
  const vergangeneStati = termine
    .filter((t) => t.istVergangen)
    .map((t) => anwesenheit[t.id]?.[teilnahmeId] ?? null);
  return quoteAusVergangenen(vergangeneStati, termine.length, schwelleProzent);
}

// -----------------------------------------------------------------------------
// Quote-Klartext für die Ampel (DB-frei, damit `pruefe-quote-schueler.ts` den
// schülerrelevanten Wortlaut gegenprüfen kann — nicht nur die Zahlen).
// -----------------------------------------------------------------------------

export function abendWort(n: number): string {
  return n === 1 ? "Abend" : "Abende";
}

/**
 * Der handlungsrelevante Fall (nicht mehr erreichbar oder kein Puffer mehr): darf
 * nicht der leiseste Text auf der Seite sein. Eine Wahrheit für Textzweig UND Stil.
 */
export function istQuoteDringend(q: QuoteModellA): boolean {
  return q.zustand === "NICHT_ERREICHBAR" || (q.zustand === "OFFEN" && q.darfNochFehlen <= 0);
}

/**
 * Wer die Quote liest: der Schüler selbst (/meine-daten) oder Verwaltung und
 * Schulleitung in der Detailakte. Nur beim Zustand NICHT_ERREICHBAR
 * unterscheidet sich der Text — der Schulleitung „Bitte wenden Sie sich an die
 * Schulleitung." zu sagen, führte ins Leere.
 */
export type QuoteSicht = "schueler" | "verwaltung";

/**
 * Der Klartext unter der Quote-Ampel — die eigentliche Aussage „bin ich auf Kurs".
 * Bewusst rein: ein falscher Zweig führt einen Schüler über seine Anwesenheit in
 * die Irre, und das ist ohne DB gegenprüfbar. `sicht` ist Pflicht, damit keine
 * Seite still den Schülertext bekommt.
 */
export function quoteHinweis(q: QuoteModellA, sicht: QuoteSicht): string {
  if (q.zustand === "ERFUELLT") {
    return "Die Anwesenheitspflicht ist damit gesichert — bereits erfasste Teilnahmen zählen fest.";
  }
  if (q.zustand === "NICHT_ERREICHBAR") {
    return sicht === "verwaltung"
      ? "Die Anwesenheitspflicht ist in diesem Semester rechnerisch nicht mehr erreichbar. " +
          "Der Teilnehmer sieht dazu den Hinweis, sich an die Schulleitung zu wenden."
      : "Die Anwesenheitspflicht ist in diesem Semester rechnerisch nicht mehr erreichbar. Bitte wenden Sie sich an die Schulleitung.";
  }
  if (q.darfNochFehlen <= 0) {
    return "Achtung: Es darf kein Abend mehr fehlen, sonst reißt die Grenze.";
  }
  return `Es dürfen noch ${q.darfNochFehlen} ${abendWort(q.darfNochFehlen)} fehlen.`;
}

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

/**
 * Die Dienstagabende eines Semesters: der erste Dienstag ab dem Semesterbeginn
 * (der Beginn selbst, wenn er ein Dienstag ist), dann wöchentlich, `anzahl` Mal,
 * jeweils um `stunde:minute` Ortszeit (Container Europe/Berlin) — die GBS
 * unterrichtet dienstags 19:00–21:30.
 *
 * `start` ist ein Kalendertag (@db.Date, UTC-Mitternacht); der Wochentag wird
 * deshalb in UTC bestimmt. Die Abende werden mit dem ÖRTLICHEN Konstruktor
 * gebaut (19:00 vor Ort), damit keine Zeitzonenverschiebung entsteht — auch über
 * die Umstellung auf Winter- bzw. Sommerzeit hinweg bleibt es 19:00 vor Ort
 * (geprüft in `pruefe-stundenplan.ts`, das deshalb in Europe/Berlin laufen muss).
 */
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

// -----------------------------------------------------------------------------
// Dozenten-Übersicht: welche vergangenen Abende sind noch nicht vollständig
// erfasst? DB-frei über die schon geladene Stundenplan-Struktur — damit die
// „Offene Aufgaben" des Dozenten testbar sind und nicht in der JSX-Seite hängen.
// -----------------------------------------------------------------------------

export type OffenerAbend = {
  /** Für den Sprung zum Abend im Stundenplan (Anker `#termin-<id>`). */
  terminId: string;
  semester: string;
  text: string;
  fach: string | null;
  erfasst: number;
  gesamt: number;
};

type ErfassungsGruppe = {
  semesterBezeichnung: string;
  teilnehmer: { teilnahmeId: string }[];
  termine: { id: string; text: string; fach: string | null; istVergangen: boolean }[];
  /** terminId → teilnahmeId → Status (nur für vergangene Abende befüllt). */
  anwesenheit: Record<string, Record<string, string>>;
};

/**
 * Alle vergangenen Abende mit aktiven Teilnehmern, bei denen noch nicht für jeden
 * ein Status erfasst ist (`erfasst < gesamt`). Der `teilnehmer.length > 0`-Guard
 * verhindert, dass ein Semester ohne Teilnehmer als „offen" zählt.
 */
export function offeneErfassung(gruppen: ErfassungsGruppe[]): OffenerAbend[] {
  return gruppen.flatMap((g) =>
    g.termine
      .filter((t) => t.istVergangen && g.teilnehmer.length > 0)
      .map((t) => ({
        terminId: t.id,
        semester: g.semesterBezeichnung,
        text: t.text,
        fach: t.fach,
        erfasst: g.teilnehmer.filter((tn) => g.anwesenheit[t.id]?.[tn.teilnahmeId]).length,
        gesamt: g.teilnehmer.length,
      }))
      .filter((a) => a.erfasst < a.gesamt),
  );
}
