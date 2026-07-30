/**
 * GBS Campus — Honorar-Abrechnung / Auszahlung: Datenbank-Operationen
 *
 * Eine Abrechnung fasst die gehaltenen Abende eines Dozenten in einem Semester
 * zusammen und friert den Betrag je Abend ein (Posten). Zwei Schritte:
 * erstellen (OFFEN) → freigeben (FREIGEGEBEN, Zahlungsbeleg mit IBAN ans DMS) →
 * als ausgezahlt markieren (AUSGEZAHLT). Die reine Belegdarstellung liegt DB-frei
 * in `honorar-abrechnung-beleg.ts`.
 */

import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { protokolliere } from "@/lib/audit";
import { erzeugePdf } from "@/lib/pdf";
import { sendeMail } from "@/lib/mailer";
import { dmsAdresse } from "@/lib/konfiguration";
import { entschluesseln } from "@/lib/encryption";
import { satzFuer } from "@/lib/honorar";
import { ladeSatzZeilen, ladeAkteurNamen } from "@/lib/honorar-io";
import { baueAbrechnungBelegBloecke, type AbrechnungBelegDaten } from "@/lib/honorar-abrechnung-beleg";
import { HonorarAbrechnungStatus, Prisma } from "@prisma/client";

/** Menschlicher Text zum Abrechnungsstatus. */
export function abrechnungStatusText(status: HonorarAbrechnungStatus): string {
  switch (status) {
    case "OFFEN":
      return "Offen";
    case "FREIGEGEBEN":
      return "Freigegeben zur Auszahlung";
    case "AUSGEZAHLT":
      return "Ausgezahlt";
  }
}

// -----------------------------------------------------------------------------
// Überblick je Dozent (gehalten / offen / abgerechnet)
// -----------------------------------------------------------------------------

export type AbrechnungKurz = {
  id: string;
  status: HonorarAbrechnungStatus;
  summe: number;
  abende: number;
};

export type DozentZeile = {
  dozentId: string;
  name: string;
  gehalten: number; // gehaltene Abende gesamt
  offenAbende: number; // gehalten und noch nicht abgerechnet
  offenBetrag: number; // zum aktuell geltenden Satz
  abrechnungen: AbrechnungKurz[];
};

/**
 * Überblick eines Semesters: je Dozent die gehaltenen Abende, davon die noch
 * offenen (nicht abgerechneten) mit Betrag, und die bestehenden Abrechnungen mit
 * Status. So ist auf einen Blick sichtbar, was abgerechnet ist und was nicht.
 */
export async function ladeAbrechnungsUebersicht(semesterId: string): Promise<DozentZeile[]> {
  const jetzt = new Date();
  const [saetze, termine, abrechnungen] = await Promise.all([
    ladeSatzZeilen(),
    prisma.unterrichtstermin.findMany({
      where: { semesterId, dozentId: { not: null }, beginn: { lte: jetzt } },
      select: { dozentId: true, beginn: true, abrechnungPosten: { select: { id: true } } },
    }),
    prisma.honorarAbrechnung.findMany({
      where: { semesterId },
      select: { id: true, dozentId: true, status: true, summe: true, _count: { select: { posten: true } } },
      orderBy: { erstelltAm: "asc" },
    }),
  ]);

  const proDozent = new Map<string, { gehalten: number; offenAbende: number; offenBetrag: number }>();
  for (const t of termine) {
    if (!t.dozentId) continue;
    const e = proDozent.get(t.dozentId) ?? { gehalten: 0, offenAbende: 0, offenBetrag: 0 };
    e.gehalten += 1;
    if (!t.abrechnungPosten) {
      e.offenAbende += 1;
      e.offenBetrag += satzFuer(t.beginn, saetze);
    }
    proDozent.set(t.dozentId, e);
  }

  const abrProDozent = new Map<string, AbrechnungKurz[]>();
  for (const a of abrechnungen) {
    const liste = abrProDozent.get(a.dozentId) ?? [];
    liste.push({ id: a.id, status: a.status, summe: a.summe, abende: a._count.posten });
    abrProDozent.set(a.dozentId, liste);
  }

  const ids = [...new Set([...proDozent.keys(), ...abrechnungen.map((a) => a.dozentId)])];
  const namen = await ladeAkteurNamen(ids);

  return ids
    .map((dozentId) => {
      const s = proDozent.get(dozentId) ?? { gehalten: 0, offenAbende: 0, offenBetrag: 0 };
      return {
        dozentId,
        name: namen.get(dozentId) ?? "—",
        gehalten: s.gehalten,
        offenAbende: s.offenAbende,
        offenBetrag: s.offenBetrag,
        abrechnungen: abrProDozent.get(dozentId) ?? [],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
}

// -----------------------------------------------------------------------------
// Abrechnung erstellen (Beträge einfrieren)
// -----------------------------------------------------------------------------

export type ErstellenErgebnis =
  | { ok: true; abrechnungId: string; abende: number; summe: number }
  | { ok: false; meldung: string };

/**
 * Erstellt eine Abrechnung für einen Dozenten in einem Semester: friert alle
 * gehaltenen, noch nicht abgerechneten Abende als Posten ein (Datum, Fach und
 * der zum jeweiligen Datum geltende Satz). Das `@@unique` auf `terminId` sichert
 * gegen Doppel-Abrechnung auch bei parallelen Aufrufen.
 */
export async function erstelleAbrechnung(
  dozentId: string,
  semesterId: string,
  akteurId: string,
  headers?: Headers,
): Promise<ErstellenErgebnis> {
  const jetzt = new Date();
  const [saetze, offene] = await Promise.all([
    ladeSatzZeilen(),
    prisma.unterrichtstermin.findMany({
      where: { dozentId, semesterId, beginn: { lte: jetzt }, abrechnungPosten: { is: null } },
      select: { id: true, beginn: true, kurseinheit: { select: { fach: { select: { bezeichnung: true } } } } },
      orderBy: { beginn: "asc" },
    }),
  ]);

  if (offene.length === 0) {
    return {
      ok: false,
      meldung: "Für diesen Dozenten gibt es in diesem Semester keine offenen (gehaltenen, noch nicht abgerechneten) Abende.",
    };
  }

  const posten = offene.map((t) => ({
    terminId: t.id,
    datum: t.beginn,
    fach: t.kurseinheit?.fach.bezeichnung ?? null,
    betrag: satzFuer(t.beginn, saetze),
  }));
  const summe = posten.reduce((s, p) => s + p.betrag, 0);

  try {
    const abrechnung = await prisma.honorarAbrechnung.create({
      data: {
        dozentId,
        semesterId,
        summe,
        erstelltVonId: akteurId,
        posten: { create: posten },
      },
    });

    await protokolliere({
      aktion: "HONORAR_ABRECHNUNG_ERSTELLT",
      objektTyp: "HonorarAbrechnung",
      objektId: abrechnung.id,
      akteurId,
      nachher: { dozentId, semesterId, abende: posten.length, summe },
      headers,
    });

    return { ok: true, abrechnungId: abrechnung.id, abende: posten.length, summe };
  } catch (fehler) {
    // Nur die Unique-Verletzung auf terminId (P2002) heißt „schon abgerechnet".
    // Jeder andere Fehler (DB weg, o. Ä.) wird weitergeworfen, damit die
    // 500-Guard der Route greift — sonst würde ein echter Serverfehler als
    // harmlose 400 getarnt.
    if (fehler instanceof Prisma.PrismaClientKnownRequestError && fehler.code === "P2002") {
      return {
        ok: false,
        meldung: "Die Abrechnung konnte nicht angelegt werden — ein Abend wurde zwischenzeitlich schon abgerechnet. Bitte neu laden.",
      };
    }
    throw fehler;
  }
}

// -----------------------------------------------------------------------------
// Detail und Liste
// -----------------------------------------------------------------------------

export type AbrechnungPostenAnzeige = { datum: Date; fach: string | null; betrag: number };
export type AbrechnungDetail = {
  id: string;
  dozentName: string;
  hatBankverbindung: boolean;
  semester: string;
  status: HonorarAbrechnungStatus;
  summe: number;
  belegNr: string | null;
  dmsGesendetAm: Date | null;
  erstelltVon: string | null;
  erstelltAm: Date;
  freigegebenVon: string | null;
  freigegebenAm: Date | null;
  ausgezahltVon: string | null;
  ausgezahltAm: Date | null;
  notiz: string | null;
  posten: AbrechnungPostenAnzeige[];
};

export async function ladeAbrechnung(id: string): Promise<AbrechnungDetail | null> {
  const a = await prisma.honorarAbrechnung.findUnique({
    where: { id },
    include: {
      posten: { orderBy: { datum: "asc" }, select: { datum: true, fach: true, betrag: true } },
      dozent: { select: { vorname: true, nachname: true, ibanVerschluesselt: true } },
      semester: { select: { bezeichnung: true } },
    },
  });
  if (!a) return null;

  const namen = await ladeAkteurNamen(
    [a.erstelltVonId, a.freigegebenVonId, a.ausgezahltVonId].filter((x): x is string => !!x),
  );

  return {
    id: a.id,
    dozentName: `${a.dozent.nachname}, ${a.dozent.vorname}`,
    hatBankverbindung: a.dozent.ibanVerschluesselt !== null,
    semester: a.semester.bezeichnung,
    status: a.status,
    summe: a.summe,
    belegNr: a.belegNr,
    dmsGesendetAm: a.dmsGesendetAm,
    erstelltVon: a.erstelltVonId ? namen.get(a.erstelltVonId) ?? "—" : null,
    erstelltAm: a.erstelltAm,
    freigegebenVon: a.freigegebenVonId ? namen.get(a.freigegebenVonId) ?? "—" : null,
    freigegebenAm: a.freigegebenAm,
    ausgezahltVon: a.ausgezahltVonId ? namen.get(a.ausgezahltVonId) ?? "—" : null,
    ausgezahltAm: a.ausgezahltAm,
    notiz: a.notiz,
    posten: a.posten,
  };
}

// -----------------------------------------------------------------------------
// Freigabe (Zahlungsbeleg mit IBAN ans DMS)
// -----------------------------------------------------------------------------

/** Eindeutige Beleg-Nummer, z. B. HONA-2026-07-30-1A2B3C4D. */
function neueBelegNr(am: Date): string {
  return `HONA-${am.toISOString().slice(0, 10)}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export type FreigabeErgebnis =
  | { ok: true; belegNr: string; dmsGesendet: boolean }
  | { ok: false; meldung: string };

/**
 * Gibt eine offene Abrechnung zur Auszahlung frei und schickt den Zahlungsbeleg
 * (mit IBAN im Klartext) an das DMS. Der Status wird ZUERST gesetzt (die Freigabe
 * ist die fachliche Tatsache) — scheitert der Belegversand, bleibt die Abrechnung
 * freigegeben und der Versand sichtbar offen (dmsGesendetAm leer).
 *
 * Erfordert eine hinterlegte Bankverbindung; der Aufrufer (Route) muss zusätzlich
 * das Recht BANKVERBINDUNG_LESEN prüfen, weil hier die IBAN herausgegeben wird.
 */
export async function gibAbrechnungFrei(abrechnungId: string, akteurId: string, headers?: Headers): Promise<FreigabeErgebnis> {
  const a = await prisma.honorarAbrechnung.findUnique({
    where: { id: abrechnungId },
    include: {
      posten: { orderBy: { datum: "asc" }, select: { datum: true, fach: true, betrag: true } },
      dozent: { select: { vorname: true, nachname: true, kontoinhaber: true, ibanVerschluesselt: true } },
      semester: { select: { bezeichnung: true } },
    },
  });
  if (!a) return { ok: false, meldung: "Diese Abrechnung gibt es nicht." };
  if (a.status !== "OFFEN") return { ok: false, meldung: "Nur eine offene Abrechnung kann freigegeben werden." };
  if (!a.dozent.ibanVerschluesselt) {
    return { ok: false, meldung: "Für diesen Dozenten ist keine Bankverbindung hinterlegt. Bitte zuerst die IBAN erfassen." };
  }

  let iban: string;
  try {
    iban = entschluesseln(a.dozent.ibanVerschluesselt);
  } catch (fehler) {
    console.error("[HONORAR-ABRECHNUNG] IBAN nicht entschlüsselbar für Abrechnung", a.id, fehler);
    return { ok: false, meldung: "Die Bankverbindung ist nicht lesbar. Vermutlich passt der Verschlüsselungsschlüssel nicht zu den Daten." };
  }

  const jetzt = new Date();
  const belegNr = neueBelegNr(jetzt);

  // Atomarer Statuswechsel OFFEN -> FREIGEGEBEN: nur EIN Aufruf gewinnt. Ohne die
  // Bedingung `status: "OFFEN"` im updateMany könnten zwei nahezu gleichzeitige
  // Freigaben (zwei Tabs/Retries) beide durchlaufen und den IBAN-Beleg DOPPELT ans
  // DMS schicken. Der Verlierer bekommt count 0 und bricht ab.
  const anspruch = await prisma.honorarAbrechnung.updateMany({
    where: { id: a.id, status: "OFFEN" },
    data: { status: "FREIGEGEBEN", freigegebenVonId: akteurId, freigegebenAm: jetzt, belegNr },
  });
  if (anspruch.count === 0) {
    return { ok: false, meldung: "Diese Abrechnung wurde zwischenzeitlich schon freigegeben." };
  }

  // Die Freigabe wird protokolliert. `belegEnthaeltIban` ist eine Aussage ÜBER den
  // Beleg (er trägt die IBAN), keine Zustellungsbehauptung — ob er das DMS erreicht
  // hat, sagt `dmsGesendetAm`. Die IBAN selbst steht nie im Audit (GEHEIM).
  await protokolliere({
    aktion: "HONORAR_ABRECHNUNG_FREIGEGEBEN",
    objektTyp: "HonorarAbrechnung",
    objektId: a.id,
    akteurId,
    nachher: { belegNr, summe: a.summe, belegEnthaeltIban: true },
    headers,
  });

  let dmsGesendet = false;
  try {
    const freigeberName = akteurId ? (await ladeAkteurNamen([akteurId])).get(akteurId) ?? null : null;
    const dozentName = `${a.dozent.nachname}, ${a.dozent.vorname}`;
    const daten: AbrechnungBelegDaten = {
      belegNr,
      erzeugtAm: jetzt,
      dozent: dozentName,
      semester: a.semester.bezeichnung,
      statusText: abrechnungStatusText("FREIGEGEBEN"),
      kontoinhaber: a.dozent.kontoinhaber,
      iban,
      freigegebenVon: freigeberName,
      freigegebenAm: jetzt,
      ausgezahltAm: null,
      posten: a.posten,
      summe: a.summe,
      notiz: a.notiz,
    };
    const pdf = erzeugePdf(baueAbrechnungBelegBloecke(daten));

    const an = dmsAdresse();
    if (an) {
      const ergebnis = await sendeMail({
        // Kein Dozentenname im Betreff: `email_versand.betreff` bleibt in unserer
        // Datenbank stehen und würde von der Anonymisierung (Art. 17) nicht
        // erfasst. Der Name steht im PDF und im Text; Beleg-Nr + Semester genügen
        // hier zur Zuordnung.
        an,
        betreff: `Honorar-Abrechnung ${belegNr} — ${a.semester.bezeichnung}`,
        text:
          `Zahlungsbeleg der Gemeindebibelschule Minden zur Freigabe der Dozentenhonorar-Auszahlung.\n\n` +
          `Dozent: ${dozentName}\nSemester: ${a.semester.bezeichnung}\nSumme: ${a.summe} EUR\nBeleg-Nr.: ${belegNr}\n\n` +
          `Der vollständige Beleg mit Zahlungsempfänger (inkl. IBAN) und allen Positionen liegt im angehängten PDF.`,
        anhaenge: [{ dateiname: `${belegNr}.pdf`, inhalt: pdf, typ: "application/pdf" }],
      });
      dmsGesendet = ergebnis.gesendet;
    }

    if (dmsGesendet) {
      await prisma.honorarAbrechnung.update({ where: { id: a.id }, data: { dmsGesendetAm: new Date() } });
    }
  } catch (fehler) {
    console.error("[HONORAR-ABRECHNUNG] DMS-Beleg konnte nicht erzeugt/versendet werden für", a.id, fehler);
  }

  return { ok: true, belegNr, dmsGesendet };
}

// -----------------------------------------------------------------------------
// Als ausgezahlt markieren
// -----------------------------------------------------------------------------

export type AusgezahltErgebnis = { ok: true } | { ok: false; meldung: string };

export async function markiereAusgezahlt(
  abrechnungId: string,
  ausgezahltAm: Date,
  akteurId: string,
  headers?: Headers,
): Promise<AusgezahltErgebnis> {
  // Atomarer Statuswechsel FREIGEGEBEN -> AUSGEZAHLT: nur EIN Aufruf gewinnt (kein
  // doppelter Audit-Eintrag/überschriebenes Datum bei parallelen Anfragen).
  const anspruch = await prisma.honorarAbrechnung.updateMany({
    where: { id: abrechnungId, status: "FREIGEGEBEN" },
    data: { status: "AUSGEZAHLT", ausgezahltVonId: akteurId, ausgezahltAm },
  });
  if (anspruch.count === 0) {
    const vorhanden = await prisma.honorarAbrechnung.findUnique({ where: { id: abrechnungId }, select: { status: true } });
    if (!vorhanden) return { ok: false, meldung: "Diese Abrechnung gibt es nicht." };
    return { ok: false, meldung: "Nur eine freigegebene Abrechnung kann als ausgezahlt markiert werden." };
  }

  await protokolliere({
    aktion: "HONORAR_ABRECHNUNG_AUSGEZAHLT",
    objektTyp: "HonorarAbrechnung",
    objektId: abrechnungId,
    akteurId,
    nachher: { ausgezahltAm: ausgezahltAm.toISOString().slice(0, 10) },
    headers,
  });

  return { ok: true };
}
