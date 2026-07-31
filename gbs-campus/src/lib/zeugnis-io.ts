/**
 * GBS Campus — Zeugnisse & Bescheinigungen: Datenbank-Operationen
 *
 * Der IO-Teil zur DB-freien Kernlogik (`zeugnis.ts`) und zum PDF-Bau
 * (`zeugnis-beleg.ts`): Zeugnisse ausstellen (einfrieren), korrigieren
 * (Neuausstellung mit Storno), den Seriendruck erzeugen, die eigenen Zeugnisse
 * des Schülers laden und ein einzelnes als PDF ausliefern.
 *
 * Einfrieren: beim Ausstellen wird ein Snapshot der gedruckten Daten als JSON
 * festgeschrieben — eine spätere Noten-/Namensänderung verändert ein
 * ausgestelltes Zeugnis nicht mehr. Korrektur = Neuausstellung: das alte Zeugnis
 * wird ERSETZT (bleibt als Nachweis), ein neues mit höherer Version tritt an
 * seine Stelle.
 *
 * Eindeutigkeit: Semester-Zeugnis/Bescheinigung sind je (Person, Semester)
 * eindeutig; das **Abschlusszeugnis** dagegen je **Person** (sein Inhalt
 * aggregiert die ganze Ausbildung) — deshalb ist sein Storno-/Existenz-Scope
 * semesterunabhängig. Zwei partielle Unique-Indizes sichern beides in der DB.
 */

import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { protokolliere } from "@/lib/audit";
import { erzeugePdf } from "@/lib/pdf";
import { sendeMail } from "@/lib/mailer";
import { dmsAdresse } from "@/lib/konfiguration";
import { datum } from "@/lib/datum";
import { ladeAkteurNamen } from "@/lib/honorar-io";
import {
  baueZeugnisSnapshot,
  neueBelegNr,
  zeugnistypFuer,
  ZEUGNIS_ORT,
  type GewaehlterTyp,
  type Zeugnistypwert,
  type ZeugnisLeistungEingabe,
  type ZeugnisSnapshot,
} from "@/lib/zeugnis";
import { baueSeriendruckBloecke, baueZeugnisBloecke } from "@/lib/zeugnis-beleg";

/** Die eine dokumentierte JSON⇄Typ-Kopplung beim Lesen eines Snapshots. Alle
 * Snapshots stammen aus `baueZeugnisSnapshot`; die defensiven Leser weiter unten
 * (`?? []`, `?.`) fangen einen theoretischen Schema-Drift alter Zeilen ab. */
function alsSnapshot(json: Prisma.JsonValue): ZeugnisSnapshot {
  return json as unknown as ZeugnisSnapshot;
}

type LeistungZeile = ZeugnisLeistungEingabe;

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
 * Semester für Semester (ältestes zuerst), innerhalb je Fach sortiert. */
async function ladeGesamtLeistungen(personId: string): Promise<LeistungZeile[]> {
  const teilnahmen = await prisma.teilnahme.findMany({
    where: { personId },
    orderBy: { semester: { start: "asc" } },
    select: { leistungen: { select: LEISTUNG_SELECT } },
  });
  return teilnahmen.flatMap((t) => t.leistungen.slice().sort(nachSortierung)).map(zuLeistungZeile);
}

/** Die in einem Semester unterrichteten Fächer (Teilnahmebescheinigung des Hörers),
 * dedupliziert auf die Kurseinheit — alle als „teilgenommen". */
async function ladeSemesterFaecher(semesterId: string): Promise<LeistungZeile[]> {
  const termine = await prisma.unterrichtstermin.findMany({
    where: { semesterId, kurseinheitId: { not: null } },
    orderBy: { beginn: "asc" },
    select: { kurseinheitId: true, kurseinheit: { select: { titel: true, sortierung: true, fach: { select: { bezeichnung: true } } } } },
  });
  const gesehen = new Set<string>();
  const zeilen: LeistungRoh[] = [];
  for (const t of termine) {
    if (!t.kurseinheitId || !t.kurseinheit || gesehen.has(t.kurseinheitId)) continue;
    gesehen.add(t.kurseinheitId);
    zeilen.push({ ergebnis: "TEILGENOMMEN", punkte: null, note: null, kurseinheit: t.kurseinheit });
  }
  return zeilen.slice().sort(nachSortierung).map(zuLeistungZeile);
}

async function sammleInhalt(
  personId: string,
  typ: Zeugnistypwert,
  semesterId: string,
  semesterBezeichnung: string,
): Promise<{ abschnitt: string; leistungen: LeistungZeile[] }> {
  if (typ === "BESCHEINIGUNG") {
    return { abschnitt: semesterBezeichnung, leistungen: await ladeSemesterFaecher(semesterId) };
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

/** Schlüssel für die Batch-Existenzprüfung — beim Abschluss semesterunabhängig,
 * sonst je (Person, Typ, Semester). */
function gueltigSchluessel(personId: string, semesterId: string, typ: Zeugnistypwert): string {
  return typ === "ABSCHLUSS" ? `${personId}::ABSCHLUSS` : `${personId}::${typ}::${semesterId}`;
}

// -----------------------------------------------------------------------------
// Ausstellen (einfrieren) — mit Storno bei Neuausstellung
// -----------------------------------------------------------------------------

export type AusstellErgebnis =
  | { ok: true; zeugnisId: string; belegNr: string; typ: Zeugnistypwert; version: number; snapshot: ZeugnisSnapshot }
  | { fehler: "person_fehlt" | "semester_fehlt" | "nicht_eingeschrieben" | "gleichzeitig" };

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
    const neu = await prisma.$transaction(async (tx) => {
      // Erst das alte entwerten, DANN das neue anlegen — so kollidiert das neue
      // GUELTIG nicht mit dem alten am partiellen Unique-Index.
      if (alt) await tx.zeugnis.update({ where: { id: alt.id }, data: { status: "ERSETZT" } });
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

/** Einzel-Ausstellung (oder Korrektur/Neuausstellung) eines Schülers samt
 * DMS-Archivkopie. */
export async function stelleZeugnisAus(
  personId: string,
  gewaehlt: GewaehlterTyp,
  semesterId: string,
  akteurId: string,
  headers?: Headers,
): Promise<AusstellErgebnis> {
  const [person, semester, teilnahme] = await Promise.all([
    prisma.person.findUnique({ where: { id: personId }, select: { vorname: true, nachname: true, geburtsdatum: true } }),
    prisma.semester.findUnique({ where: { id: semesterId }, select: { bezeichnung: true } }),
    prisma.teilnahme.findUnique({ where: { personId_semesterId: { personId, semesterId } }, select: { teilnahmeform: true } }),
  ]);
  if (!person) return { fehler: "person_fehlt" };
  if (!semester) return { fehler: "semester_fehlt" };
  if (!teilnahme) return { fehler: "nicht_eingeschrieben" };

  const typ = zeugnistypFuer(teilnahme.teilnahmeform, gewaehlt);
  const alt = await prisma.zeugnis.findFirst({ where: gueltigWo(personId, semesterId, typ), select: { id: true, belegNr: true, version: true } });
  const ausstellerName = akteurId ? (await ladeAkteurNamen([akteurId])).get(akteurId) ?? null : null;

  const ergebnis = await fuehreAusstellungAus({
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
  if ("ok" in ergebnis) {
    await archiviereImDms([{ zeugnisId: ergebnis.zeugnisId, belegNr: ergebnis.belegNr, snapshot: ergebnis.snapshot }]);
  }
  return ergebnis;
}

export type BatchErgebnis = { ausgestellt: number; uebersprungen: number; gesamt: number };

/**
 * Sammel-Ausstellung je Semester (idempotent): stellt für jeden aktiven
 * Teilnehmer, der noch KEIN gültiges Zeugnis dieses Typs hat, eines aus — ein
 * zweiter Lauf überspringt die vorhandenen (kein Storno). Eine Korrektur läuft
 * bewusst über die Einzel-Neuausstellung. Kontext (Aussteller, Semester, Personen,
 * bestehende Zeugnisse) wird EINMAL gebündelt geladen, nicht je Teilnehmer.
 */
export async function stelleSemesterZeugnisseAus(
  semesterId: string,
  gewaehlt: GewaehlterTyp,
  akteurId: string,
  headers?: Headers,
): Promise<BatchErgebnis> {
  const [teilnahmen, semester, ausstellerName] = await Promise.all([
    prisma.teilnahme.findMany({
      where: { semesterId, person: { status: { istAktiv: true } } },
      orderBy: [{ person: { nachname: "asc" } }, { person: { vorname: "asc" } }],
      select: { personId: true, teilnahmeform: true },
    }),
    prisma.semester.findUnique({ where: { id: semesterId }, select: { bezeichnung: true } }),
    akteurId ? ladeAkteurNamen([akteurId]).then((m) => m.get(akteurId) ?? null) : Promise.resolve(null),
  ]);
  if (!semester || teilnahmen.length === 0) return { ausgestellt: 0, uebersprungen: 0, gesamt: teilnahmen.length };

  const personIds = teilnahmen.map((t) => t.personId);
  const [personen, gueltige] = await Promise.all([
    prisma.person.findMany({ where: { id: { in: personIds } }, select: { id: true, vorname: true, nachname: true, geburtsdatum: true } }),
    // ALLE gültigen Zeugnisse dieser Personen (auch aus anderen Semestern — wichtig
    // fürs Abschlusszeugnis, das je Person eindeutig ist).
    prisma.zeugnis.findMany({ where: { personId: { in: personIds }, status: "GUELTIG" }, select: { personId: true, semesterId: true, typ: true } }),
  ]);
  const personVon = new Map(personen.map((p) => [p.id, p]));
  const vorhandene = new Set(gueltige.map((z) => gueltigSchluessel(z.personId, z.semesterId, z.typ)));

  const neu: { zeugnisId: string; belegNr: string; snapshot: ZeugnisSnapshot }[] = [];
  let uebersprungen = 0;
  for (const t of teilnahmen) {
    const typ = zeugnistypFuer(t.teilnahmeform, gewaehlt);
    if (vorhandene.has(gueltigSchluessel(t.personId, semesterId, typ))) {
      uebersprungen++;
      continue;
    }
    const person = personVon.get(t.personId);
    if (!person) {
      uebersprungen++;
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
      else uebersprungen++; // z. B. Race
    } catch (fehler) {
      // Ein einzelner Fehler darf den Sammellauf nicht abbrechen — der Rest wird
      // ausgestellt, und die bereits Erfolgreichen werden am Ende archiviert.
      console.error("[ZEUGNIS] Ausstellung fehlgeschlagen für", t.personId, fehler);
      uebersprungen++;
    }
  }

  if (neu.length > 0) await archiviereImDms(neu);

  return { ausgestellt: neu.length, uebersprungen, gesamt: teilnahmen.length };
}

// -----------------------------------------------------------------------------
// DMS-Archivkopie (ein PDF, best-effort)
// -----------------------------------------------------------------------------

/**
 * Schickt eine Archivkopie der übergebenen Zeugnisse als EIN PDF ans DMS und
 * vermerkt den Versand. Best-effort: ein Fehler beim Versand rollt die Ausstellung
 * nicht zurück (wie beim Honorar-Beleg). Kein Personenname im Betreff — der bliebe
 * sonst in `email_versand` stehen und würde von der Anonymisierung nicht erfasst.
 */
async function archiviereImDms(zeugnisse: { zeugnisId: string; belegNr: string; snapshot: ZeugnisSnapshot }[]): Promise<void> {
  const an = dmsAdresse();
  if (!an || zeugnisse.length === 0) return;

  try {
    const pdf = erzeugePdf(baueSeriendruckBloecke(zeugnisse.map((z) => z.snapshot)));
    const einzeln = zeugnisse.length === 1;
    const betreff = einzeln
      ? `Zeugnis ${zeugnisse[0].belegNr} — ${zeugnisse[0].snapshot.abschnitt}`
      : `Zeugnisse Seriendruck (${zeugnisse.length}) — ${zeugnisse[0].snapshot.abschnitt}`;
    const ergebnis = await sendeMail({
      an,
      betreff,
      text:
        `Archivkopie ausgestellter Zeugnisse/Bescheinigungen der Gemeindebibelschule Minden.\n\n` +
        `Anzahl: ${zeugnisse.length}\nAbschnitt: ${zeugnisse[0].snapshot.abschnitt}\n` +
        (einzeln ? `Beleg-Nr.: ${zeugnisse[0].belegNr}\n` : "") +
        `\nDie vollständigen Dokumente liegen im angehängten PDF.`,
      anhaenge: [{ dateiname: einzeln ? `${zeugnisse[0].belegNr}.pdf` : `Zeugnisse-${zeugnisse.length}.pdf`, inhalt: pdf, typ: "application/pdf" }],
    });
    if (ergebnis.gesendet) {
      await prisma.zeugnis.updateMany({
        where: { id: { in: zeugnisse.map((z) => z.zeugnisId) } },
        data: { dmsGesendetAm: new Date() },
      });
    } else {
      console.warn(`[ZEUGNIS] DMS-Archivkopie nicht gesendet (${zeugnisse.length} Beleg(e), z. B. ${zeugnisse[0].belegNr})`);
    }
  } catch (fehler) {
    console.error("[ZEUGNIS] DMS-Archivkopie fehlgeschlagen", fehler);
  }
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
 * Abschlüsse existieren).
 */
export async function erzeugeSeriendruckPdf(semesterId: string, gewaehlt: GewaehlterTyp): Promise<SeriendruckErgebnis> {
  const zeilen = await ladeZeugnisUebersicht(semesterId, gewaehlt);
  const ids = zeilen.map((z) => z.zeugnis?.id).filter((x): x is string => Boolean(x));
  if (ids.length === 0) return { leer: true };

  const zeugnisse = await prisma.zeugnis.findMany({ where: { id: { in: ids } }, select: { snapshot: true } });
  // Nach Namen sortieren, damit der Stapel alphabetisch liegt (defensiv gegen einen
  // theoretisch fehlenden Namen in einem Altsnapshot).
  const snapshots = zeugnisse
    .map((z) => alsSnapshot(z.snapshot))
    .sort((a, b) => (a.person?.name ?? "").localeCompare(b.person?.name ?? "", "de"));
  return { pdf: erzeugePdf(baueSeriendruckBloecke(snapshots)), anzahl: snapshots.length };
}

export type ZeugnisDokument = { personId: string; belegNr: string; snapshot: ZeugnisSnapshot };

/** Lädt ein Zeugnis für den Download (personId + belegNr + Snapshot) — der
 * Aufrufer prüft mit `personId` den Zugriff VOR der PDF-Erzeugung. Null, wenn es
 * das Zeugnis nicht gibt. */
export async function ladeZeugnisFuerDownload(zeugnisId: string): Promise<ZeugnisDokument | null> {
  const z = await prisma.zeugnis.findUnique({ where: { id: zeugnisId }, select: { personId: true, belegNr: true, snapshot: true } });
  if (!z) return null;
  return { personId: z.personId, belegNr: z.belegNr, snapshot: alsSnapshot(z.snapshot) };
}

/** Erzeugt das PDF aus einem bereits geladenen Snapshot (nach der Zugriffsprüfung). */
export function erzeugeZeugnisPdfAusSnapshot(snapshot: ZeugnisSnapshot): Buffer {
  return erzeugePdf(baueZeugnisBloecke(snapshot));
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
};

/**
 * Schulleitungssicht: je aktivem Teilnehmer des Semesters der Typ, den er
 * bekäme, und das aktuell gültige Zeugnis (falls schon ausgestellt) — so ist auf
 * einen Blick sichtbar, wer eins hat und wer nicht.
 */
export async function ladeZeugnisUebersicht(semesterId: string, gewaehlt: GewaehlterTyp): Promise<ZeugnisPersonZeile[]> {
  const teilnahmen = await prisma.teilnahme.findMany({
    where: { semesterId, person: { status: { istAktiv: true } } },
    orderBy: [{ person: { nachname: "asc" } }, { person: { vorname: "asc" } }],
    select: { personId: true, teilnahmeform: true, person: { select: { vorname: true, nachname: true } } },
  });

  const typVon = new Map(teilnahmen.map((t) => [t.personId, zeugnistypFuer(t.teilnahmeform, gewaehlt)]));
  // Gültige Zeugnisse dieser Personen — für das Abschlusszeugnis semesterunabhängig,
  // deshalb ohne semesterId-Filter (matcht dann über den Typ-Schlüssel).
  const gueltige = await prisma.zeugnis.findMany({
    where: { status: "GUELTIG", personId: { in: teilnahmen.map((t) => t.personId) } },
    select: { id: true, personId: true, typ: true, semesterId: true, belegNr: true, version: true, ausgestelltAm: true },
  });
  const zeugnisVon = new Map<string, { id: string; belegNr: string; version: number; ausgestelltAm: Date }>();
  for (const z of gueltige) {
    const erwarteterTyp = typVon.get(z.personId);
    if (erwarteterTyp !== z.typ) continue;
    // Semester-Zeugnis/Bescheinigung nur aus DIESEM Semester zählen; das
    // Abschlusszeugnis semesterunabhängig.
    if (z.typ !== "ABSCHLUSS" && z.semesterId !== semesterId) continue;
    zeugnisVon.set(z.personId, { id: z.id, belegNr: z.belegNr, version: z.version, ausgestelltAm: z.ausgestelltAm });
  }

  return teilnahmen.map((t) => ({
    personId: t.personId,
    name: `${t.person.nachname}, ${t.person.vorname}`,
    teilnahmeform: t.teilnahmeform,
    // ! ist sicher: typVon ist aus demselben teilnahmen-Array gebaut.
    typ: typVon.get(t.personId)!,
    zeugnis: zeugnisVon.get(t.personId) ?? null,
  }));
}

export type EigenesZeugnis = { id: string; belegNr: string; titel: string; abschnitt: string; ausgestelltAm: Date };

/** Die eigenen gültigen Zeugnisse des Schülers (für /meine-daten, read-only). */
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
