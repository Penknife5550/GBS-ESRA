/**
 * GBS Campus — Semesterüberleitung (Re-Enrollment)
 *
 * Der IO-Teil: einen Jahrgang ins Folgesemester einladen, die „bin dabei"-
 * Bestätigung einlösen und die Erinnerungen T-14/-7/-3 verschicken. Die
 * DB-freie Kernlogik (Erinnerungsstichtage, Auswahl der Übernahme) liegt in
 * `semester.ts` und ist dort ohne Postgres testbar.
 *
 * Token-Muster wie überall im System (magic-link, auskunft): Es wird nur der
 * SHA-256-Hash gespeichert, der Klartext lebt ausschließlich in der Mail-URL.
 * Der Bestätigungslink gewährt KEINE Sitzung — ein Klick meldet niemanden an,
 * er setzt nur `Teilnahme.bestaetigtAm`.
 */

import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/magic-link";
import { fuelleVorlage, sendeMail } from "@/lib/mailer";
import { zahl } from "@/lib/einstellungen";
import { protokolliere } from "@/lib/audit";
import { MAIL_VORLAGE } from "@/lib/constants";
import { faelligeErinnerungsstufe, erinnerungsFeld, semesterZeitraum, type Erinnerungsstufe } from "@/lib/semester";

function bestaetigungsLink(token: string): string {
  const basis = process.env.APP_URL ?? "http://localhost:3000";
  // Token im URL-FRAGMENT (#) — wie beim Anmelde- und Auskunftslink: das
  // Fragment schickt der Browser nicht an den Server, es landet in keinem
  // Zugriffslog und kein Link-Scanner ruft es vorab ab.
  return `${basis}/dabei/token#token=${token}`;
}

// -----------------------------------------------------------------------------
// Überleitung anstoßen
// -----------------------------------------------------------------------------

export type UeberleitungErgebnis =
  | { status: "ziel_fehlt" }
  | { status: "kein_laufendes" }
  | { status: "ziel_ist_laufendes" }
  | { status: "ok"; eingeladen: number; gesendet: number };

/**
 * Lädt den aktiven Jahrgang des laufenden Semesters ins gewählte Folgesemester
 * ein: legt je Teilnehmer eine noch unbestätigte Teilnahme mit persönlichem
 * Bestätigungslink an und verschickt die Einladung.
 *
 * Idempotent: Wer im Zielsemester schon eine Teilnahme hat (früherer Lauf,
 * Aufnahme), wird übersprungen — ein zweiter Aufruf lädt niemanden doppelt ein.
 * Die Teilnahmeform wird aus dem laufenden Semester übernommen, nie geraten.
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

  // Suchen und Anlegen in EINER Transaktion — wie bei der Sammelübernahme,
  // damit ein Doppelklick nicht zweimal dieselben Teilnahmen zu erzeugen
  // versucht.
  const neue = await prisma.$transaction(async (tx) => {
    const quelle = await tx.teilnahme.findMany({
      where: { semesterId: laufend.id, person: { status: { istAktiv: true } } },
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

    if (anzulegen.length > 0) {
      await tx.teilnahme.createMany({
        // Der Bestätigungslink gilt bis zum Semesterstart — bis dahin kann man
        // „bin dabei" sagen. Danach räumt ihn der Aufräumlauf weg.
        data: anzulegen.map((a) => ({
          personId: a.person.id,
          semesterId: ziel.id,
          teilnahmeform: a.teilnahmeform,
          bestaetigungTokenHash: hashToken(a.token),
          bestaetigungLaeuftAb: ziel.start,
        })),
        // Zweite Sicherung gegen den Unique-Index (personId, semesterId): eine
        // Doppelanlage darf die Überleitung nie mit einem 500 beenden.
        skipDuplicates: true,
      });
    }
    return anzulegen;
  });

  // Einladungen außerhalb der Transaktion: Mailversand darf sie nicht sprengen,
  // und `sendeMail` schreibt sein eigenes Versandprotokoll.
  const vorlage = await prisma.emailVorlage.findUnique({
    where: { code: MAIL_VORLAGE.UEBERLEITUNG_EINLADUNG },
  });
  const zeitraum = semesterZeitraum(ziel.start, ziel.ende);
  let gesendet = 0;
  for (const a of neue) {
    const werte = {
      vorname: a.person.vorname,
      semester: ziel.bezeichnung,
      zeitraum,
      link: bestaetigungsLink(a.token),
    };
    const { gesendet: ok } = await sendeMail({
      an: a.person.email,
      personId: a.person.id,
      vorlageCode: MAIL_VORLAGE.UEBERLEITUNG_EINLADUNG,
      betreff: fuelleVorlage(vorlage?.betreff ?? "Bist du im {{semester}} dabei?", werte),
      text: fuelleVorlage(vorlage?.textMd ?? "Hallo {{vorname}},\n\n{{link}}", werte),
    });
    if (ok) gesendet++;
  }

  await protokolliere({
    aktion: "SEMESTER_UEBERLEITUNG_GESTARTET",
    objektTyp: "Semester",
    objektId: ziel.id,
    akteurId,
    nachher: { von: laufend.code, nach: ziel.code, eingeladen: neue.length, gesendet },
    headers,
  });

  return { status: "ok", eingeladen: neue.length, gesendet };
}

// -----------------------------------------------------------------------------
// „Ich bin dabei" bestätigen
// -----------------------------------------------------------------------------

export type BestaetigungErgebnis =
  | { status: "ok"; semester: string; vorname: string; faecher: string[]; teilnahmeId: string; personId: string }
  | { status: "schon_bestaetigt"; semester: string; vorname: string; faecher: string[]; teilnahmeId: string; personId: string }
  | { status: "ungueltig" };

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
 * Löst einen „bin dabei"-Token ein und setzt `bestaetigtAm`. Idempotent und
 * race-sicher: ein zweiter Klick (oder zwei gleichzeitige) melden freundlich
 * „schon bestätigt", nie einen Fehler. Es entsteht KEINE Sitzung.
 */
export async function bestaetigeTeilnahme(token: string): Promise<BestaetigungErgebnis> {
  const eintrag = await prisma.teilnahme.findUnique({
    where: { bestaetigungTokenHash: hashToken(token) },
    select: {
      id: true,
      bestaetigtAm: true,
      bestaetigungLaeuftAb: true,
      semester: { select: { bezeichnung: true, lehrjahr: true, halbjahr: true } },
      person: { select: { id: true, vorname: true } },
    },
  });
  if (!eintrag) return { status: "ungueltig" };
  if (!eintrag.bestaetigungLaeuftAb || eintrag.bestaetigungLaeuftAb < new Date()) {
    return { status: "ungueltig" };
  }

  const gemeinsam = {
    semester: eintrag.semester.bezeichnung,
    vorname: eintrag.person.vorname,
    faecher: await faecherDesSemesters(eintrag.semester.lehrjahr, eintrag.semester.halbjahr),
    teilnahmeId: eintrag.id,
    personId: eintrag.person.id,
  };

  if (eintrag.bestaetigtAm) return { status: "schon_bestaetigt", ...gemeinsam };

  // Erst die Wirkung, race-sicher über bedingtes updateMany: nur einer gewinnt.
  const gesetzt = await prisma.teilnahme.updateMany({
    where: { id: eintrag.id, bestaetigtAm: null },
    data: { bestaetigtAm: new Date() },
  });
  if (gesetzt.count !== 1) return { status: "schon_bestaetigt", ...gemeinsam };

  return { status: "ok", ...gemeinsam };
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

/**
 * Baut die where/data-Teile für die Stufen-Spalte typsicher (kein dynamischer
 * Schlüssel in Prisma-Inputs — deshalb explizit je Stufe).
 */
function stufenMarke(feld: StufeFeld, jetzt: Date): {
  wo: Prisma.TeilnahmeWhereInput;
  data: Prisma.TeilnahmeUpdateManyMutationInput;
} {
  switch (feld) {
    case "erinnertStufe1Am":
      return { wo: { erinnertStufe1Am: null }, data: { erinnertStufe1Am: jetzt } };
    case "erinnertStufe2Am":
      return { wo: { erinnertStufe2Am: null }, data: { erinnertStufe2Am: jetzt } };
    case "erinnertStufe3Am":
      return { wo: { erinnertStufe3Am: null }, data: { erinnertStufe3Am: jetzt } };
  }
}

/**
 * Verschickt die heute fälligen Erinnerungen an noch nicht bestätigte
 * Teilnahmen. Für jedes Semester mit offenen Bestätigungen wird geprüft, ob
 * heute ein Stichtag (T-14/-7/-3, konfigurierbar) ist; wenn ja, gehen an alle
 * offenen Teilnahmen dieser Stufe (die noch nicht angeschrieben wurden und deren
 * Person `automatikMails` erlaubt) Erinnerungen.
 *
 * Idempotent und race-sicher: Die Stufen-Marke wird per bedingtem updateMany
 * gesetzt; nur wer sie setzt, verschickt — ein doppelter Cron-Aufruf am selben
 * Tag schreibt niemandem zweimal. Dabei wird der Bestätigungslink rotiert
 * (frischer Token, gültig bis Semesterstart): Die jeweils neueste Erinnerung
 * trägt den gültigen Link, ältere verfallen. Bewusst Marke-vor-Versand, damit
 * ein Prozessabbruch keinen Doppelversand erzeugt — ein SMTP-Ausfall macht sich
 * sichtbar über die FEHLER-Zeilen in `email_versand`.
 */
export async function fuehreErinnerungslauf(jetzt: Date): Promise<ErinnerungBericht[]> {
  const offsets: [number, number, number] = [
    await zahl("SEMESTER_ERINNERUNG_1_TAGE"),
    await zahl("SEMESTER_ERINNERUNG_2_TAGE"),
    await zahl("SEMESTER_ERINNERUNG_3_TAGE"),
  ];

  const semester = await prisma.semester.findMany({
    where: { teilnahmen: { some: { bestaetigtAm: null, bestaetigungTokenHash: { not: null } } } },
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
        bestaetigtAm: null,
        bestaetigungTokenHash: { not: null },
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
    let angeschrieben = 0;
    let gesendet = 0;

    for (const t of offene) {
      if (t[feld] !== null) continue; // diese Stufe schon raus
      const token = randomUUID();
      const { wo, data } = stufenMarke(feld, new Date());

      const beansprucht = await prisma.teilnahme.updateMany({
        where: { id: t.id, bestaetigtAm: null, ...wo },
        data: { ...data, bestaetigungTokenHash: hashToken(token), bestaetigungLaeuftAb: s.start },
      });
      if (beansprucht.count !== 1) continue; // paralleler Lauf war schneller

      angeschrieben++;
      const werte = {
        vorname: t.person.vorname,
        semester: s.bezeichnung,
        zeitraum,
        link: bestaetigungsLink(token),
      };
      const { gesendet: ok } = await sendeMail({
        an: t.person.email,
        personId: t.person.id,
        vorlageCode: MAIL_VORLAGE.UEBERLEITUNG_ERINNERUNG,
        betreff: fuelleVorlage(vorlage?.betreff ?? "Erinnerung: Bist du im {{semester}} dabei?", werte),
        text: fuelleVorlage(vorlage?.textMd ?? "Hallo {{vorname}},\n\n{{link}}", werte),
      });
      if (ok) gesendet++;
    }

    if (angeschrieben > 0) {
      berichte.push({ semesterCode: s.code, stufe, angeschrieben, gesendet });
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
