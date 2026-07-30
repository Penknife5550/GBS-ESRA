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

// en-CA liefert „JJJJ-MM-TT" — das Format eines <input type="date">.
const ISO_TAG = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Heutiges Datum als „JJJJ-MM-TT" in Europe/Berlin — für Vorbelegungen von
 * Datumsfeldern. Nicht `new Date().toISOString()` verwenden: das rechnet in UTC
 * und liefert in den frühen Morgenstunden (Berliner Zeit) noch den Vortag.
 */
export function heuteBerlin(): string {
  return ISO_TAG.format(new Date());
}
