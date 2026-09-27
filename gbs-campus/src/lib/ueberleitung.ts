/**
 * GBS Campus — Semesterüberleitung (Re-Enrollment)
 *
 * Der IO-Teil: einen Jahrgang ins Folgesemester einladen, die Antwort „Ich bin
 * dabei" / „Ich bin raus" einlösen, die Erinnerungen T-14/-7/-3 verschicken und
 * zum Semesterstart alle Eingeladenen ohne Antwort abmelden. Die DB-freie
 * Kernlogik (Erinnerungsstichtage, Semesterbeginn, Wirkung einer Antwort) liegt
 * in `semester.ts` und ist dort ohne Postgres testbar.
 *
 * Token-Muster wie überall im System (magic-link, auskunft): Es wird nur der
 * SHA-256-Hash gespeichert, der Klartext lebt ausschließlich in der Mail-URL.
 * Der Link gewährt KEINE Sitzung — ein Klick meldet niemanden an, er setzt nur
 * die Rückmeldung an der Teilnahme.
 *
 * Rückmeldung an der Teilnahme: `eingeladenAm` (die Überleitung hat
 * eingeladen), `bestaetigtAm` („bin dabei"), `abgemeldetAm` + `abmeldeGrund`
 * („bin raus" bzw. keine Rückmeldung bis Semesterstart). Eine abgemeldete
 * Teilnahme zählt nicht — Filter `TEILNAHME_ZAEHLT` (`teilnahme-filter.ts`).
 *
 * Drei Wege neben dem Link, damit niemand zu Unrecht herausfällt:
 *  - Zusage von Hand (`trageZusageEin`): Die Schulleitung trägt eine Zusage
 *    ein, die am Telefon oder im Gespräch kam.
 *  - Nachversand (`bereiteNachversandVor`): Eine Einladung, die nie zugestellt
 *    wurde, geht mit frischem Link noch einmal raus — nur auf Knopfdruck.
 *  - Rückmeldung durch Teilnahme (`schliesseRueckmeldungen`): Wer zum
 *    Semesterstart schon am Unterricht teilnimmt, gilt als zurückgemeldet.
 * Die DB-freien Regeln dazu liegen in `ueberleitung-regel.ts`.
 */

import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/magic-link";
import { fuelleVorlage, sendeMail } from "@/lib/mailer";
import { zahl } from "@/lib/einstellungen";
import { protokolliere } from "@/lib/audit";
import { ABMELDEGRUND, MAIL_VORLAGE } from "@/lib/constants";
import { PERSON_ZAEHLT_AKTIV, TEILNAHME_ZAEHLT } from "@/lib/teilnahme-filter";
import {
  deutscherTag,
  erinnerungsFeld,
  erledigteStufenBeiEinladung,
  faelligeErinnerungsstufe,
  rueckmeldeFrist,
  rueckmeldeStand,
  rueckmeldungsWirkung,
  semesterHatBegonnen,
  semesterZeitraum,
  type Erinnerungsstufe,
  type RueckmeldeAntwort,
} from "@/lib/semester";
import {
  einladungNichtZugestellt,
  hatNutzungsspuren,
  UEBERLEITUNG_VORLAGEN,
  type VersandSpur,
} from "@/lib/ueberleitung-regel";

function bestaetigungsLink(token: string): string {
  const basis = process.env.APP_URL ?? "http://localhost:3000";
  // Token im URL-FRAGMENT (#) — wie beim Anmelde- und Auskunftslink: das
  // Fragment schickt der Browser nicht an den Server, es landet in keinem
  // Zugriffslog und kein Link-Scanner ruft es vorab ab.
  return `${basis}/dabei/token#token=${token}`;
}

/**
 * Eingeladen und noch ohne Antwort: Nur diese Teilnahmen bekommen Erinnerungen,
 * nur für sie gibt es „Zusage eintragen" und „Erneut senden", und nur sie
 * schließt der Worker zum Semesterstart ab (abmelden bzw. bei Teilnahme am
 * Unterricht als bestätigt werten). Direkt aufgenommene Teilnahmen (Aufnahme,
 * Sammelübernahme) tragen kein `eingeladenAm` und bleiben davon unberührt.
 */
const OFFENE_EINLADUNG = {
  eingeladenAm: { not: null },
  bestaetigtAm: null,
  abgemeldetAm: null,
} satisfies Prisma.TeilnahmeWhereInput;

/** So viele Einladungen gleichzeitig — so viele Verbindungen hält der Mail-Pool
 * offen (`maxConnections: 3` in `mailer.ts`); mehr würden dort nur warten. */
const VERSAND_PARALLEL = 3;

/**
 * Für welche Semester gerade Einladungen rausgehen (Zähler je Semester-Id).
 *
 * Solange der Versand läuft, fehlen die GESENDET-Zeilen in `email_versand` noch —
 * die Überleitungsseite zeigte jede dieser Einladungen als „nicht zugestellt".
 * Ein Klick auf „Erneut senden" in diesem Moment tauschte die Links, während die
 * Mails mit den alten Links noch rausgehen: jede Person bekäme zwei Mails, und
 * der Link in der ersten wäre schon ungültig. Deshalb sperrt ein laufender
 * Versand den Nachversand für sein Semester, und die Seite sagt „wird gerade
 * verschickt" statt einer falschen Zahl.
 *
 * Bewusst im Prozess und nicht in der Datenbank: Den Versand erledigt immer
 * dieser eine App-Prozess (`after()` nach der Antwort; der Worker verschickt
 * keine Einladungen). Bricht der Prozess ab, ist auch die Sperre weg — und die
 * abgebrochenen Einladungen gelten richtig als nicht zugestellt. Auf `globalThis`
 * wie der Prisma-Client in `db.ts`, damit Route, Seite und `after()` sicher
 * dieselbe Instanz sehen, auch wenn der Build das Modul je Einstieg bündelt.
 */
const imVersand: Map<string, number> = ((globalThis as { gbsUeberleitungImVersand?: Map<string, number> })
  .gbsUeberleitungImVersand ??= new Map<string, number>());

function versandBeginnt(semesterId: string): void {
  imVersand.set(semesterId, (imVersand.get(semesterId) ?? 0) + 1);
}

function versandEndet(semesterId: string): void {
  const rest = (imVersand.get(semesterId) ?? 1) - 1;
  if (rest > 0) imVersand.set(semesterId, rest);
  else imVersand.delete(semesterId);
}

/** Gehen für dieses Semester gerade Einladungen raus (Start oder Nachversand)? */
export function versandLaeuft(semesterId: string): boolean {
  return (imVersand.get(semesterId) ?? 0) > 0;
}

/** Die drei Erinnerungs-Offsets (Tage vor Semesterstart, Bereich SEMESTER) —
 * nebenläufig gelesen, gebraucht von der Einladung und vom Erinnerungslauf. */
async function ladeErinnerungsOffsets(): Promise<[number, number, number]> {
  const [stufe1, stufe2, stufe3] = await Promise.all([
    zahl("SEMESTER_ERINNERUNG_1_TAGE"),
    zahl("SEMESTER_ERINNERUNG_2_TAGE"),
    zahl("SEMESTER_ERINNERUNG_3_TAGE"),
  ]);
  return [stufe1, stufe2, stufe3];
}

/** Die Antwortfrist für Mail und Seite: „bis einschließlich TT.MM.JJJJ". */
function fristText(start: Date): string {
  return deutscherTag(rueckmeldeFrist(start));
}

/** Führt `arbeit` für alle Einträge aus, höchstens `n` gleichzeitig. */
async function mitHoechstens<T>(n: number, eintraege: T[], arbeit: (eintrag: T) => Promise<void>): Promise<void> {
  let naechster = 0;
  const arbeiter = Array.from({ length: Math.min(n, eintraege.length) }, async () => {
    while (naechster < eintraege.length) {
      const eintrag = eintraege[naechster++];
      await arbeit(eintrag);
    }
  });
  await Promise.all(arbeiter);
}

// -----------------------------------------------------------------------------
// Überleitung anstoßen
// -----------------------------------------------------------------------------

/** Eine angelegte Einladung samt Klartext-Token — lebt nur im Speicher, bis die
 * Mail raus ist; in der Datenbank steht nur der Hash. */
export type Einladung = { person: { id: string; vorname: string; email: string }; token: string };
export type EinladungsZiel = { id: string; code: string; bezeichnung: string; start: Date; ende: Date };

export type UeberleitungErgebnis =
  | { status: "ziel_fehlt" }
  | { status: "kein_laufendes" }
  | { status: "ziel_ist_laufendes" }
  | { status: "ziel_begonnen" }
  | { status: "ok"; eingeladen: number; ziel: EinladungsZiel; einladungen: Einladung[] };

/**
 * Lädt den Jahrgang des laufenden Semesters ins gewählte Folgesemester ein:
 * legt je Teilnehmer eine noch unbeantwortete Teilnahme (`eingeladenAm`) mit
 * persönlichem Link an und schreibt den Audit-Eintrag. Die Mails verschickt
 * `versendeEinladungen` — die Route stößt ihn NACH der Antwort an, damit die
 * Oberfläche nicht an der festen Zeitgrenze des Clients (30 s) scheitert,
 * während der Server bei 150 Empfängern noch verschickt.
 *
 * Idempotent: Wer im Zielsemester schon eine Teilnahme hat (früherer Lauf,
 * Aufnahme, auch eine abgemeldete), wird übersprungen — ein zweiter Aufruf lädt
 * niemanden doppelt ein. Auch zwei GLEICHZEITIGE Starts (zwei Tabs, zwei
 * Personen der Leitung) laden jeden nur einmal ein: Eingeladen wird nur, wessen
 * Teilnahme dieser Aufruf tatsächlich angelegt hat. Die Teilnahmeform wird aus
 * dem laufenden Semester übernommen, nie geraten. In ein Semester, das schon
 * begonnen hat, wird nicht eingeladen: Die Links wären sofort abgelaufen, und
 * der Worker meldete alle Eingeladenen binnen einer Stunde als „keine
 * Rückmeldung" ab.
 */
export async function starteUeberleitung(
  zielSemesterId: string,
  akteurId: string,
  headers: Headers,
): Promise<UeberleitungErgebnis> {
  const ziel = await prisma.semester.findUnique({ where: { id: zielSemesterId } });
  if (!ziel) return { status: "ziel_fehlt" };

  const laufend = await prisma.semester.findFirst({ where: { istAktuell: true } });
  if (!laufend) return { status: "kein_laufendes" };
  if (laufend.id === ziel.id) return { status: "ziel_ist_laufendes" };

  const jetzt = new Date();
  if (semesterHatBegonnen(ziel.start, jetzt)) return { status: "ziel_begonnen" };

  // Jeder Erinnerungs-Stichtag, der heute oder früher liegt, ist mit der
  // Einladung erledigt — sonst ginge am selben Tag eine Erinnerung hinterher,
  // deren frischer Link den der Einladung sofort entwertete (auch an T-7/T-3).
  const erledigteStufen = erledigteStufenBeiEinladung(ziel.start, jetzt, await ladeErinnerungsOffsets());
  const erledigtAm = (stufe: Erinnerungsstufe) => (erledigteStufen.includes(stufe) ? jetzt : null);

  // Suchen und Anlegen in EINER Transaktion — wie bei der Sammelübernahme,
  // damit ein Doppelklick nicht zweimal dieselben Teilnahmen zu erzeugen
  // versucht.
  const neue = await prisma.$transaction(async (tx) => {
    const quelle = await tx.teilnahme.findMany({
      // Der Jahrgang ist, wer im laufenden Semester zählt: Status aktiv UND
      // nicht für dieses Semester abgemeldet.
      where: { semesterId: laufend.id, ...TEILNAHME_ZAEHLT, person: PERSON_ZAEHLT_AKTIV },
      select: { teilnahmeform: true, person: { select: { id: true, vorname: true, email: true } } },
    });
    const imZiel = await tx.teilnahme.findMany({
      where: { semesterId: ziel.id },
      select: { personId: true },
    });
    const bereits = new Set(imZiel.map((t) => t.personId));

    const anzulegen = quelle
      .filter((t) => !bereits.has(t.person.id))
      .map((t) => ({ person: t.person, teilnahmeform: t.teilnahmeform, token: randomUUID() }));

    if (anzulegen.length === 0) return anzulegen;

    const angelegt = await tx.teilnahme.createManyAndReturn({
      // Der Link gilt bis zum Semesterstart — bis dahin kann man „bin dabei"
      // oder „bin raus" sagen. Danach räumt ihn der Aufräumlauf weg;
      // `eingeladenAm` bleibt stehen.
      data: anzulegen.map((a) => ({
        personId: a.person.id,
        semesterId: ziel.id,
        teilnahmeform: a.teilnahmeform,
        bestaetigungTokenHash: hashToken(a.token),
        bestaetigungLaeuftAb: ziel.start,
        eingeladenAm: jetzt,
        erinnertStufe1Am: erledigtAm(1),
        erinnertStufe2Am: erledigtAm(2),
        erinnertStufe3Am: erledigtAm(3),
      })),
      // Zweite Sicherung gegen den Unique-Index (personId, semesterId): eine
      // Doppelanlage darf die Überleitung nie mit einem 500 beenden.
      skipDuplicates: true,
      select: { personId: true },
    });

    // Nur wer hier WIRKLICH angelegt wurde, bekommt eine Einladung. Läuft ein
    // zweiter Start gleichzeitig, lesen beide Transaktionen (READ COMMITTED)
    // ein leeres Zielsemester; skipDuplicates verwirft beim späteren die
    // Zeilen lautlos. Ohne diesen Abgleich ginge trotzdem eine zweite Mail raus
    // — mit einem Link, dessen Hash nie gespeichert wurde, ausgerechnet in der
    // NEUESTEN Mail.
    const neuAngelegt = new Set(angelegt.map((t) => t.personId));
    return anzulegen.filter((a) => neuAngelegt.has(a.person.id));
  });

  // Der Nachweis steht sofort, nicht erst nach dem Versand: Bricht der Prozess
  // mitten im Verschicken ab, ist trotzdem festgehalten, wer eingeladen wurde.
  // Den Versandstand trägt `versendeEinladungen` als eigenen Eintrag nach.
  await protokolliere({
    aktion: "SEMESTER_UEBERLEITUNG_GESTARTET",
    objektTyp: "Semester",
    objektId: ziel.id,
    akteurId,
    nachher: { von: laufend.code, nach: ziel.code, eingeladen: neue.length, erledigteStufen },
    headers,
  });

  return {
    status: "ok",
    eingeladen: neue.length,
    ziel: { id: ziel.id, code: ziel.code, bezeichnung: ziel.bezeichnung, start: ziel.start, ende: ziel.ende },
    einladungen: neue.map((a) => ({ person: a.person, token: a.token })),
  };
}

export type EinladungsVersand = { eingeladen: number; gesendet: number; fehlgeschlagen: number };

/**
 * Verschickt die Einladungen einer gestarteten Überleitung, höchstens drei
 * gleichzeitig (so viele Verbindungen hält der Mail-Pool). Läuft nach der
 * Antwort an die Oberfläche (`after()` in der Route) und wirft nie: Jeder
 * Versand steht ohnehin einzeln in `email_versand` (Betriebsansicht), und am
 * Ende hält ein Audit-Eintrag fest, wie viele Einladungen rausgingen.
 *
 * Ging eine Einladung nicht raus, bleibt ihr Link trotzdem gültig; einen
 * frischen Link bringt die nächste Erinnerung (T-14/-7/-3) — aber nur, wenn noch
 * ein Stichtag aussteht. Startet die Überleitung am letzten Stichtag oder später,
 * sind alle Stufen schon mit der Einladung erledigt (`erledigteStufenBeiEinladung`):
 * Eine gescheiterte Einladung wird dann nie wiederholt, die Person zum Start als
 * KEINE_RUECKMELDUNG abgemeldet (zurück nur einzeln über „Wieder aufnehmen“). Die
 * Überleitungsseite weist beim Start darauf hin — und bietet für jede nicht
 * zugestellte Einladung bis zum Vortag des Starts „Erneut senden“
 * (`bereiteNachversandVor`, verschickt ebenfalls über diese Funktion).
 *
 * Während des Versands gilt das Semester als „im Versand“ (`versandLaeuft`) —
 * so lange ist kein Nachversand möglich. `erneut` kennzeichnet den Audit-Eintrag
 * eines Nachversands.
 */
export async function versendeEinladungen(
  ziel: EinladungsZiel,
  einladungen: Einladung[],
  akteurId: string,
  optionen: { erneut?: boolean } = {},
): Promise<EinladungsVersand> {
  if (einladungen.length === 0) return { eingeladen: 0, gesendet: 0, fehlgeschlagen: 0 };

  versandBeginnt(ziel.id);
  try {
    let gesendet = 0;
    try {
      const vorlage = await prisma.emailVorlage.findUnique({
        where: { code: MAIL_VORLAGE.UEBERLEITUNG_EINLADUNG },
      });
      const zeitraum = semesterZeitraum(ziel.start, ziel.ende);
      const frist = fristText(ziel.start);

      await mitHoechstens(VERSAND_PARALLEL, einladungen, async (einladung) => {
        const werte = {
          vorname: einladung.person.vorname,
          semester: ziel.bezeichnung,
          zeitraum,
          frist,
          link: bestaetigungsLink(einladung.token),
        };
        try {
          const { gesendet: ok } = await sendeMail({
            an: einladung.person.email,
            personId: einladung.person.id,
            vorlageCode: MAIL_VORLAGE.UEBERLEITUNG_EINLADUNG,
            betreff: fuelleVorlage(vorlage?.betreff ?? "Sind Sie im {{semester}} dabei?", werte),
            text: fuelleVorlage(
              vorlage?.textMd ??
                "Hallo {{vorname}},\n\nsind Sie im {{semester}} ({{zeitraum}}) dabei? Bitte antworten Sie bis einschließlich {{frist}} über diesen Link:\n\n{{link}}",
              werte,
            ),
          });
          if (ok) gesendet++;
        } catch (fehler) {
          console.error("[UEBERLEITUNG] Einladung fehlgeschlagen für Person", einladung.person.id, fehler);
        }
      });
    } catch (fehler) {
      console.error("[UEBERLEITUNG] Einladungsversand abgebrochen:", fehler);
    }

    const bericht = { eingeladen: einladungen.length, gesendet, fehlgeschlagen: einladungen.length - gesendet };
    await protokolliere({
      aktion: "SEMESTER_UEBERLEITUNG_VERSENDET",
      objektTyp: "Semester",
      objektId: ziel.id,
      akteurId,
      nachher: { nach: ziel.code, ...bericht, ...(optionen.erneut ? { erneut: true } : {}) },
    });
    return bericht;
  } finally {
    versandEndet(ziel.id);
  }
}

// -----------------------------------------------------------------------------
// Nicht zugestellte Einladungen erneut senden (Knopf auf der Überleitungsseite)
// -----------------------------------------------------------------------------

/**
 * Die Versandzeilen der Überleitungs-Mails je Person, frühestens ab `seit` —
 * die Eingabe für `einladungNichtZugestellt`.
 */
async function ladeVersandspuren(personIds: string[], seit: Date): Promise<Map<string, VersandSpur[]>> {
  const spuren = new Map<string, VersandSpur[]>();
  if (personIds.length === 0) return spuren;
  const zeilen = await prisma.emailVersand.findMany({
    where: { personId: { in: personIds }, vorlageCode: { in: [...UEBERLEITUNG_VORLAGEN] }, erstelltAm: { gte: seit } },
    select: { personId: true, vorlageCode: true, status: true, erstelltAm: true },
  });
  for (const zeile of zeilen) {
    if (!zeile.personId) continue;
    const liste = spuren.get(zeile.personId);
    if (liste) liste.push(zeile);
    else spuren.set(zeile.personId, [zeile]);
  }
  return spuren;
}

/**
 * Die offenen Einladungen eines Semesters, deren Link nie zugestellt wurde
 * (Regel: `einladungNichtZugestellt`). EINE Abfrage für die Zahl „Einladung
 * nicht zugestellt" auf der Überleitungsseite und für „Erneut senden" — sonst
 * zeigte die Seite eine Zahl, die der Knopf nicht einlöst.
 *
 * Nur aktive Personen, wie bei der Überleitung selbst: Wer seit der Einladung
 * ausgeschieden ist, bekommt keine zweite Einladung.
 */
export async function ladeNichtZugestellte(semesterId: string) {
  const offene = await prisma.teilnahme.findMany({
    where: { semesterId, ...OFFENE_EINLADUNG, person: PERSON_ZAEHLT_AKTIV },
    select: {
      id: true,
      eingeladenAm: true,
      bestaetigtAm: true,
      abgemeldetAm: true,
      bestaetigungTokenHash: true,
      person: { select: { id: true, vorname: true, email: true } },
    },
  });
  if (offene.length === 0) return [];

  // Ältere Zeilen gehören zu früheren Überleitungen und zählen ohnehin nicht.
  const seit = new Date(Math.min(...offene.map((t) => t.eingeladenAm?.getTime() ?? 0)));
  const spuren = await ladeVersandspuren(offene.map((t) => t.person.id), seit);
  return offene.filter((t) => einladungNichtZugestellt(t, spuren.get(t.person.id) ?? []));
}

export type NachversandErgebnis =
  | { status: "ziel_fehlt" }
  | { status: "ziel_begonnen" }
  | { status: "versand_laeuft" }
  | {
      status: "ok";
      /** So viele Einladungen gehen erneut raus. */
      anzahl: number;
      /** Der Versand — die Route stößt ihn NACH der Antwort an (`after`). Null, wenn nichts zu senden ist. */
      versand: (() => Promise<void>) | null;
    };

/**
 * Bereitet „Erneut senden" vor: Jede offene Einladung des Semesters, die nie
 * zugestellt wurde (`ladeNichtZugestellte`), bekommt einen frischen Link — der
 * alte kam ja nie an. Gespeichert wird wie bei der Einladung nur der Hash; der
 * Link gilt bis zum Semesterstart. Den Versand liefert das Ergebnis als
 * Funktion, die die Route per `after()` nach der Antwort ausführt (derselbe Weg
 * wie beim Start, `versendeEinladungen`). Die Zahl der Einladungen und die
 * Teilnahmen stehen sofort im Audit (SEMESTER_EINLADUNG_ERNEUT_GESENDET), den
 * Versandstand trägt `versendeEinladungen` nach (SEMESTER_UEBERLEITUNG_VERSENDET
 * mit `erneut: true`).
 *
 * Nur vor Semesterstart — danach nimmt der Link keine Antwort mehr an. Nur auf
 * Knopfdruck: Ein automatischer Nachversand durch den Worker schriebe eine
 * dauerhaft abgewiesene Adresse jede Stunde erneut an.
 *
 * Sicher gegen Doppelklick und zwei Tabs: Das Semester wird schon hier als „im
 * Versand" vorgemerkt (Prüfen und Vormerken ohne `await` dazwischen) und bleibt
 * es, bis die gelieferte Versand-Funktion fertig ist — ein zweiter Aufruf
 * bekommt `versand_laeuft`. Der Linktausch ist zusätzlich an den bisherigen Hash
 * gebunden: Hat der Erinnerungslauf gerade erfolgreich einen Link zugestellt und
 * getauscht, bleibt dessen Link stehen, und diese Person bekommt keine zweite Mail.
 *
 * WICHTIG für Aufrufer: Liefert das Ergebnis eine Versand-Funktion, MUSS sie
 * ausgeführt werden — erst ihr Ende gibt das Semester wieder frei.
 */
export async function bereiteNachversandVor(
  semesterId: string,
  akteurId: string,
  headers: Headers,
): Promise<NachversandErgebnis> {
  const ziel = await prisma.semester.findUnique({ where: { id: semesterId } });
  if (!ziel) return { status: "ziel_fehlt" };
  if (semesterHatBegonnen(ziel.start, new Date())) return { status: "ziel_begonnen" };

  if (versandLaeuft(ziel.id)) return { status: "versand_laeuft" };
  versandBeginnt(ziel.id);

  const einladungen: (Einladung & { teilnahmeId: string })[] = [];
  try {
    const betroffen = await ladeNichtZugestellte(ziel.id);
    for (const t of betroffen) {
      const token = randomUUID();
      const getauscht = await prisma.teilnahme.updateMany({
        where: { id: t.id, ...OFFENE_EINLADUNG, bestaetigungTokenHash: t.bestaetigungTokenHash },
        data: { bestaetigungTokenHash: hashToken(token), bestaetigungLaeuftAb: ziel.start },
      });
      if (getauscht.count === 1) einladungen.push({ person: t.person, token, teilnahmeId: t.id });
    }
  } catch (fehler) {
    versandEndet(ziel.id);
    throw fehler;
  }

  await protokolliere({
    aktion: "SEMESTER_EINLADUNG_ERNEUT_GESENDET",
    objektTyp: "Semester",
    objektId: ziel.id,
    akteurId,
    nachher: { code: ziel.code, anzahl: einladungen.length, teilnahmeIds: einladungen.map((e) => e.teilnahmeId) },
    headers,
  });

  if (einladungen.length === 0) {
    versandEndet(ziel.id);
    return { status: "ok", anzahl: 0, versand: null };
  }

  const zielDaten: EinladungsZiel = {
    id: ziel.id,
    code: ziel.code,
    bezeichnung: ziel.bezeichnung,
    start: ziel.start,
    ende: ziel.ende,
  };
  return {
    status: "ok",
    anzahl: einladungen.length,
    versand: async () => {
      try {
        await versendeEinladungen(zielDaten, einladungen, akteurId, { erneut: true });
      } finally {
        versandEndet(zielDaten.id);
      }
    },
  };
}

// -----------------------------------------------------------------------------
// „Ich bin dabei" / „Ich bin raus" beantworten
// -----------------------------------------------------------------------------

export type RueckmeldeErgebnis =
  | {
      status: "ok" | "schon_bestaetigt" | "abgemeldet" | "schon_abgemeldet";
      semester: string;
      vorname: string;
      faecher: string[];
      teilnahmeId: string;
      personId: string;
      /** Stand vor dieser Antwort — für den Audit-Eintrag einer geänderten Antwort. */
      vorher: "offen" | "bestaetigt" | "abgemeldet";
      /** Letzter Tag, an dem sich die Antwort noch ändern lässt („TT.MM.JJJJ"). */
      frist: string;
    }
  | { status: "ungueltig" }
  | { status: "geschlossen" };

/**
 * Die Fächer (Kurseinheiten) eines Semesters — über die Kopplung
 * `Semester.lehrjahr`/`halbjahr` ins Kursraster. Leer, wenn das Semester nicht
 * verortet ist (dann zeigt die „bin dabei"-Seite einfach keine Fächer).
 */
async function faecherDesSemesters(lehrjahr: number | null, halbjahr: number | null): Promise<string[]> {
  if (lehrjahr === null || halbjahr === null) return [];
  const kurse = await prisma.kurseinheit.findMany({
    where: { jahrgangsjahr: lehrjahr, halbjahr, aktiv: true },
    orderBy: [{ sortierung: "asc" }, { titel: "asc" }],
    select: { titel: true },
  });
  return kurse.map((k) => k.titel);
}

/**
 * Löst einen Link mit der Antwort „dabei" oder „raus" ein. Idempotent und
 * race-sicher (bedingtes updateMany): Ein zweiter Klick mit derselben Antwort
 * meldet freundlich „steht schon so", nie einen Fehler. Es entsteht KEINE
 * Sitzung.
 *
 * Bis zum Vortag des Semesterstarts darf eine spätere Antwort die frühere
 * ändern (Regel und Begründung: `rueckmeldungsWirkung` in `semester.ts`). Ab dem
 * Starttag ist die Rückmeldung geschlossen — dieselbe Kalendertag-Grenze, ab der
 * der Worker unbeantwortete Einladungen abmeldet.
 *
 *  - „dabei": setzt `bestaetigtAm` und hebt eine eigene Absage auf.
 *  - „raus": setzt `abgemeldetAm` + BIN_RAUS und nimmt eine Zusage zurück
 *    (`bestaetigtAm` = null), damit sich die Zustände ausschließen.
 */
export async function beantworteEinladung(
  token: string,
  antwort: RueckmeldeAntwort,
  jetzt: Date = new Date(),
): Promise<RueckmeldeErgebnis> {
  const eintrag = await prisma.teilnahme.findUnique({
    where: { bestaetigungTokenHash: hashToken(token) },
    select: {
      id: true,
      bestaetigtAm: true,
      abgemeldetAm: true,
      abmeldeGrund: true,
      bestaetigungLaeuftAb: true,
      semester: { select: { bezeichnung: true, lehrjahr: true, halbjahr: true, start: true } },
      person: { select: { id: true, vorname: true } },
    },
  });
  if (!eintrag) return { status: "ungueltig" };
  // Erst die Kalendertag-Grenze (verständlichere Meldung), dann das technische
  // Ablaufdatum des Tokens.
  if (semesterHatBegonnen(eintrag.semester.start, jetzt)) return { status: "geschlossen" };
  if (!eintrag.bestaetigungLaeuftAb || eintrag.bestaetigungLaeuftAb < jetzt) {
    return { status: "ungueltig" };
  }

  const wirkung = rueckmeldungsWirkung(eintrag, antwort);
  if (wirkung === "gesperrt") return { status: "geschlossen" };

  const gemeinsam = {
    semester: eintrag.semester.bezeichnung,
    vorname: eintrag.person.vorname,
    // Die Fächer zeigt nur die Zusage — wer absagt, braucht keine Vorschau.
    faecher: antwort === "dabei" ? await faecherDesSemesters(eintrag.semester.lehrjahr, eintrag.semester.halbjahr) : [],
    teilnahmeId: eintrag.id,
    personId: eintrag.person.id,
    vorher: eintrag.abgemeldetAm ? ("abgemeldet" as const) : eintrag.bestaetigtAm ? ("bestaetigt" as const) : ("offen" as const),
    frist: fristText(eintrag.semester.start),
  };

  if (antwort === "dabei") {
    if (wirkung === "schon") return { status: "schon_bestaetigt", ...gemeinsam };
    // Nur aus „offen" oder aus der EIGENEN Absage heraus — eine vom Worker
    // gesetzte „keine Rückmeldung" hebt nur die Schulleitung auf.
    const gesetzt = await prisma.teilnahme.updateMany({
      where: {
        id: eintrag.id,
        OR: [{ bestaetigtAm: null, abgemeldetAm: null }, { abmeldeGrund: ABMELDEGRUND.BIN_RAUS }],
      },
      data: { bestaetigtAm: jetzt, abgemeldetAm: null, abmeldeGrund: null },
    });
    return { status: gesetzt.count === 1 ? "ok" : "schon_bestaetigt", ...gemeinsam };
  }

  if (wirkung === "schon") return { status: "schon_abgemeldet", ...gemeinsam };
  const gesetzt = await prisma.teilnahme.updateMany({
    where: { id: eintrag.id, abgemeldetAm: null },
    data: { abgemeldetAm: jetzt, abmeldeGrund: ABMELDEGRUND.BIN_RAUS, bestaetigtAm: null },
  });
  return { status: gesetzt.count === 1 ? "abgemeldet" : "schon_abgemeldet", ...gemeinsam };
}

// -----------------------------------------------------------------------------
// Zusage von Hand (Schulleitung, etwa nach einem Anruf)
// -----------------------------------------------------------------------------

export type ZusageErgebnis =
  | { status: "ok" }
  | { status: "unbekannt" }
  | { status: "abgemeldet" }
  | { status: "bestaetigt" }
  | { status: "ohne_einladung" }
  | { status: "nicht_aktiv"; statusBezeichnung: string }
  | { status: "gerade_geaendert" };

/**
 * Trägt für eine offene Einladung die Zusage ein, die nicht über den Link kam —
 * am Telefon, im Gespräch, auf Papier. Ohne sie meldete der Lauf zum
 * Semesterstart die Person als „keine Rückmeldung" ab, obwohl sie zugesagt hat.
 *
 * Nur aus „offen" heraus (bedingtes updateMany auf `OFFENE_EINLADUNG`, atomar):
 * Eine abgemeldete Teilnahme holt „Wieder aufnehmen" zurück, eine bestätigte ist
 * schon dabei, eine direkt aufgenommene zählt ohnehin. Wer nicht (mehr) aktiv
 * ist, stünde trotz Zusage in keiner Liste — das wäre ein Erfolg, der nichts
 * bewirkt (dieselbe Sperre wie bei „Wieder aufnehmen").
 *
 * Der Link der Person bleibt gültig: Bis zum Vortag des Starts darf sie ihre
 * Antwort selbst noch ändern, wie nach einer Zusage über den Link.
 */
export async function trageZusageEin(teilnahmeId: string, akteurId: string, headers: Headers): Promise<ZusageErgebnis> {
  const teilnahme = await prisma.teilnahme.findUnique({
    where: { id: teilnahmeId },
    select: {
      eingeladenAm: true,
      bestaetigtAm: true,
      abgemeldetAm: true,
      semester: { select: { code: true } },
      person: { select: { status: { select: { istAktiv: true, bezeichnung: true } } } },
    },
  });
  if (!teilnahme) return { status: "unbekannt" };

  const stand = rueckmeldeStand(teilnahme);
  if (stand === "abgemeldet") return { status: "abgemeldet" };
  if (stand === "bestaetigt") return { status: "bestaetigt" };
  if (stand === "ohne_einladung") return { status: "ohne_einladung" };
  if (!teilnahme.person.status.istAktiv) {
    return { status: "nicht_aktiv", statusBezeichnung: teilnahme.person.status.bezeichnung };
  }

  const jetzt = new Date();
  const gesetzt = await prisma.teilnahme.updateMany({
    where: { id: teilnahmeId, ...OFFENE_EINLADUNG },
    data: { bestaetigtAm: jetzt },
  });
  // Zwischen Lesen und Schreiben hat die Person selbst geantwortet oder der
  // Lauf zum Semesterstart hat abgemeldet — kein zweiter Eintrag.
  if (gesetzt.count !== 1) return { status: "gerade_geaendert" };

  await protokolliere({
    aktion: "TEILNAHME_ZUSAGE_EINGETRAGEN",
    objektTyp: "Teilnahme",
    objektId: teilnahmeId,
    akteurId,
    // Als ISO-Text: `protokolliere` bereinigt Objekte feldweise und machte aus
    // einem Date-Objekt ein leeres `{}`.
    nachher: { semester: teilnahme.semester.code, bestaetigtAm: jetzt.toISOString() },
    headers,
  });
  return { status: "ok" };
}

// -----------------------------------------------------------------------------
// Semesterstart verschoben (PUT /api/semester/[id])
// -----------------------------------------------------------------------------

/** Wie viele Eingeladene eines Semesters noch nicht geantwortet haben. */
export async function zaehleOffeneEinladungen(semesterId: string): Promise<number> {
  return prisma.teilnahme.count({ where: { semesterId, ...OFFENE_EINLADUNG } });
}

/**
 * Zieht die Frist aller noch gültigen Links eines Semesters auf den (neuen)
 * Semesterstart nach — in DERSELBEN Transaktion, die den Start ändert. Der Link
 * gilt bis Semesterstart (Einladung und Erinnerung setzen
 * `bestaetigungLaeuftAb = start`). Ohne das Nachziehen liefe er nach einer
 * Verschiebung nach hinten am alten Datum ab: `beantworteEinladung` antwortete
 * „abgelaufen", obwohl Mail und Seite eine Antwort bis zum Tag vor dem (neuen)
 * Beginn zusagen. Liefert die Zahl der nachgezogenen Links.
 */
export async function ziehLinkfristNach(
  tx: Prisma.TransactionClient,
  semesterId: string,
  start: Date,
): Promise<number> {
  const { count } = await tx.teilnahme.updateMany({
    where: { semesterId, bestaetigungTokenHash: { not: null } },
    data: { bestaetigungLaeuftAb: start },
  });
  return count;
}

// -----------------------------------------------------------------------------
// Ab Semesterstart: Eingeladene ohne Antwort abmelden (Worker)
// -----------------------------------------------------------------------------

export type AbmeldeBericht = {
  semesterCode: string;
  /** Als KEINE_RUECKMELDUNG abgemeldet. */
  abgemeldet: number;
  /** Ohne Antwort, aber schon im Unterricht — als bestätigt gewertet. */
  durchTeilnahme: number;
};

/**
 * Schließt ab Semesterstart jede eingeladene Teilnahme ohne Antwort ab:
 *
 *  - Hat sie im Zielsemester schon Nutzungsspuren (eine Anwesenheit „anwesend"
 *    oder „nachgearbeitet", oder eine Leistung — `hatNutzungsspuren`), gilt die
 *    Teilnahme am Unterricht als Rückmeldung: `bestaetigtAm` wird gesetzt, die
 *    Person bleibt in allen Listen. Das trifft vor allem den Nachholfall nach
 *    einem längeren Worker-Ausfall — früher fielen dabei auch Personen heraus,
 *    die längst in der Anwesenheitsliste standen.
 *  - Sonst wird sie abgemeldet (Grund KEINE_RUECKMELDUNG) und fällt aus allen
 *    Listen dieses Semesters. Der Personenstatus bleibt unverändert; die
 *    Schulleitung kann einzeln wieder aufnehmen.
 *
 * Bericht und Audit zählen beide Wege getrennt (TEILNAHME_OHNE_RUECKMELDUNG_ABGEMELDET
 * bzw. TEILNAHME_RUECKMELDUNG_DURCH_TEILNAHME, je mit Anzahl und Teilnahme-Ids).
 *
 * „Ab Semesterstart" ist die Kalendertag-Grenze aus `semesterHatBegonnen`
 * (Wanduhr Europe/Berlin), dieselbe, ab der der Link keine Antwort mehr annimmt.
 * Idempotent: Je Teilnahme ein bedingtes updateMany auf „noch offen"; ein
 * zweiter Lauf findet niemanden mehr. Weil `eingeladenAm` den Aufräumlauf
 * überlebt, holt ein Lauf nach einem längeren Worker-Ausfall auch Semester nach,
 * deren Token längst gelöscht sind.
 */
export async function schliesseRueckmeldungen(jetzt: Date): Promise<AbmeldeBericht[]> {
  const kandidaten = await prisma.semester.findMany({
    where: { teilnahmen: { some: OFFENE_EINLADUNG } },
    select: { id: true, code: true, start: true },
  });

  const berichte: AbmeldeBericht[] = [];
  for (const s of kandidaten) {
    if (!semesterHatBegonnen(s.start, jetzt)) continue;

    const offene = await prisma.teilnahme.findMany({
      where: { semesterId: s.id, ...OFFENE_EINLADUNG },
      select: {
        id: true,
        anwesenheiten: { select: { status: true } },
        _count: { select: { leistungen: true } },
      },
    });
    const abgemeldet: string[] = [];
    const durchTeilnahme: string[] = [];
    for (const t of offene) {
      if (hatNutzungsspuren({ anwesenheiten: t.anwesenheiten, leistungen: t._count.leistungen })) {
        const bestaetigt = await prisma.teilnahme.updateMany({
          where: { id: t.id, ...OFFENE_EINLADUNG },
          data: { bestaetigtAm: jetzt },
        });
        if (bestaetigt.count === 1) durchTeilnahme.push(t.id);
        continue;
      }
      const gesetzt = await prisma.teilnahme.updateMany({
        where: { id: t.id, ...OFFENE_EINLADUNG },
        data: { abgemeldetAm: jetzt, abmeldeGrund: ABMELDEGRUND.KEINE_RUECKMELDUNG },
      });
      if (gesetzt.count === 1) abgemeldet.push(t.id);
    }

    if (abgemeldet.length > 0 || durchTeilnahme.length > 0) {
      berichte.push({ semesterCode: s.code, abgemeldet: abgemeldet.length, durchTeilnahme: durchTeilnahme.length });
    }
    if (abgemeldet.length > 0) {
      await protokolliere({
        aktion: "TEILNAHME_OHNE_RUECKMELDUNG_ABGEMELDET",
        objektTyp: "Semester",
        objektId: s.id,
        quelle: "SYSTEM",
        nachher: { code: s.code, anzahl: abgemeldet.length, teilnahmeIds: abgemeldet },
      });
    }
    if (durchTeilnahme.length > 0) {
      await protokolliere({
        aktion: "TEILNAHME_RUECKMELDUNG_DURCH_TEILNAHME",
        objektTyp: "Semester",
        objektId: s.id,
        quelle: "SYSTEM",
        nachher: { code: s.code, anzahl: durchTeilnahme.length, teilnahmeIds: durchTeilnahme },
      });
    }
  }
  return berichte;
}

// -----------------------------------------------------------------------------
// Erinnerungslauf T-14/-7/-3 (Cron)
// -----------------------------------------------------------------------------

export type ErinnerungBericht = {
  semesterCode: string;
  stufe: Erinnerungsstufe;
  angeschrieben: number;
  gesendet: number;
};

type StufeFeld = "erinnertStufe1Am" | "erinnertStufe2Am" | "erinnertStufe3Am";

type StufenMarke = {
  /** where: diese Stufe ist noch nicht raus. */
  offen: Prisma.TeilnahmeWhereInput;
  /** where: genau DIESE Marke (Zeitpunkt) steht — für den Link-Tausch nach dem Versand. */
  gesetzt: Prisma.TeilnahmeWhereInput;
  setzen: Prisma.TeilnahmeUpdateManyMutationInput;
};

/**
 * Baut die where/data-Teile für die Stufen-Spalte typsicher (kein dynamischer
 * Schlüssel in Prisma-Inputs — deshalb explizit je Stufe).
 */
function stufenMarke(feld: StufeFeld, zeitpunkt: Date): StufenMarke {
  switch (feld) {
    case "erinnertStufe1Am":
      return {
        offen: { erinnertStufe1Am: null },
        gesetzt: { erinnertStufe1Am: zeitpunkt },
        setzen: { erinnertStufe1Am: zeitpunkt },
      };
    case "erinnertStufe2Am":
      return {
        offen: { erinnertStufe2Am: null },
        gesetzt: { erinnertStufe2Am: zeitpunkt },
        setzen: { erinnertStufe2Am: zeitpunkt },
      };
    case "erinnertStufe3Am":
      return {
        offen: { erinnertStufe3Am: null },
        gesetzt: { erinnertStufe3Am: zeitpunkt },
        setzen: { erinnertStufe3Am: zeitpunkt },
      };
  }
}

/**
 * Verschickt die heute fälligen Erinnerungen an Eingeladene ohne Antwort. Für
 * jedes Semester mit offenen Einladungen wird geprüft, ob heute ein Stichtag
 * (T-14/-7/-3, konfigurierbar) ist; wenn ja, gehen an alle offenen Teilnahmen
 * dieser Stufe (noch nicht angeschrieben, Person mit `automatikMails`)
 * Erinnerungen. Wer zu- oder abgesagt hat, bekommt keine.
 *
 * Idempotent und race-sicher: Die Stufen-Marke wird VOR dem Versand per
 * bedingtem updateMany gesetzt; nur wer sie setzt, verschickt — ein doppelter
 * Lauf am selben Tag schreibt niemandem zweimal.
 *
 * Link: Jede Erinnerung trägt einen frischen Link (der Klartext des alten ist
 * nirgends gespeichert). Der Tausch in der Datenbank passiert aber erst NACH
 * dem erfolgreichen Versand — eine gescheiterte Erinnerung entwertet den
 * bisher gültigen Link nicht. Eine erfolgreiche Erinnerung entwertet ältere
 * Links („bitte den Link aus der neuesten E-Mail verwenden").
 *
 * Fehlschlag: Die Stufen-Marke bleibt stehen — die Stufe gilt als versucht, der
 * alte Link bleibt gültig, und die nächste Stufe versucht es erneut. Genau ein
 * Versuch je Person und Stufe also. Vorher nahm der Lauf die Marke zurück und
 * wiederholte stündlich ohne Obergrenze: bei SMTP-Ausfall oder einer dauerhaft
 * abgewiesenen Adresse bis zu 24 FEHLER-Zeilen je Person und Stichtag, dazu
 * wiederholte Zustellversuche an dieselbe tote Adresse. Jeder Fehlschlag steht
 * einzeln in `email_versand` (Betriebsansicht); ins Audit kommt ein Lauf nur,
 * wenn er tatsächlich etwas zugestellt hat.
 */
export async function fuehreErinnerungslauf(jetzt: Date): Promise<ErinnerungBericht[]> {
  const offsets = await ladeErinnerungsOffsets();

  const semester = await prisma.semester.findMany({
    where: { teilnahmen: { some: OFFENE_EINLADUNG } },
  });

  const vorlage = await prisma.emailVorlage.findUnique({
    where: { code: MAIL_VORLAGE.UEBERLEITUNG_ERINNERUNG },
  });

  const berichte: ErinnerungBericht[] = [];

  for (const s of semester) {
    const stufe = faelligeErinnerungsstufe(s.start, jetzt, offsets);
    if (!stufe) continue;
    const feld = erinnerungsFeld(stufe);

    const offene = await prisma.teilnahme.findMany({
      where: {
        semesterId: s.id,
        ...OFFENE_EINLADUNG,
        person: { status: { automatikMails: true } },
      },
      select: {
        id: true,
        erinnertStufe1Am: true,
        erinnertStufe2Am: true,
        erinnertStufe3Am: true,
        person: { select: { id: true, vorname: true, email: true } },
      },
    });

    const zeitraum = semesterZeitraum(s.start, s.ende);
    const frist = fristText(s.start);
    let angeschrieben = 0;
    let gesendet = 0;

    for (const t of offene) {
      if (t[feld] !== null) continue; // diese Stufe schon raus bzw. versucht
      const marke = stufenMarke(feld, new Date());

      // 1. Stufe beanspruchen (Marke vor Versand) — nur ein Lauf gewinnt.
      const beansprucht = await prisma.teilnahme.updateMany({
        where: { id: t.id, ...OFFENE_EINLADUNG, ...marke.offen },
        data: marke.setzen,
      });
      if (beansprucht.count !== 1) continue; // paralleler Lauf war schneller

      angeschrieben++;
      const token = randomUUID();
      const werte = {
        vorname: t.person.vorname,
        semester: s.bezeichnung,
        zeitraum,
        frist,
        link: bestaetigungsLink(token),
      };
      let ok = false;
      try {
        ({ gesendet: ok } = await sendeMail({
          an: t.person.email,
          personId: t.person.id,
          vorlageCode: MAIL_VORLAGE.UEBERLEITUNG_ERINNERUNG,
          betreff: fuelleVorlage(vorlage?.betreff ?? "Erinnerung: Sind Sie im {{semester}} dabei?", werte),
          text: fuelleVorlage(
            vorlage?.textMd ??
              "Hallo {{vorname}},\n\nfür {{semester}} ({{zeitraum}}) fehlt uns noch Ihre Rückmeldung. Bitte antworten Sie bis einschließlich {{frist}} über diesen Link (ältere Links gelten nicht mehr):\n\n{{link}}",
            werte,
          ),
        }));
      } catch (fehler) {
        console.error("[UEBERLEITUNG] Erinnerung fehlgeschlagen für Teilnahme", t.id, fehler);
      }

      // 2. Erst nach dem Versand: bei Zustellung den Link tauschen. Nicht
      //    zugestellt: nichts tun — die Marke bleibt (Stufe versucht), der alte
      //    Link bleibt gültig, die nächste Stufe versucht es erneut.
      if (!ok) continue;
      gesendet++;
      try {
        await prisma.teilnahme.updateMany({
          where: { id: t.id, ...marke.gesetzt },
          data: { bestaetigungTokenHash: hashToken(token), bestaetigungLaeuftAb: s.start },
        });
      } catch (fehler) {
        console.error("[UEBERLEITUNG] Erinnerung nicht nachgetragen für Teilnahme", t.id, fehler);
      }
    }

    if (angeschrieben > 0) berichte.push({ semesterCode: s.code, stufe, angeschrieben, gesendet });
    // Ins append-only Audit nur ein Lauf, der wirklich etwas zugestellt hat —
    // Fehlschläge stehen einzeln in `email_versand` (Betriebsansicht).
    if (gesendet > 0) {
      await protokolliere({
        aktion: "SEMESTER_ERINNERUNG_GELAUFEN",
        objektTyp: "Semester",
        objektId: s.id,
        quelle: "SYSTEM",
        nachher: { code: s.code, stufe, angeschrieben, gesendet },
      });
    }
  }

  return berichte;
}
