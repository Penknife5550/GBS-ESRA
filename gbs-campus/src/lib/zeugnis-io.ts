/**
 * GBS Campus — Zeugnisse & Bescheinigungen: Datenbank-Operationen
 *
 * Der IO-Teil zur DB-freien Kernlogik (`zeugnis.ts`) und zum PDF-Bau
 * (`zeugnis-beleg.ts`): Zeugnisse ausstellen (einfrieren), korrigieren
 * (Neuausstellung), ohne Ersatz stornieren, den Seriendruck erzeugen, die
 * eigenen Zeugnisse des Schülers laden, ein einzelnes als PDF ausliefern und
 * nicht versandte DMS-Archivkopien nachsenden.
 *
 * Einfrieren: beim Ausstellen wird ein Snapshot der gedruckten Daten als JSON
 * festgeschrieben — eine spätere Noten-/Namensänderung verändert ein
 * ausgestelltes Zeugnis nicht mehr. Korrektur = Neuausstellung: das alte Zeugnis
 * wird ERSETZT (bleibt als Nachweis), ein neues mit höherer Version tritt an
 * seine Stelle. Eine Fehlausstellung ohne Ersatz wird STORNIERT: ungültig, für
 * die Person nicht mehr abrufbar, als Nachweis gespeichert; der Sammellauf
 * stellt sie nicht still neu aus.
 *
 * Eindeutigkeit: Semester-Zeugnis/Bescheinigung sind je (Person, Semester)
 * eindeutig; das **Abschlusszeugnis** dagegen je **Person** (sein Inhalt
 * aggregiert die ganze Ausbildung) — deshalb ist sein Storno-/Existenz-Scope
 * semesterunabhängig. Zwei partielle Unique-Indizes sichern beides in der DB.
 */

import { randomUUID } from "crypto";
import { Prisma, type Zeugnisstatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { protokolliere } from "@/lib/audit";
import { erzeugePdf } from "@/lib/pdf";
import { dmsAdresse } from "@/lib/konfiguration";
import { datum } from "@/lib/datum";
import { mitDmsSperre, sendeBelegAnDms } from "@/lib/dms";
import { ladeAkteurNamen } from "@/lib/personen-namen";
import { EINRICHTUNG, STATUS } from "@/lib/constants";
import { TEILNAHME_ZAEHLT } from "@/lib/teilnahme-filter";
import {
  baueZeugnisSnapshot,
  bescheinigungsFaecher,
  neueBelegNr,
  ohneBesuchtenAbend,
  zeugnistypFuer,
  ZEUGNIS_ORT,
  type ErfassterAbend,
  type GewaehlterTyp,
  type Zeugnistypwert,
  type ZeugnisLeistungEingabe,
  type ZeugnisSnapshot,
} from "@/lib/zeugnis";
import {
  baueSeriendruckBloecke,
  baueStornoVermerk,
  baueZeugnisBloecke,
  type StornoVermerk,
  type UngueltigVermerk,
} from "@/lib/zeugnis-beleg";
import {
  baueSammelVorschau,
  sammellaufSperre,
  stornoSperreFuerPerson,
  zaehleOffeneFaecher,
  zeugnisSperreFuerPerson,
  type SammellaufErgebnis,
  type SammelVorschau,
} from "@/lib/zeugnis-sammellauf";

/** Die eine dokumentierte JSON⇄Typ-Kopplung beim Lesen eines Snapshots. Alle
 * Snapshots stammen aus `baueZeugnisSnapshot`; die defensiven Leser weiter unten
 * (`?? []`, `?.`) fangen einen theoretischen Schema-Drift alter Zeilen ab. */
function alsSnapshot(json: Prisma.JsonValue): ZeugnisSnapshot {
  return json as unknown as ZeugnisSnapshot;
}

type LeistungZeile = ZeugnisLeistungEingabe;

/**
 * Wer in Übersicht, Vorschau und Sammellauf steht: aktiv ODER Absolvent, in
 * keinem Endzustand, nicht anonymisiert — dieselbe Regel, die
 * `zeugnisSperreFuerPerson` für die Einzel-Ausstellung prüft. Zusammen mit
 * `TEILNAHME_ZAEHLT` an der Teilnahme.
 *
 * Absolventen zählen nicht als aktiv (Fachentscheidung, Code-Review 4), fielen
 * über `istAktiv` also aus der Zeugnisseite — und gerade sie brauchen ihr
 * Abschlusszeugnis oder nach einer Korrektur eine Neuausstellung.
 */
const ZEUGNIS_PERSON = {
  status: {
    OR: [{ istAktiv: true }, { code: STATUS.ABSOLVENT }],
    istTerminal: false,
    code: { not: STATUS.ANONYMISIERT },
  },
} satisfies Prisma.PersonWhereInput;

const LEISTUNG_SELECT = {
  ergebnis: true,
  punkte: true,
  note: true,
  kurseinheit: { select: { titel: true, sortierung: true, fach: { select: { bezeichnung: true } } } },
} as const;

type LeistungRoh = {
  ergebnis: string;
  punkte: number | null;
  note: string | null;
  kurseinheit: { titel: string; sortierung: number; fach: { bezeichnung: string } };
};

function nachSortierung(a: LeistungRoh, b: LeistungRoh): number {
  return (
    a.kurseinheit.sortierung - b.kurseinheit.sortierung ||
    a.kurseinheit.fach.bezeichnung.localeCompare(b.kurseinheit.fach.bezeichnung, "de")
  );
}

function zuLeistungZeile(l: LeistungRoh): LeistungZeile {
  return { fach: l.kurseinheit.fach.bezeichnung, titel: l.kurseinheit.titel, ergebnis: l.ergebnis, punkte: l.punkte, note: l.note };
}

/** Die Leistungen des Schülers in EINEM Semester (Semester-Zeugnis). */
async function ladeSemesterLeistungen(personId: string, semesterId: string): Promise<LeistungZeile[]> {
  const teilnahme = await prisma.teilnahme.findUnique({
    where: { personId_semesterId: { personId, semesterId } },
    select: { leistungen: { select: LEISTUNG_SELECT } },
  });
  return (teilnahme?.leistungen ?? []).slice().sort(nachSortierung).map(zuLeistungZeile);
}

/** Alle Leistungen des Schülers über die ganze Ausbildung (Abschlusszeugnis),
 * Semester für Semester (ältestes zuerst), innerhalb je Fach sortiert. Nur
 * Schüler-Semester, die zählen: Aus Hörer-Semestern gehört nichts ins
 * Abschlusszeugnis (Hörer fallen aus jeder Prüfungsautomatik), und ein
 * abgemeldetes Semester hat nicht stattgefunden. */
async function ladeGesamtLeistungen(personId: string): Promise<LeistungZeile[]> {
  const teilnahmen = await prisma.teilnahme.findMany({
    where: { personId, teilnahmeform: "SCHUELER", ...TEILNAHME_ZAEHLT },
    orderBy: { semester: { start: "asc" } },
    select: { leistungen: { select: LEISTUNG_SELECT } },
  });
  return teilnahmen.flatMap((t) => t.leistungen.slice().sort(nachSortierung)).map(zuLeistungZeile);
}

/** Was von einem erfassten Abend für die Teilnahmebescheinigung gebraucht wird. */
const ABEND_SELECT = {
  status: true,
  termin: {
    select: { kurseinheit: { select: { id: true, titel: true, sortierung: true, fach: { select: { bezeichnung: true } } } } },
  },
} as const;

type AbendRoh = {
  status: string;
  termin: { kurseinheit: { id: string; titel: string; sortierung: number; fach: { bezeichnung: string } } | null };
};

function alsErfassterAbend(a: AbendRoh): ErfassterAbend {
  const k = a.termin.kurseinheit;
  return { status: a.status, kurseinheit: k ? { id: k.id, titel: k.titel, sortierung: k.sortierung, fach: k.fach.bezeichnung } : null };
}

/** Die Fächer der Teilnahmebescheinigung eines Hörers: nur Kurseinheiten mit
 * mindestens einem besuchten Abend in DIESEM Semester. Geladen werden alle
 * erfassten Abende der Teilnahme an Terminen des Semesters; welche zählen,
 * entscheidet die DB-freie Regel `bescheinigungsFaecher`. */
async function ladeBesuchteFaecher(personId: string, semesterId: string): Promise<LeistungZeile[]> {
  const abende = await prisma.anwesenheit.findMany({
    where: { teilnahme: { personId, semesterId }, termin: { semesterId } },
    select: ABEND_SELECT,
  });
  return bescheinigungsFaecher(abende.map(alsErfassterAbend));
}

/** Je Person die Zahl der Fächer mit besuchtem Abend im Semester — gebündelt für
 * die Hörer-Zeilen der Übersicht (und damit für die Vorschau). Dieselbe Regel
 * wie beim Ausstellen (`bescheinigungsFaecher`). */
async function zaehleBesuchteFaecher(semesterId: string, personIds: string[]): Promise<Map<string, number>> {
  if (personIds.length === 0) return new Map();
  const abende = await prisma.anwesenheit.findMany({
    where: { teilnahme: { semesterId, personId: { in: personIds } }, termin: { semesterId } },
    select: { ...ABEND_SELECT, teilnahme: { select: { personId: true } } },
  });
  const jePerson = new Map<string, ErfassterAbend[]>();
  for (const a of abende) {
    const liste = jePerson.get(a.teilnahme.personId) ?? [];
    liste.push(alsErfassterAbend(a));
    jePerson.set(a.teilnahme.personId, liste);
  }
  return new Map(personIds.map((id) => [id, bescheinigungsFaecher(jePerson.get(id) ?? []).length]));
}

async function sammleInhalt(
  personId: string,
  typ: Zeugnistypwert,
  semesterId: string,
  semesterBezeichnung: string,
): Promise<{ abschnitt: string; leistungen: LeistungZeile[] }> {
  if (typ === "BESCHEINIGUNG") {
    return { abschnitt: semesterBezeichnung, leistungen: await ladeBesuchteFaecher(personId, semesterId) };
  }
  if (typ === "ABSCHLUSS") {
    return { abschnitt: "Gesamte Ausbildung", leistungen: await ladeGesamtLeistungen(personId) };
  }
  return { abschnitt: semesterBezeichnung, leistungen: await ladeSemesterLeistungen(personId, semesterId) };
}

// -----------------------------------------------------------------------------
// Eindeutigkeit: das Abschlusszeugnis ist je Person eindeutig (semesterunabhängig)
// -----------------------------------------------------------------------------

/** Where-Klausel für das bestehende gültige Zeugnis — beim Abschluss ohne Semester. */
function gueltigWo(personId: string, semesterId: string, typ: Zeugnistypwert) {
  return typ === "ABSCHLUSS"
    ? { personId, typ, status: "GUELTIG" as const }
    : { personId, semesterId, typ, status: "GUELTIG" as const };
}

/** Schlüssel für die Batch-Existenzprüfung (gültige UND stornierte) — beim
 * Abschluss semesterunabhängig, sonst je (Person, Typ, Semester). */
function zeugnisSchluessel(personId: string, semesterId: string, typ: Zeugnistypwert): string {
  return typ === "ABSCHLUSS" ? `${personId}::ABSCHLUSS` : `${personId}::${typ}::${semesterId}`;
}

// -----------------------------------------------------------------------------
// Ausstellen (einfrieren) — das bisherige wird bei einer Neuausstellung ERSETZT
// -----------------------------------------------------------------------------

export type AusstellErgebnis =
  | { ok: true; zeugnisId: string; belegNr: string; typ: Zeugnistypwert; version: number; snapshot: ZeugnisSnapshot }
  | {
      fehler:
        | "person_fehlt"
        | "semester_fehlt"
        | "nicht_eingeschrieben"
        | "abgemeldet"
        | "gleichzeitig"
        | "vorgaenger_geaendert"
        | "ohne_anwesenheit";
    }
  | { fehler: "person_gesperrt"; meldung: string };

type PersonKopf = { vorname: string; nachname: string; geburtsdatum: Date | null };
type AltZeugnis = { id: string; belegNr: string; version: number };

/**
 * Der gemeinsame Kern: friert den Snapshot ein, storniert (falls `alt` gesetzt)
 * das Vorgänger-Zeugnis in derselben Transaktion und legt das neue an. Alle
 * Kontext-Daten (Person, Semesterbezeichnung, `alt`, Ausstellername) reicht der
 * Aufrufer herein — der Einzel-Weg lädt sie einzeln, der Sammel-Weg gebündelt.
 */
async function fuehreAusstellungAus(input: {
  personId: string;
  semesterId: string;
  akteurId: string;
  typ: Zeugnistypwert;
  person: PersonKopf;
  semesterBezeichnung: string;
  alt: AltZeugnis | null;
  ausstellerName: string | null;
  headers?: Headers;
}): Promise<AusstellErgebnis> {
  const { personId, semesterId, akteurId, typ, person, semesterBezeichnung, alt, ausstellerName, headers } = input;

  const inhalt = await sammleInhalt(personId, typ, semesterId, semesterBezeichnung);
  // Keine Teilnahmebescheinigung ohne besuchten Abend — auch nicht als
  // Neuausstellung (das bisherige Dokument bleibt dann unverändert gültig).
  if (ohneBesuchtenAbend(typ, inhalt.leistungen)) return { fehler: "ohne_anwesenheit" };
  const jetzt = new Date();
  const belegNr = neueBelegNr(typ, jetzt, randomUUID().slice(0, 8));
  const version = (alt?.version ?? 0) + 1;

  const snapshot = baueZeugnisSnapshot({
    belegNr,
    typ,
    version,
    ersetztBelegNr: alt?.belegNr ?? null,
    personName: `${person.nachname}, ${person.vorname}`,
    geburtsdatum: person.geburtsdatum ? datum(person.geburtsdatum) : null,
    abschnitt: inhalt.abschnitt,
    leistungen: inhalt.leistungen,
    ausgestelltAm: datum(jetzt),
    ausgestelltVon: ausstellerName,
    ort: ZEUGNIS_ORT,
  });

  try {
    const neu = await prisma.$transaction(async (tx): Promise<{ id: string } | { fehlt: true } | { sperre: string } | { geaendert: true }> => {
      // Personenzeile sperren (FOR SHARE) und den Status IN der Transaktion
      // prüfen: Name und Geburtsdatum stehen schon im Snapshot. Committet eine
      // Anonymisierung zwischen dem Lesen der Person und hier, entstünde sonst
      // ein gültiges Zeugnis mit Klarnamen einer anonymisierten Person — die
      // Anonymisierung hätte die Zeugnisse da schon gelesen. Sie sperrt dieselbe
      // Zeile (Statuswechsel); beide laufen so nacheinander, nie verschränkt.
      const [zeile] = await tx.$queryRaw<{ statusCode: string }[]>`
        SELECT "statusCode" FROM "personen" WHERE "id" = ${personId} FOR SHARE`;
      if (!zeile) return { fehlt: true };
      const status = await tx.teilnehmerStatus.findUnique({
        where: { code: zeile.statusCode },
        select: { code: true, bezeichnung: true, istTerminal: true },
      });
      const sperre = status ? zeugnisSperreFuerPerson(status) : null;
      if (sperre) return { sperre };

      // Erst das alte entwerten, DANN das neue anlegen — so kollidiert das neue
      // GUELTIG nicht mit dem alten am partiellen Unique-Index. Bedingt: Wurde
      // es zeitgleich storniert oder ersetzt, entsteht nichts.
      if (alt) {
        const entwertet = await tx.zeugnis.updateMany({ where: { id: alt.id, status: "GUELTIG" }, data: { status: "ERSETZT" } });
        if (entwertet.count !== 1) return { geaendert: true };
      }
      return tx.zeugnis.create({
        data: {
          belegNr,
          personId,
          semesterId,
          typ,
          version,
          ersetztId: alt?.id ?? null,
          // Der ZeugnisSnapshot enthält `string | null`-Unions, die Prisma nicht
          // direkt als InputJsonValue akzeptiert — deshalb der gekapselte Cast.
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          ausgestelltVonId: akteurId,
        },
        select: { id: true },
      });
    });
    if ("fehlt" in neu) return { fehler: "person_fehlt" };
    if ("sperre" in neu) return { fehler: "person_gesperrt", meldung: neu.sperre };
    if ("geaendert" in neu) return { fehler: "vorgaenger_geaendert" };

    await protokolliere({
      aktion: "ZEUGNIS_AUSGESTELLT",
      objektTyp: "Zeugnis",
      objektId: neu.id,
      akteurId,
      nachher: { belegNr, typ, version, ersetzt: alt?.belegNr ?? null },
      headers,
    });

    return { ok: true, zeugnisId: neu.id, belegNr, typ, version, snapshot };
  } catch (fehler) {
    // Partieller Unique-Index: eine nahezu gleichzeitige Ausstellung war schneller.
    if (fehler instanceof Prisma.PrismaClientKnownRequestError && fehler.code === "P2002") {
      return { fehler: "gleichzeitig" };
    }
    throw fehler;
  }
}

/** Einzel-Ausstellung (oder Korrektur/Neuausstellung) eines Schülers. Die
 * DMS-Archivkopie schickt die Route NACH der Antwort (`archiviereNeueImDms` in
 * `after()`). Abgelehnt für anonymisierte Personen und Personen in einem
 * Endzustand (`person_gesperrt`), für eine für das Semester abgemeldete
 * Teilnahme (`abgemeldet`) und für einen Hörer ohne besuchten Abend
 * (`ohne_anwesenheit`). Nach einem Storno bleibt sie ausdrücklich möglich: Ein
 * storniertes Zeugnis ist kein Vorgänger (`gueltigWo` sucht nur GUELTIG), die
 * neue Ausstellung beginnt wieder mit Ausfertigung 1. Der DMS-Nachversand
 * bereits ausgestellter Zeugnisse ist davon nicht betroffen. */
export async function stelleZeugnisAus(
  personId: string,
  gewaehlt: GewaehlterTyp,
  semesterId: string,
  akteurId: string,
  headers?: Headers,
): Promise<AusstellErgebnis> {
  const [person, semester, teilnahme] = await Promise.all([
    prisma.person.findUnique({
      where: { id: personId },
      select: {
        vorname: true,
        nachname: true,
        geburtsdatum: true,
        status: { select: { code: true, bezeichnung: true, istTerminal: true } },
      },
    }),
    prisma.semester.findUnique({ where: { id: semesterId }, select: { bezeichnung: true } }),
    prisma.teilnahme.findUnique({
      where: { personId_semesterId: { personId, semesterId } },
      select: { teilnahmeform: true, abgemeldetAm: true },
    }),
  ]);
  if (!person) return { fehler: "person_fehlt" };
  const sperre = zeugnisSperreFuerPerson(person.status);
  if (sperre) return { fehler: "person_gesperrt", meldung: sperre };
  if (!semester) return { fehler: "semester_fehlt" };
  if (!teilnahme) return { fehler: "nicht_eingeschrieben" };
  if (teilnahme.abgemeldetAm) return { fehler: "abgemeldet" };

  const typ = zeugnistypFuer(teilnahme.teilnahmeform, gewaehlt);
  const alt = await prisma.zeugnis.findFirst({ where: gueltigWo(personId, semesterId, typ), select: { id: true, belegNr: true, version: true } });
  const ausstellerName = akteurId ? (await ladeAkteurNamen([akteurId])).get(akteurId) ?? null : null;

  return fuehreAusstellungAus({
    personId,
    semesterId,
    akteurId,
    typ,
    person,
    semesterBezeichnung: semester.bezeichnung,
    alt,
    ausstellerName,
    headers,
  });
}

/** Ein frisch ausgestelltes Zeugnis, wie es die DMS-Archivkopie braucht. */
export type NeuesZeugnis = { zeugnisId: string; belegNr: string; snapshot: ZeugnisSnapshot };

/** Zahlen des Sammellaufs plus die neu ausgestellten Zeugnisse — Letztere nur
 * für die Archivkopie nach der Antwort, nie für die Antwort selbst (Snapshot mit
 * Namen und Geburtsdatum). */
export type BatchErgebnis =
  | (SammellaufErgebnis & { neu: NeuesZeugnis[] })
  | { fehler: "semester_fehlt" }
  | { fehler: "abschluss_gesperrt"; meldung: string };

/**
 * Sammel-Ausstellung je Semester (idempotent): stellt für jeden aktiven
 * Teilnehmer (nicht abgemeldet, kein Endzustand, nicht anonymisiert — dieselbe
 * Menge wie `ladeZeugnisUebersicht`), der noch KEIN gültiges Zeugnis dieses
 * Typs hat, eines aus — ein
 * zweiter Lauf überspringt die vorhandenen (nichts wird ersetzt). Eine Korrektur
 * läuft bewusst über die Einzel-Neuausstellung. Übersprungen und getrennt
 * gezählt werden außerdem Teilnehmer mit einem STORNIERTEN Dokument desselben
 * Schlüssels (`storniert` — sonst stellte der nächste Lauf die zurückgezogene
 * Fehlausstellung still neu aus; neu ausstellen geht nur einzeln) und Hörer ohne
 * besuchten Abend (`ohneAnwesenheit`). Kontext (Aussteller, Semester, Personen,
 * bestehende Zeugnisse) wird EINMAL gebündelt geladen, nicht je Teilnehmer. Die
 * DMS-Archivkopie der neuen Zeugnisse (`neu`) schickt die Route NACH der Antwort
 * (`archiviereNeueImDms` in `after()`) — hakt der Mailserver, soll die Oberfläche
 * nicht in eine Zeitüberschreitung laufen, obwohl alles ausgestellt ist.
 *
 * Abschlusszeugnisse gibt es gesammelt nur im letzten Semester des Rasters
 * (`sammellaufSperre`) — sonst bekäme mit einem Klick jeder Aktive, auch ein
 * Erstsemester, ein Abschlusszeugnis. Die Einzel-Ausstellung bleibt frei.
 */
export async function stelleSemesterZeugnisseAus(
  semesterId: string,
  gewaehlt: GewaehlterTyp,
  akteurId: string,
  headers?: Headers,
): Promise<BatchErgebnis> {
  const [teilnahmen, semester, ausstellerName] = await Promise.all([
    prisma.teilnahme.findMany({
      where: { semesterId, ...TEILNAHME_ZAEHLT, person: ZEUGNIS_PERSON },
      orderBy: [{ person: { nachname: "asc" } }, { person: { vorname: "asc" } }],
      select: { personId: true, teilnahmeform: true },
    }),
    prisma.semester.findUnique({ where: { id: semesterId }, select: { bezeichnung: true, lehrjahr: true, halbjahr: true } }),
    akteurId ? ladeAkteurNamen([akteurId]).then((m) => m.get(akteurId) ?? null) : Promise.resolve(null),
  ]);
  if (!semester) return { fehler: "semester_fehlt" };
  const sperre = sammellaufSperre(gewaehlt, semester);
  if (sperre) return { fehler: "abschluss_gesperrt", meldung: sperre };
  if (teilnahmen.length === 0) {
    return { ausgestellt: 0, vorhanden: 0, storniert: 0, ohneAnwesenheit: 0, fehlgeschlagen: 0, gesamt: 0, neu: [] };
  }

  const personIds = teilnahmen.map((t) => t.personId);
  const [personen, bestehende] = await Promise.all([
    prisma.person.findMany({ where: { id: { in: personIds } }, select: { id: true, vorname: true, nachname: true, geburtsdatum: true } }),
    // ALLE gültigen und stornierten Zeugnisse dieser Personen (auch aus anderen
    // Semestern — wichtig fürs Abschlusszeugnis, das je Person eindeutig ist).
    prisma.zeugnis.findMany({
      where: { personId: { in: personIds }, status: { in: ["GUELTIG", "STORNIERT"] } },
      select: { personId: true, semesterId: true, typ: true, status: true },
    }),
  ]);
  const personVon = new Map(personen.map((p) => [p.id, p]));
  const schluesselMit = (status: Zeugnisstatus) =>
    new Set(bestehende.filter((z) => z.status === status).map((z) => zeugnisSchluessel(z.personId, z.semesterId, z.typ)));
  const vorhandene = schluesselMit("GUELTIG");
  const stornierte = schluesselMit("STORNIERT");

  const neu: NeuesZeugnis[] = [];
  // „vorhanden“, „storniert“, „ohne Anwesenheit“ und „fehlgeschlagen“ getrennt
  // zählen — ein Fehlschlag darf in der Oberfläche nie als „bereits vorhanden“
  // erscheinen, ein bewusst Übersprungener nie als Fehlschlag.
  let vorhanden = 0;
  let storniert = 0;
  let ohneAnwesenheit = 0;
  let fehlgeschlagen = 0;
  for (const t of teilnahmen) {
    const typ = zeugnistypFuer(t.teilnahmeform, gewaehlt);
    const schluessel = zeugnisSchluessel(t.personId, semesterId, typ);
    if (vorhandene.has(schluessel)) {
      vorhanden++;
      continue;
    }
    // Eine stornierte Fehlausstellung stellt der Sammellauf nicht still neu aus —
    // eine neue Ausstellung ist eine bewusste Einzelentscheidung.
    if (stornierte.has(schluessel)) {
      storniert++;
      continue;
    }
    const person = personVon.get(t.personId);
    if (!person) {
      // Zwischen den Abfragen verschwunden: nichts ausgestellt, nichts vorhanden.
      fehlgeschlagen++;
      continue;
    }
    try {
      const ergebnis = await fuehreAusstellungAus({
        personId: t.personId,
        semesterId,
        akteurId,
        typ,
        person,
        semesterBezeichnung: semester.bezeichnung,
        alt: null, // Sammellauf storniert nie — überspringt Vorhandene
        ausstellerName,
        headers,
      });
      if ("ok" in ergebnis) neu.push({ zeugnisId: ergebnis.zeugnisId, belegNr: ergebnis.belegNr, snapshot: ergebnis.snapshot });
      // P2002 am partiellen Unique-Index: eine gleichzeitige Ausstellung war
      // schneller — das gültige Zeugnis EXISTIERT jetzt, also „vorhanden“.
      else if (ergebnis.fehler === "gleichzeitig") vorhanden++;
      // Hörer ohne besuchten Abend: bewusst keine Bescheinigung, kein Fehler.
      else if (ergebnis.fehler === "ohne_anwesenheit") ohneAnwesenheit++;
      else fehlgeschlagen++;
    } catch (fehler) {
      // Ein einzelner Fehler darf den Sammellauf nicht abbrechen — der Rest wird
      // ausgestellt, und die Erfolgreichen archiviert die Route nach der Antwort.
      console.error("[ZEUGNIS] Ausstellung fehlgeschlagen für", t.personId, fehler);
      fehlgeschlagen++;
    }
  }

  return { ausgestellt: neu.length, vorhanden, storniert, ohneAnwesenheit, fehlgeschlagen, gesamt: teilnahmen.length, neu };
}

// -----------------------------------------------------------------------------
// Rückfrage vor dem Sammellauf: die Zahlen serverseitig ermitteln
// -----------------------------------------------------------------------------

/**
 * Die Zahlen für die Rückfrage vor „Alle ausstellen“, aus der Übersicht und den
 * erfassten Noten ermittelt (nicht geschätzt): wie viele Zeugnisse bzw.
 * Bescheinigungen neu entstünden, wie viele schon vorhanden sind, wie viele der
 * Sammellauf wegen eines Stornos oder mangels besuchten Abends (Hörer)
 * überspringt, wie viele der Auszustellenden noch unbewertete Fächer oder gar
 * keine Bewertung haben und — beim Abschluss — wie viele weniger
 * Schüler-Semester als das Raster haben.
 */
export async function ladeSammelVorschau(
  semester: { id: string; start: Date },
  gewaehlt: GewaehlterTyp,
  zeilen: ZeugnisPersonZeile[],
): Promise<SammelVorschau> {
  const kandidaten = zeilen.filter((z) => !z.zeugnis && !z.storniert && z.typ !== "BESCHEINIGUNG").map((z) => z.personId);
  const stand = await ladeBewertungsstand(semester, gewaehlt, kandidaten);
  return baueSammelVorschau(
    zeilen.map((z) => {
      const s = stand.get(z.personId);
      return {
        typ: z.typ,
        ausgestellt: z.zeugnis !== null,
        storniert: z.storniert !== null,
        besuchteFaecher: z.besuchteFaecher ?? 0,
        offeneFaecher: s?.offen ?? 0,
        bewertet: s?.bewertet ?? 0,
        schuelerSemester: s?.schuelerSemester ?? 0,
      };
    }),
  );
}

type Bewertungsstand = { offen: number; bewertet: number; schuelerSemester: number };

/**
 * Je Person die Zahl der Fächer ohne Bewertung, der erfassten Bewertungen und der
 * einbezogenen Schüler-Semester. Welche Fächer ein Semester hat, ergibt sich wie
 * in der Notenerfassung aus den Unterrichtsterminen (semesterId + kurseinheitId).
 * Semester-Zeugnis: nur das gewählte Semester; Abschlusszeugnis: jedes Semester
 * der Person bis einschließlich des gewählten (sein Inhalt aggregiert die ganze
 * Ausbildung). Hörer-Teilnahmen zählen nie — ohne Prüfungspflicht gibt es dort
 * nichts zu bewerten.
 */
async function ladeBewertungsstand(
  semester: { id: string; start: Date },
  gewaehlt: GewaehlterTyp,
  personIds: string[],
): Promise<Map<string, Bewertungsstand>> {
  if (personIds.length === 0) return new Map();

  const teilnahmen = await prisma.teilnahme.findMany({
    where: {
      personId: { in: personIds },
      teilnahmeform: "SCHUELER",
      // Ein abgemeldetes Semester hat keine offenen Fächer — es fand nicht statt.
      ...TEILNAHME_ZAEHLT,
      ...(gewaehlt === "ABSCHLUSS" ? { semester: { start: { lte: semester.start } } } : { semesterId: semester.id }),
    },
    select: { personId: true, semesterId: true, leistungen: { select: { kurseinheitId: true } } },
  });
  const semesterIds = [...new Set(teilnahmen.map((t) => t.semesterId))];
  const termine =
    semesterIds.length === 0
      ? []
      : await prisma.unterrichtstermin.findMany({
          where: { semesterId: { in: semesterIds }, kurseinheitId: { not: null } },
          distinct: ["semesterId", "kurseinheitId"],
          select: { semesterId: true, kurseinheitId: true },
        });

  const faecherVon = new Map<string, string[]>();
  for (const t of termine) {
    if (!t.kurseinheitId) continue;
    const liste = faecherVon.get(t.semesterId) ?? [];
    liste.push(t.kurseinheitId);
    faecherVon.set(t.semesterId, liste);
  }

  const stand = new Map<string, Bewertungsstand>();
  for (const t of teilnahmen) {
    const bisher = stand.get(t.personId) ?? { offen: 0, bewertet: 0, schuelerSemester: 0 };
    stand.set(t.personId, {
      offen: bisher.offen + zaehleOffeneFaecher(faecherVon.get(t.semesterId) ?? [], t.leistungen.map((l) => l.kurseinheitId)),
      bewertet: bisher.bewertet + t.leistungen.length,
      // Eine Teilnahme je (Person, Semester) — jede Zeile ist ein Semester.
      schuelerSemester: bisher.schuelerSemester + 1,
    });
  }
  return stand;
}

// -----------------------------------------------------------------------------
// DMS-Archivkopie (ein PDF, best-effort)
// -----------------------------------------------------------------------------

/**
 * Schickt eine Archivkopie der übergebenen Zeugnisse als EIN PDF ans DMS und
 * vermerkt den Versand. Best-effort: ein Fehler beim Versand rollt die Ausstellung
 * nicht zurück (wie beim Honorar-Beleg). Kein Personenname im Betreff — der bliebe
 * sonst in `email_versand` stehen und würde von der Anonymisierung nicht erfasst.
 * Liefert, ob die Mail raus ist; ein ausgebliebener Versand bleibt über
 * `dmsGesendetAm = null` sichtbar und lässt sich nachsenden
 * (`sendeOffeneZeugnisseAnDms`).
 */
async function archiviereImDms(zeugnisse: NeuesZeugnis[]): Promise<boolean> {
  const an = dmsAdresse();
  if (!an || zeugnisse.length === 0) return false;

  let gesendet = false;
  try {
    const pdf = erzeugePdf(baueSeriendruckBloecke(zeugnisse.map((z) => z.snapshot)));
    const einzeln = zeugnisse.length === 1;
    const betreff = einzeln
      ? `Zeugnis ${zeugnisse[0].belegNr} — ${zeugnisse[0].snapshot.abschnitt}`
      : `Zeugnisse Seriendruck (${zeugnisse.length}) — ${zeugnisse[0].snapshot.abschnitt}`;
    gesendet = await sendeBelegAnDms(an, {
      betreff,
      text:
        `Archivkopie ausgestellter Zeugnisse/Bescheinigungen der ${EINRICHTUNG.name}.\n\n` +
        `Anzahl: ${zeugnisse.length}\nAbschnitt: ${zeugnisse[0].snapshot.abschnitt}\n` +
        (einzeln ? `Beleg-Nr.: ${zeugnisse[0].belegNr}\n` : "") +
        `\nDie vollständigen Dokumente liegen im angehängten PDF.`,
      dateiname: einzeln ? `${zeugnisse[0].belegNr}.pdf` : `Zeugnisse-${zeugnisse.length}.pdf`,
      pdf,
    });
    if (gesendet) {
      // Nur noch leere Zeitpunkte setzen: Der Trigger zeugnis_nur_status_dms_scrub
      // erlaubt dmsGesendetAm nur von leer auf einen Wert. Laufen zwei
      // Nachversände gleichzeitig, trifft das zweite updateMany so 0 Zeilen,
      // statt mit 42501 eine längst zugestellte Archivkopie als „fehlgeschlagen"
      // zu loggen (wie die Nachtrag-Wege in honorar-io.ts und
      // honorar-abrechnung-io.ts).
      await prisma.zeugnis.updateMany({
        where: { id: { in: zeugnisse.map((z) => z.zeugnisId) }, dmsGesendetAm: null },
        data: { dmsGesendetAm: new Date() },
      });
    } else {
      console.warn(`[ZEUGNIS] DMS-Archivkopie nicht gesendet (${zeugnisse.length} Beleg(e), z. B. ${zeugnisse[0].belegNr})`);
    }
  } catch (fehler) {
    console.error("[ZEUGNIS] DMS-Archivkopie fehlgeschlagen", fehler);
  }
  return gesendet;
}

/**
 * Archivkopie frisch ausgestellter Zeugnisse — läuft NACH der Antwort
 * (`after()` in der Ausstellungs-Route). Vorher wartete die Route auf die Mail:
 * Bei hakendem SMTP meldete die Oberfläche eine Zeitüberschreitung, obwohl die
 * Zeugnisse längst ausgestellt waren. Wirft nie (`archiviereImDms` fängt selbst);
 * ein ausgebliebener Versand bleibt über `dmsGesendetAm = null` sichtbar und
 * lässt sich nachsenden — nach der Karenz `DMS_ERSTVERSAND_KARENZ_MS`.
 *
 * Wie der Nachversand: je Abschnitt eigene Mails zu höchstens `DMS_JE_MAIL`
 * Zeugnissen (ein Abschluss-Sammellauf mit Hörern mischt sonst „Gesamte
 * Ausbildung“ und Semester-Bescheinigungen unter einem Betreff), Abbruch beim
 * ersten Fehlschlag, Zeitbudget je Lauf.
 */
export async function archiviereNeueImDms(neu: NeuesZeugnis[]): Promise<void> {
  if (neu.length === 0) return;
  await sendePaketeAnDms(paketeJeAbschnitt(neu), { gesendeteBelege: [], fehlgeschlagen: 0 });
}

// -----------------------------------------------------------------------------
// DMS-Nachversand (Sammel-Nachversand offener Archivkopien)
// -----------------------------------------------------------------------------

/**
 * Karenz für frisch ausgestellte Zeugnisse. Ihre Archivkopie schickt die
 * Ausstellungs-Route erst NACH der Antwort (`after()`), die Oberfläche lädt aber
 * sofort neu. Ohne Karenz stünden die eben ausgestellten Zeugnisse dann als „noch
 * nicht im DMS archiviert“ da, und ein Klick auf „Nachsenden“ schickte sie ein
 * zweites Mal, während der Erstversand noch läuft (der hält die Nachversand-Sperre
 * nicht). Zähler UND Nachversand nutzen deshalb dieselbe Bedingung
 * (`offenImDms`): Beide sehen dieselbe Menge, ein gescheiterter Erstversand
 * erscheint erst nach der Karenz.
 */
const DMS_ERSTVERSAND_KARENZ_MS = 2 * 60_000;

/** Gültige Zeugnisse, deren Archivkopie noch nicht beim DMS ist und deren
 * Erstversand nicht mehr laufen kann (älter als die Karenz). Ohne DMS-Adresse
 * läuft kein Erstversand (`archiviereImDms` bricht sofort ab) — dann gibt es
 * nichts abzuwarten, und die Zahl stimmt sofort. Ersetzte bleiben außen vor: an
 * ihre Stelle ist eine neue Ausfertigung getreten, die den „ersetzt Beleg …“-
 * Vermerk trägt und selbst archiviert wird. */
function offenImDms(jetzt: number = Date.now()): Prisma.ZeugnisWhereInput {
  if (!dmsAdresse()) return { status: "GUELTIG", dmsGesendetAm: null };
  return {
    status: "GUELTIG",
    dmsGesendetAm: null,
    ausgestelltAm: { lt: new Date(jetzt - DMS_ERSTVERSAND_KARENZ_MS) },
  };
}

/** Höchstens so viele Zeugnisse je Archiv-Mail (ein PDF) — hält den Anhang klein. */
const DMS_JE_MAIL = 50;

/** Höchstens so viele Mails je Nachversand-Lauf (zusätzliche Obergrenze neben dem
 * Zeitbudget `DMS_LAUF_BUDGET_MS`). Der Rest bleibt offen, steht weiter als Zahl
 * auf der Zeugnisseite und geht mit dem nächsten Klick. */
const DMS_MAILS_JE_LAUF = 4;

/** Höchstens so viele Zeugnisse je Lauf — so viele passen in dessen Mails. */
const DMS_JE_LAUF = DMS_MAILS_JE_LAUF * DMS_JE_MAIL;

/**
 * Zeitbudget eines Versandlaufs (Erst- und Nachversand): Ein weiteres Paket
 * beginnt nur, solange seit dem Start des Laufs höchstens so viel Zeit vergangen
 * ist; das erste Paket geht immer. Das hält den Lauf in aller Regel unter dem
 * 60-s-Zeitlimit der Sperr-Transaktion (`mitDmsSperre`), unter der 30-s-Grenze
 * der Oberfläche und beim Erstversand innerhalb der Karenz. Eine GARANTIE ist es
 * nicht: Die Mailer-Timeouts (10 s Verbindung, 10 s Gruß, 20 s Funkstille)
 * begrenzen nur den Leerlauf, ein langsamer, aber aktiver Versand ist
 * unbegrenzt. Überschreitet ein Nachversand das Zeitlimit doch, gibt Postgres die
 * Sperre schon frei; die bis dahin gesendeten Kopien gelten trotzdem (siehe
 * `sendeOffeneZeugnisseAnDms`).
 */
const DMS_LAUF_BUDGET_MS = 20_000;

/** Teilt Zeugnisse in Mail-Pakete: je Abschnitt eigene Pakete, damit Betreff und
 * Text (sie nennen den Abschnitt des ersten Zeugnisses) für alle angehängten
 * Zeugnisse stimmen, je Paket höchstens `DMS_JE_MAIL` Zeugnisse. */
function paketeJeAbschnitt(zeugnisse: NeuesZeugnis[]): NeuesZeugnis[][] {
  const nachAbschnitt = new Map<string, NeuesZeugnis[]>();
  for (const z of zeugnisse) {
    const schluessel = z.snapshot.abschnitt ?? "";
    const liste = nachAbschnitt.get(schluessel) ?? [];
    liste.push(z);
    nachAbschnitt.set(schluessel, liste);
  }
  const pakete: NeuesZeugnis[][] = [];
  for (const gruppe of nachAbschnitt.values()) {
    for (let i = 0; i < gruppe.length; i += DMS_JE_MAIL) pakete.push(gruppe.slice(i, i + DMS_JE_MAIL));
  }
  return pakete;
}

/** Stand eines Versandlaufs; wird Paket für Paket fortgeschrieben. */
type DmsLaufStand = { gesendeteBelege: string[]; fehlgeschlagen: number };

/**
 * Schickt die Pakete nacheinander über `archiviereImDms` und schreibt `stand`
 * nach jedem Paket fort — so kennt der Aufrufer den Stand auch, wenn danach
 * etwas wirft. Scheitert eine Mail, bricht der Lauf ab: Ist SMTP gestört, wartete
 * sonst jede weitere Mail bis zu ihren Timeouts, ohne dass eine gelingen kann.
 * Ein weiteres Paket beginnt nur innerhalb von `DMS_LAUF_BUDGET_MS`. Die übrigen
 * bleiben offen und gehen mit dem nächsten Nachversand.
 */
async function sendePaketeAnDms(pakete: NeuesZeugnis[][], stand: DmsLaufStand): Promise<void> {
  const start = Date.now();
  for (let i = 0; i < pakete.length; i++) {
    if (i > 0 && Date.now() - start > DMS_LAUF_BUDGET_MS) break;
    const teil = pakete[i];
    if (await archiviereImDms(teil)) {
      stand.gesendeteBelege.push(...teil.map((z) => z.belegNr));
      continue;
    }
    // Erster Fehlschlag: abbrechen — die übrigen bleiben offen.
    stand.fehlgeschlagen += teil.length;
    break;
  }
}

/** Wie viele gültige Zeugnisse noch nicht im DMS archiviert sind (ohne die eben
 * ausgestellten, deren Erstversand noch laufen kann — `offenImDms`). */
export async function zaehleOffeneDmsArchivierungen(): Promise<number> {
  return prisma.zeugnis.count({ where: offenImDms() });
}

export type DmsNachversandErgebnis =
  | { gesendet: number; fehlgeschlagen: number; offen: number }
  | { fehler: "dms_fehlt" | "laeuft" };

/** Schlüssel der Sperre, unter der ein Nachversand-Lauf läuft (Advisory-Lock). */
const NACHVERSAND_SPERRE = "zeugnis-dms-nachversand";

/**
 * Sendet die Archivkopien gültiger Zeugnisse mit `dmsGesendetAm = null` nach
 * (Schulleitung, Recht NOTEN_VERWALTEN). Derselbe Versandweg wie beim Ausstellen
 * (`archiviereImDms`); je Abschnitt eigene Mails, damit Betreff und Text für alle
 * angehängten Zeugnisse stimmen (`paketeJeAbschnitt`). Höchstens
 * `DMS_MAILS_JE_LAUF` Mails und `DMS_LAUF_BUDGET_MS` je Lauf. Eben ausgestellte
 * Zeugnisse (Karenz, `offenImDms`) bleiben dem noch laufenden Erstversand.
 *
 * Der Lauf hält eine Sperre (`mitDmsSperre`): Zwei gleichzeitige Läufe — zweiter
 * Tab, zweiter Klick nach einer Zeitüberschreitung der Oberfläche — läsen
 * dieselben offenen Zeugnisse und schickten sie doppelt ans DMS. Der zweite
 * bekommt sofort `laeuft` (Route 409). Scheitert eine Mail, bricht der Lauf ab
 * (`sendePaketeAnDms`); die übrigen bleiben offen und gehen mit dem nächsten
 * Lauf.
 */
export async function sendeOffeneZeugnisseAnDms(akteurId: string, headers?: Headers): Promise<DmsNachversandErgebnis> {
  if (!dmsAdresse()) return { fehler: "dms_fehlt" };

  // Außerhalb der Transaktion fortgeschrieben: Überschreitet der Lauf trotz
  // Zeitbudget das Zeitlimit der Sperr-Transaktion, wirft `mitDmsSperre` — die
  // bis dahin gesendeten Archivkopien sind aber draußen und schon vermerkt
  // (`archiviereImDms` schreibt außerhalb der Transaktion). Dann gilt dieser
  // Stand, statt „fehlgeschlagen“ zu melden und zum zweiten Nachsenden zu
  // verleiten.
  const stand: DmsLaufStand = { gesendeteBelege: [], fehlgeschlagen: 0 };
  let lauf: null | "LAEUFT" | "GELAUFEN";
  try {
    lauf = await mitDmsSperre(NACHVERSAND_SPERRE, async (tx) => {
      // Unter der Sperre frisch lesen: Ein eben beendeter Lauf hat seine Zeugnisse
      // schon als gesendet vermerkt (`archiviereImDms` schreibt außerhalb der
      // Transaktion, also sofort sichtbar).
      const offene = await tx.zeugnis.findMany({
        where: offenImDms(),
        orderBy: { ausgestelltAm: "asc" },
        take: DMS_JE_LAUF,
        select: { id: true, belegNr: true, snapshot: true },
      });
      if (offene.length === 0) return null;

      const pakete = paketeJeAbschnitt(
        offene.map((z) => ({ zeugnisId: z.id, belegNr: z.belegNr, snapshot: alsSnapshot(z.snapshot) })),
      );
      await sendePaketeAnDms(pakete.slice(0, DMS_MAILS_JE_LAUF), stand);
      return "GELAUFEN" as const;
    });
  } catch (ausnahme) {
    if (stand.gesendeteBelege.length === 0 && stand.fehlgeschlagen === 0) throw ausnahme;
    console.warn("[ZEUGNIS] DMS-Nachversand: Sperr-Transaktion nach dem Versand gescheitert, gesendete Kopien sind vermerkt", ausnahme);
    lauf = "GELAUFEN";
  }
  if (lauf === "LAEUFT") return { fehler: "laeuft" };
  if (lauf === null) return { gesendet: 0, fehlgeschlagen: 0, offen: 0 };

  const { gesendeteBelege, fehlgeschlagen } = stand;
  const offen = await prisma.zeugnis.count({ where: offenImDms() });

  await protokolliere({
    aktion: "ZEUGNIS_DMS_NACHGESENDET",
    objektTyp: "Zeugnis",
    akteurId,
    nachher: { gesendet: gesendeteBelege.length, fehlgeschlagen, offen, belegNr: gesendeteBelege },
    headers,
  });

  return { gesendet: gesendeteBelege.length, fehlgeschlagen, offen };
}

// -----------------------------------------------------------------------------
// Seriendruck & Einzeldruck (PDF)
// -----------------------------------------------------------------------------

export type SeriendruckErgebnis = { pdf: Buffer; anzahl: number } | { leer: true };

/**
 * Erzeugt EIN Druck-PDF, je Person auf eigenem Blatt, aus den eingefrorenen
 * Snapshots. Gedruckt wird GENAU die Menge, die die Schulleitungssicht
 * (`ladeZeugnisUebersicht`) als ausgestellt zeigt — inklusive des
 * semesterunabhängigen Abschlusszeugnisses. So passt der Seriendruck exakt zu dem,
 * was die Übersicht anbietet (kein „Link ins Leere", wenn nur fremdsemestrige
 * Abschlüsse existieren). Nur GÜLTIGE: Stornierte und ersetzte zeigt die
 * Übersicht nicht als Zeugnis; die Bedingung beim Laden fängt zusätzlich einen
 * Storno zwischen Übersicht und Druck ab.
 */
export async function erzeugeSeriendruckPdf(semesterId: string, gewaehlt: GewaehlterTyp): Promise<SeriendruckErgebnis> {
  const zeilen = await ladeZeugnisUebersicht(semesterId, gewaehlt);
  const ids = zeilen.map((z) => z.zeugnis?.id).filter((x): x is string => Boolean(x));
  if (ids.length === 0) return { leer: true };

  const zeugnisse = await prisma.zeugnis.findMany({ where: { id: { in: ids }, status: "GUELTIG" }, select: { snapshot: true } });
  if (zeugnisse.length === 0) return { leer: true };
  // Nach Namen sortieren, damit der Stapel alphabetisch liegt (defensiv gegen einen
  // theoretisch fehlenden Namen in einem Altsnapshot).
  const snapshots = zeugnisse
    .map((z) => alsSnapshot(z.snapshot))
    .sort((a, b) => (a.person?.name ?? "").localeCompare(b.person?.name ?? "", "de"));
  return { pdf: erzeugePdf(baueSeriendruckBloecke(snapshots)), anzahl: snapshots.length };
}

export type ZeugnisDokument = {
  personId: string;
  belegNr: string;
  status: Zeugnisstatus;
  snapshot: ZeugnisSnapshot;
  /** Nur bei ERSETZT: die Ausfertigung, die an seine Stelle trat (null, wenn
   * gültig oder der Nachfolger nicht auffindbar ist). */
  ersetztDurch: { belegNr: string; ausgestelltAm: Date } | null;
  /** Nur bei STORNIERT: der Zeitpunkt des Stornos. */
  storniertAm: Date | null;
};

/** Lädt ein Zeugnis für den Download (personId, belegNr, Status, Snapshot und —
 * bei einem ersetzten — den Nachfolger) — der Aufrufer prüft mit `personId` den
 * Zugriff und mit `status` die Gültigkeit VOR der PDF-Erzeugung. Null, wenn es
 * das Zeugnis nicht gibt. */
export async function ladeZeugnisFuerDownload(zeugnisId: string): Promise<ZeugnisDokument | null> {
  const z = await prisma.zeugnis.findUnique({
    where: { id: zeugnisId },
    select: { id: true, personId: true, belegNr: true, status: true, snapshot: true, storniertAm: true },
  });
  if (!z) return null;
  // Der Nachfolger verweist auf seinen Vorgänger (`ersetztId`, bewusst ohne
  // Relation) — nachgeschlagen wird nur für ein ersetztes Zeugnis.
  const ersetztDurch =
    z.status !== "ERSETZT"
      ? null
      : await prisma.zeugnis.findFirst({ where: { ersetztId: z.id }, select: { belegNr: true, ausgestelltAm: true } });
  return {
    personId: z.personId,
    belegNr: z.belegNr,
    status: z.status,
    snapshot: alsSnapshot(z.snapshot),
    ersetztDurch,
    storniertAm: z.storniertAm,
  };
}

/**
 * Erzeugt das PDF eines geladenen Zeugnisses (nach der Zugriffsprüfung). Ein
 * ERSETZTES bekommt vor allem anderen den Vermerk „UNGÜLTIG – ersetzt durch …
 * am …“, ein STORNIERTES „STORNIERT am … — ungültig“; der eingefrorene Snapshot
 * bleibt dabei unverändert.
 */
export function erzeugeZeugnisPdf(dokument: ZeugnisDokument): Buffer {
  let vermerk: UngueltigVermerk | StornoVermerk | null = null;
  if (dokument.status === "STORNIERT") {
    vermerk = { storniertAm: datum(dokument.storniertAm) };
  } else if (dokument.status === "ERSETZT") {
    vermerk = {
      durchBelegNr: dokument.ersetztDurch?.belegNr ?? null,
      am: dokument.ersetztDurch ? datum(dokument.ersetztDurch.ausgestelltAm) : null,
    };
  }
  return erzeugePdf(baueZeugnisBloecke(dokument.snapshot, vermerk));
}

// -----------------------------------------------------------------------------
// Storno ohne Ersatz
// -----------------------------------------------------------------------------

export type StornoErgebnis =
  | { ok: true; zeugnisId: string; belegNr: string; typ: Zeugnistypwert; storniertAm: Date; titel: string; abschnitt: string }
  | { fehler: "fehlt" | "nicht_gueltig" }
  | { fehler: "person_gesperrt"; meldung: string };

/**
 * Storniert ein GÜLTIGES Zeugnis ohne Ersatz (Schulleitung, Recht
 * NOTEN_VERWALTEN): Es wird ungültig, ist für die Person nicht mehr abrufbar und
 * bleibt als Nachweis stehen — mit Zeitpunkt, Akteur und Grund. Atomar über das
 * bedingte `updateMany` auf `status = GUELTIG`: Wer zeitgleich storniert oder neu
 * ausstellt, bekommt `nicht_gueltig` (409). Der Trigger
 * `zeugnis_nur_status_dms_scrub` lässt GUELTIG -> STORNIERT nur mit Zeitpunkt und
 * nicht-leerem Grund zu.
 *
 * Die Personenzeile wird wie beim Ausstellen gesperrt (FOR SHARE) und der Status
 * IN der Transaktion geprüft: Die Anonymisierung sperrt dieselbe Zeile und
 * überschreibt danach die Storno-Gründe der Person. So läuft ein Storno ganz vor
 * ihr (sein Grund wird mit überschrieben) oder ganz nach ihr (dann abgelehnt,
 * `stornoSperreFuerPerson`) — nie ein Freitext-Grund an einer anonymisierten
 * Person.
 *
 * Ins Audit-Log gehen Beleg-Nr., Typ und nur, DASS ein Grund angegeben wurde —
 * der Freitext steht allein am Zeugnis (dort erfasst ihn die Anonymisierung).
 */
export async function storniereZeugnis(
  zeugnisId: string,
  grund: string,
  akteurId: string,
  headers?: Headers,
): Promise<StornoErgebnis> {
  const z = await prisma.zeugnis.findUnique({
    where: { id: zeugnisId },
    select: { id: true, personId: true, belegNr: true, typ: true, snapshot: true },
  });
  if (!z) return { fehler: "fehlt" };

  const jetzt = new Date();
  const ergebnis = await prisma.$transaction(async (tx): Promise<"ok" | "fehlt" | "nicht_gueltig" | { sperre: string }> => {
    const [zeile] = await tx.$queryRaw<{ statusCode: string }[]>`
      SELECT "statusCode" FROM "personen" WHERE "id" = ${z.personId} FOR SHARE`;
    if (!zeile) return "fehlt";
    const sperre = stornoSperreFuerPerson(zeile.statusCode);
    if (sperre) return { sperre };
    const { count } = await tx.zeugnis.updateMany({
      where: { id: z.id, status: "GUELTIG" },
      data: { status: "STORNIERT", storniertAm: jetzt, storniertVonId: akteurId, stornoGrund: grund },
    });
    return count === 1 ? "ok" : "nicht_gueltig";
  });
  if (typeof ergebnis === "object") return { fehler: "person_gesperrt", meldung: ergebnis.sperre };
  if (ergebnis !== "ok") return { fehler: ergebnis };

  await protokolliere({
    aktion: "ZEUGNIS_STORNIERT",
    objektTyp: "Zeugnis",
    objektId: z.id,
    akteurId,
    vorher: { status: "GUELTIG" },
    // Der Grund ist Freitext und kann Personenbezug tragen — ins unlöschbare
    // Protokoll gehört nur, DASS einer angegeben wurde (wie STATUS_GEWECHSELT).
    nachher: { status: "STORNIERT", belegNr: z.belegNr, typ: z.typ, grundAngegeben: true },
    headers,
  });

  const snapshot = alsSnapshot(z.snapshot);
  return {
    ok: true,
    zeugnisId: z.id,
    belegNr: z.belegNr,
    typ: z.typ,
    storniertAm: jetzt,
    titel: snapshot.titel ?? "Zeugnis",
    abschnitt: snapshot.abschnitt ?? "",
  };
}

/**
 * Kurzer Storno-Vermerk an das DMS (Beleg-Nr., Dokument, Datum, „ungültig“ —
 * ohne Namen und ohne Grund, `baueStornoVermerk`). Läuft NACH der Antwort
 * (`after()` in der Storno-Route), best effort: Ohne DMS-Adresse passiert nichts,
 * ein Fehlschlag wird nur geloggt (der Versand steht wie jede Mail im
 * Versandprotokoll). Wirft nie.
 */
export async function sendeStornoVermerkAnDms(storno: {
  belegNr: string;
  titel: string;
  abschnitt: string;
  storniertAm: Date;
}): Promise<void> {
  const an = dmsAdresse();
  if (!an) return;
  try {
    const vermerk = baueStornoVermerk({ ...storno, storniertAm: datum(storno.storniertAm) });
    const gesendet = await sendeBelegAnDms(an, {
      betreff: vermerk.betreff,
      text: vermerk.text,
      dateiname: vermerk.dateiname,
      pdf: erzeugePdf(vermerk.bloecke),
    });
    if (!gesendet) console.warn(`[ZEUGNIS] Storno-Vermerk nicht an das DMS gesendet (${storno.belegNr})`);
  } catch (fehler) {
    console.error(`[ZEUGNIS] Storno-Vermerk an das DMS fehlgeschlagen (${storno.belegNr})`, fehler);
  }
}

// -----------------------------------------------------------------------------
// Ladeansichten
// -----------------------------------------------------------------------------

export type ZeugnisPersonZeile = {
  personId: string;
  name: string;
  teilnahmeform: string;
  typ: Zeugnistypwert;
  zeugnis: { id: string; belegNr: string; version: number; ausgestelltAm: Date } | null;
  /** Nur ohne gültiges Dokument: das zuletzt stornierte desselben Schlüssels —
   * der Grund, warum der Sammellauf die Person überspringt. */
  storniert: { id: string; belegNr: string; storniertAm: Date | null } | null;
  /** Nur Bescheinigung ohne gültiges Dokument: Fächer mit besuchtem Abend
   * (0 = keine Bescheinigung). Sonst null. */
  besuchteFaecher: number | null;
};

/**
 * Schulleitungssicht: je aktivem Teilnehmer des Semesters der Typ, den er
 * bekäme, und das aktuell gültige Zeugnis (falls schon ausgestellt) — so ist auf
 * einen Blick sichtbar, wer eins hat und wer nicht. Ohne gültiges steht ein
 * storniertes Dokument desselben Schlüssels dabei (der Sammellauf überspringt
 * die Person) und bei Hörern die Zahl der besuchten Fächer. Für das Semester
 * Abgemeldete fehlen (`TEILNAHME_ZAEHLT`), ebenso Endzustände und
 * Anonymisierte (`ZEUGNIS_PERSON`) — dieselbe Menge, die der Sammellauf
 * ausstellt und die Vorschau zählt.
 */
export async function ladeZeugnisUebersicht(semesterId: string, gewaehlt: GewaehlterTyp): Promise<ZeugnisPersonZeile[]> {
  const teilnahmen = await prisma.teilnahme.findMany({
    where: { semesterId, ...TEILNAHME_ZAEHLT, person: ZEUGNIS_PERSON },
    orderBy: [{ person: { nachname: "asc" } }, { person: { vorname: "asc" } }],
    select: { personId: true, teilnahmeform: true, person: { select: { vorname: true, nachname: true } } },
  });

  const typVon = new Map(teilnahmen.map((t) => [t.personId, zeugnistypFuer(t.teilnahmeform, gewaehlt)]));
  // Gültige und stornierte Zeugnisse dieser Personen — für das Abschlusszeugnis
  // semesterunabhängig, deshalb ohne semesterId-Filter (matcht dann über den
  // Typ-Schlüssel wie der Sammellauf).
  const bestehende = await prisma.zeugnis.findMany({
    where: { status: { in: ["GUELTIG", "STORNIERT"] }, personId: { in: teilnahmen.map((t) => t.personId) } },
    orderBy: { ausgestelltAm: "asc" },
    select: {
      id: true,
      personId: true,
      typ: true,
      status: true,
      semesterId: true,
      belegNr: true,
      version: true,
      ausgestelltAm: true,
      storniertAm: true,
    },
  });
  const zeugnisVon = new Map<string, { id: string; belegNr: string; version: number; ausgestelltAm: Date }>();
  const stornoVon = new Map<string, { id: string; belegNr: string; storniertAm: Date | null }>();
  for (const z of bestehende) {
    const erwarteterTyp = typVon.get(z.personId);
    if (erwarteterTyp !== z.typ) continue;
    // Semester-Zeugnis/Bescheinigung nur aus DIESEM Semester zählen; das
    // Abschlusszeugnis semesterunabhängig.
    if (z.typ !== "ABSCHLUSS" && z.semesterId !== semesterId) continue;
    if (z.status === "GUELTIG") {
      zeugnisVon.set(z.personId, { id: z.id, belegNr: z.belegNr, version: z.version, ausgestelltAm: z.ausgestelltAm });
    } else {
      // Nach Ausstellung aufsteigend: das zuletzt ausgestellte stornierte bleibt stehen.
      stornoVon.set(z.personId, { id: z.id, belegNr: z.belegNr, storniertAm: z.storniertAm });
    }
  }

  // Besuchte Fächer nur, wo sie etwas entscheiden: Hörer ohne gültiges Dokument.
  const hoererOhneDokument = teilnahmen
    .filter((t) => typVon.get(t.personId) === "BESCHEINIGUNG" && !zeugnisVon.has(t.personId))
    .map((t) => t.personId);
  const besucht = await zaehleBesuchteFaecher(semesterId, hoererOhneDokument);

  return teilnahmen.map((t) => ({
    personId: t.personId,
    name: `${t.person.nachname}, ${t.person.vorname}`,
    teilnahmeform: t.teilnahmeform,
    // ! ist sicher: typVon ist aus demselben teilnahmen-Array gebaut.
    typ: typVon.get(t.personId)!,
    zeugnis: zeugnisVon.get(t.personId) ?? null,
    storniert: zeugnisVon.has(t.personId) ? null : (stornoVon.get(t.personId) ?? null),
    besuchteFaecher: besucht.get(t.personId) ?? null,
  }));
}

export type EigenesZeugnis = { id: string; belegNr: string; titel: string; abschnitt: string; ausgestelltAm: Date };

/** Die eigenen gültigen Zeugnisse des Schülers (für /meine-daten, read-only).
 * Ersetzte und stornierte erscheinen hier nie — sie sind für die Person nicht
 * mehr abrufbar (PDF-Route: 410). */
export async function ladeEigeneZeugnisse(personId: string): Promise<EigenesZeugnis[]> {
  const zeugnisse = await prisma.zeugnis.findMany({
    where: { personId, status: "GUELTIG" },
    orderBy: { ausgestelltAm: "desc" },
    select: { id: true, belegNr: true, ausgestelltAm: true, snapshot: true },
  });
  return zeugnisse.map((z) => {
    const s = alsSnapshot(z.snapshot);
    return { id: z.id, belegNr: z.belegNr, titel: s.titel, abschnitt: s.abschnitt, ausgestelltAm: z.ausgestelltAm };
  });
}

export type AktenZeugnis = EigenesZeugnis & { typ: Zeugnistypwert; status: Zeugnisstatus; storniertAm: Date | null };

/** Alle Zeugnisse einer Person für die Detailakte der Schulleitung
 * (NOTEN_VERWALTEN) — gültige, ersetzte und stornierte, jüngste zuerst. Der
 * Storno-Grund bleibt außen vor: Er ist Freitext und wird nirgends angezeigt. */
export async function ladeZeugnisseDerPerson(personId: string): Promise<AktenZeugnis[]> {
  const zeugnisse = await prisma.zeugnis.findMany({
    where: { personId },
    orderBy: { ausgestelltAm: "desc" },
    select: { id: true, belegNr: true, typ: true, ausgestelltAm: true, snapshot: true, status: true, storniertAm: true },
  });
  return zeugnisse.map((z) => {
    const s = alsSnapshot(z.snapshot);
    return {
      id: z.id,
      belegNr: z.belegNr,
      typ: z.typ,
      titel: s.titel,
      abschnitt: s.abschnitt,
      ausgestelltAm: z.ausgestelltAm,
      status: z.status,
      storniertAm: z.storniertAm,
    };
  });
}
