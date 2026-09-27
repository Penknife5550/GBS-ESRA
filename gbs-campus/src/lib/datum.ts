/**
 * GBS Campus — neutrale Datums-Formatierer
 *
 * Bewusst domänenfrei: Auskunft (DSGVO), Honorar-Beleg und die Oberflächen
 * brauchen dieselbe deutsche Datums-/Zeitdarstellung. Damit kein Fachmodul an
 * einem anderen hängt, liegen die Helfer hier. Immer Europe/Berlin, damit ein
 * in UTC gespeicherter Zeitpunkt lokal richtig erscheint.
 */

const DATUM = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const DATUM_ZEIT = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Datum in „TT.MM.JJJJ" (mit führenden Nullen), „—" wenn leer. */
export function datum(d: Date | null | undefined): string {
  return d ? DATUM.format(d) : "—";
}

/** Datum und Uhrzeit in „TT.MM.JJJJ, hh:mm", „—" wenn leer. */
export function datumZeit(d: Date | null | undefined): string {
  return d ? DATUM_ZEIT.format(d) : "—";
}

const DATUM_ZEIT_SEKUNDEN = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/**
 * Datum und Uhrzeit mit Sekunden, „TT.MM.JJJJ, hh:mm:ss" — für das Protokoll,
 * wo mehrere Einträge in derselben Minute stehen. „—" wenn leer.
 */
export function datumZeitSekunden(d: Date | null | undefined): string {
  return d ? DATUM_ZEIT_SEKUNDEN.format(d) : "—";
}

/**
 * Wandelt „JJJJ-MM-TT" in einen Kalendertag um (UTC-Mitternacht) oder liefert
 * null. Die Gegenprobe über `toISOString()` ist nötig, weil JavaScript den
 * 31.02. stillschweigend zum 03.03. macht.
 *
 * Die eine Stelle für diese Prüfung: Semester, Honorar, Ausbildungsdaten und
 * das Datumsfeld des Anmeldeformulars (`formular.ts`) nehmen sie von hier;
 * `semester.ts` reicht sie für bestehende Aufrufer weiter.
 */
export function alsTagesdatum(text: unknown): Date | null {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text.trim())) return null;
  const sauber = text.trim();
  const tag = new Date(`${sauber}T00:00:00.000Z`);
  if (Number.isNaN(tag.getTime())) return null;
  if (tag.toISOString().slice(0, 10) !== sauber) return null;
  return tag;
}

// en-CA liefert „JJJJ-MM-TT" — das Format eines <input type="date">.
const ISO_TAG = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Der Berliner Kalendertag eines Zeitpunkts als „JJJJ-MM-TT" — aus den Teilen
 * gebaut, also unabhängig vom Datumsmuster der Locale. Grundlage der
 * Beleg-Nummern (`beleg-nr.ts`).
 */
export function berlinerTag(am: Date): string {
  const teile = ISO_TAG.formatToParts(am);
  const teil = (typ: Intl.DateTimeFormatPartTypes) => teile.find((t) => t.type === typ)?.value ?? "";
  return `${teil("year")}-${teil("month")}-${teil("day")}`;
}

/**
 * Heutiges Datum als „JJJJ-MM-TT" in Europe/Berlin — für Vorbelegungen von
 * Datumsfeldern. Nicht `new Date().toISOString()` verwenden: das rechnet in UTC
 * und liefert in den frühen Morgenstunden (Berliner Zeit) noch den Vortag.
 */
export function heuteBerlin(): string {
  return berlinerTag(new Date());
}

// ---------------------------------------------------------------------------
// Anzeige im Alltag (Oberfläche seit 09/2026): „Dienstag, 29. September“ statt
// „Di., 29.09.2026, 19:00“ — lesbar wie im Gespräch.
// ---------------------------------------------------------------------------

const TAG_LANG = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** „Dienstag, 29. September“ — für Überschriften wie „Heute“ oder „Nächster Abend“. */
export function tagLang(d: Date): string {
  return TAG_LANG.format(d);
}

const TAG_KURZ = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

/** „Di., 29.09.“ — für Listen, in denen das Jahr klar ist. */
export function tagKurz(d: Date): string {
  return TAG_KURZ.format(d);
}

const UHRZEIT = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  hour: "2-digit",
  minute: "2-digit",
});

/** „19:00“ in Europe/Berlin. */
export function uhrzeit(d: Date): string {
  return UHRZEIT.format(d);
}

const KALENDER = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** Die drei Zeilen des Kalenderblocks: Wochentag („DI“), Tag („29“), Monat („Sept.“). */
export function kalenderTeile(d: Date): { wochentag: string; tag: string; monat: string } {
  const teile = KALENDER.formatToParts(d);
  const teil = (typ: Intl.DateTimeFormatPartTypes) => teile.find((t) => t.type === typ)?.value ?? "";
  return { wochentag: teil("weekday").replace(".", "").toUpperCase(), tag: teil("day"), monat: teil("month") };
}
