/**
 * GBS Campus — Semesterüberleitung: DB-freie Regeln für Nachversand,
 * Worker-Ausfall und Übernahme
 *
 * Drei Entscheidungen, die ohne Datenbank fallen und deshalb hier liegen —
 * `scripts/pruefe-semesterlogik.ts` prüft sie ohne Postgres gegen:
 *
 *  1. Ist eine Einladung zugestellt? (`einladungZugestellt`) — daran hängen die
 *     Zahl „Einladung nicht zugestellt" und der Knopf „Erneut senden" auf der
 *     Überleitungsseite.
 *  2. Hat eine offene Einladung schon Spuren im Unterricht? (`hatNutzungsspuren`)
 *     — dann meldet der Lauf zum Semesterstart sie nicht als „keine Rückmeldung"
 *     ab, sondern wertet die Teilnahme als Rückmeldung.
 *  3. Ist jemand „zuletzt abgemeldet"? (`zuletztAbgemeldet`) — dann lässt die
 *     Sammelübernahme auf der Teilnehmerseite ihn aus.
 *
 * Die Datenbankseite liegt in `ueberleitung.ts` (1 und 2) und in
 * `teilnehmerliste.ts` (3).
 */

import { MAIL_VORLAGE } from "@/lib/constants";
import { rueckmeldeStand } from "@/lib/semester";
import { zaehltAlsTeilgenommen } from "@/lib/stundenplan";

// -----------------------------------------------------------------------------
// 1. Zustellung der Einladung
// -----------------------------------------------------------------------------

/** Die Mails, die einen Überleitungs-Link zustellen: Einladung und Erinnerung. */
export const UEBERLEITUNG_VORLAGEN: readonly string[] = [
  MAIL_VORLAGE.UEBERLEITUNG_EINLADUNG,
  MAIL_VORLAGE.UEBERLEITUNG_ERINNERUNG,
];

/** Eine Zeile aus `email_versand`, soweit die Regel sie braucht. */
export type VersandSpur = { vorlageCode: string | null; status: string; erstelltAm: Date };

/**
 * Hat die Person seit der Einladung einen Link erhalten? Zugestellt heißt: eine
 * Zeile mit Status GESENDET, Vorlage Einladung oder Erinnerung, angelegt
 * frühestens zum Zeitpunkt der Einladung.
 *
 * Eine ältere Zeile gehört zu einer früheren Überleitung — `email_versand` kennt
 * nur die Person, nicht die Teilnahme. FEHLER, BOUNCE und WARTEND zählen nicht;
 * auch gar keine Zeile heißt „nicht zugestellt" (etwa wenn der Prozess mitten im
 * Versand abbrach, bevor die Zeile entstand).
 */
export function einladungZugestellt(eingeladenAm: Date, spuren: readonly VersandSpur[]): boolean {
  return spuren.some(
    (spur) =>
      spur.status === "GESENDET" &&
      spur.vorlageCode !== null &&
      UEBERLEITUNG_VORLAGEN.includes(spur.vorlageCode) &&
      spur.erstelltAm.getTime() >= eingeladenAm.getTime(),
  );
}

/**
 * Eine offene Einladung, deren Link nie angekommen ist — sie bekommt „Erneut
 * senden". Nur offene Einladungen (eingeladen, weder zu- noch abgesagt): Wer
 * geantwortet hat, braucht keinen Link mehr, und eine direkt aufgenommene
 * Teilnahme hatte nie einen.
 */
export function einladungNichtZugestellt(
  teilnahme: { eingeladenAm: Date | null; bestaetigtAm: Date | null; abgemeldetAm: Date | null },
  spuren: readonly VersandSpur[],
): boolean {
  if (rueckmeldeStand(teilnahme) !== "offen" || !teilnahme.eingeladenAm) return false;
  return !einladungZugestellt(teilnahme.eingeladenAm, spuren);
}

// -----------------------------------------------------------------------------
// 2. Nutzungsspuren — Rückmeldung durch Teilnahme am Unterricht
// -----------------------------------------------------------------------------

export type Nutzungsspuren = {
  /** Die Anwesenheiten der Teilnahme (nur der Status zählt). */
  anwesenheiten: readonly { status: string }[];
  /** Wie viele Leistungen (Bewertungen) an der Teilnahme hängen. */
  leistungen: number;
};

/**
 * Nimmt die Person schon am Unterricht des Zielsemesters teil? Mindestens eine
 * Anwesenheit, die als teilgenommen zählt (anwesend oder nachgearbeitet —
 * `zaehltAlsTeilgenommen`, dieselbe Regel wie die Anwesenheitsquote), oder
 * mindestens eine Leistung. Gefehlt und entschuldigt sind keine Spur: Wer nie da
 * war, hat damit nichts zurückgemeldet.
 *
 * Der Fall dahinter: Fällt der Worker länger aus, holt sein nächster Lauf die
 * Abmeldung „keine Rückmeldung" nach — früher auch für Personen, die längst in
 * der Anwesenheitsliste stehen. Sie fielen dann mitten im Semester aus allen
 * Listen, samt ihren Anwesenheiten und Noten.
 */
export function hatNutzungsspuren(spuren: Nutzungsspuren): boolean {
  return spuren.leistungen > 0 || spuren.anwesenheiten.some((anwesenheit) => zaehltAlsTeilgenommen(anwesenheit.status));
}

// -----------------------------------------------------------------------------
// 3. „Zuletzt abgemeldet" — die Absage wirkt über ein Semester hinaus
// -----------------------------------------------------------------------------

/** Eine Teilnahme der Person in einem anderen Semester, soweit die Regel sie braucht. */
export type FruehereTeilnahme = { semesterStart: Date; abgemeldetAm: Date | null };

/**
 * Ist die jüngste Teilnahme VOR dem Zielsemester abgemeldet („Ich bin raus" oder
 * keine Rückmeldung)? Dann liefert die Funktion genau diese Teilnahme, sonst null.
 * „Jüngste" nach Semesterbeginn, nicht nach Listenplatz; ein Semester zählt als
 * früher, wenn es VOR dem Zielsemester beginnt (gleicher Beginn zählt nicht).
 *
 * Wer für ein Semester abgesagt hat, hat im nächsten keine Teilnahme und stand
 * dort früher als „noch nicht zugeordnet" — die Sammelübernahme legte ihn still
 * wieder an, die Absage wirkte nur ein Semester. Wer danach wieder teilgenommen
 * hat, ist nicht gemeint: Es zählt nur die jüngste frühere Teilnahme. Eine
 * Absage für ein SPÄTERES Semester spielt keine Rolle.
 *
 * Beginnen zwei Semester am selben Tag, entscheidet: Zählt eine der beiden
 * Teilnahmen, ist die Person dabei.
 */
export function zuletztAbgemeldet<T extends FruehereTeilnahme>(teilnahmen: readonly T[], zielStart: Date): T | null {
  const frueher = teilnahmen.filter((t) => t.semesterStart.getTime() < zielStart.getTime());
  if (frueher.length === 0) return null;
  const juengsterStart = Math.max(...frueher.map((t) => t.semesterStart.getTime()));
  const juengste = frueher.filter((t) => t.semesterStart.getTime() === juengsterStart);
  if (juengste.some((t) => t.abgemeldetAm === null)) return null;
  return juengste[0];
}
