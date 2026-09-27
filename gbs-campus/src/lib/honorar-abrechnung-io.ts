/**
 * GBS Campus — Honorar-Abrechnung / Auszahlung: Datenbank-Operationen
 *
 * Eine Abrechnung fasst die gehaltenen Abende eines Dozenten in einem Semester
 * zusammen und friert den Betrag je Abend ein (Posten). Zwei Schritte:
 * erstellen (OFFEN) → freigeben (FREIGEGEBEN, Zahlungsbeleg mit IBAN ans DMS) →
 * als ausgezahlt markieren (AUSGEZAHLT). Korrekturwege: eine OFFENE Abrechnung
 * stornieren, einen nicht angekommenen Beleg nachsenden. Die reine
 * Belegdarstellung liegt DB-frei in `honorar-abrechnung-beleg.ts`, die Regeln der
 * Korrekturwege in `honorar-korrektur.ts`.
 */

import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { protokolliere } from "@/lib/audit";
import { erzeugePdf } from "@/lib/pdf";
import { dmsAdresse } from "@/lib/konfiguration";
import { entschluesseln } from "@/lib/encryption";
import { abrechnungStatusText, bauePosten, honorarBelegNr, satzFuer } from "@/lib/honorar";
import { ladeSatzZeilen } from "@/lib/honorar-io";
import { mitDmsSperre, sendeBelegAnDms } from "@/lib/dms";
import { ladeAkteurNamen } from "@/lib/personen-namen";
import {
  baueAbrechnungBelegBloecke,
  baueAbrechnungDmsMail,
  type AbrechnungBelegDaten,
} from "@/lib/honorar-abrechnung-beleg";
import {
  nachversandErgebnis,
  pruefeAbrechnungNachversand,
  type BelegAusgang,
  type DmsVersand,
  type KorrekturFehler,
  type NachversandErgebnis,
} from "@/lib/honorar-korrektur";
import { HonorarAbrechnungStatus, Prisma } from "@prisma/client";

/** Menschlicher Text zum Abrechnungsstatus — liegt DB-frei in honorar.ts. */
export { abrechnungStatusText };

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
  offenBetrag: number; // je Abend zu dem Satz, der an seinem Datum galt (satzFuer)
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
  | { ok: false; code: KorrekturFehler; meldung: string };

/** Abbruchsignal der Gegenprobe in `erstelleAbrechnung` (rollt die Transaktion zurück). */
class ZuordnungGeaendert extends Error {}

/**
 * Erstellt eine Abrechnung für einen Dozenten in einem Semester: friert alle
 * gehaltenen, noch nicht abgerechneten Abende als Posten ein (Datum, Fach und
 * der zum jeweiligen Datum geltende Satz — DB-frei in `bauePosten`). Das
 * `@@unique` auf `terminId` sichert gegen Doppel-Abrechnung auch bei parallelen
 * Aufrufen.
 *
 * `erwartet`: Abende und Summe, die die Rückfrage der Oberfläche genannt hat
 * (Stand beim Seitenaufruf). Eingefroren wird aber der Stand beim Klick —
 * beginnt dazwischen ein weiterer Abend oder wird ein Satz rückwirkend
 * genehmigt, entstünde eine Abrechnung mit anderen Zahlen als bestätigt. Dann
 * Konflikt (409) statt Anlegen.
 */
export async function erstelleAbrechnung(
  dozentId: string,
  semesterId: string,
  akteurId: string,
  headers?: Headers,
  erwartet?: { abende: number; summe: number },
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
      code: "eingabe",
      meldung: "Für diesen Dozenten gibt es in diesem Semester keine offenen (gehaltenen, noch nicht abgerechneten) Abende.",
    };
  }

  const { posten, summe } = bauePosten(
    offene.map((t) => ({ terminId: t.id, beginn: t.beginn, fach: t.kurseinheit?.fach.bezeichnung ?? null })),
    saetze,
  );
  if (erwartet && (posten.length !== erwartet.abende || summe !== erwartet.summe)) {
    return {
      ok: false,
      code: "konflikt",
      meldung: "Die offenen Abende haben sich seit dem Laden geändert — bitte neu laden und die Zahlen erneut prüfen.",
    };
  }

  try {
    const abrechnung = await prisma.$transaction(async (tx) => {
      const angelegt = await tx.honorarAbrechnung.create({
        data: {
          dozentId,
          semesterId,
          summe,
          erstelltVonId: akteurId,
          posten: { create: posten },
        },
      });

      // Gegenprobe im selben Zug (M11): Zwischen dem Lesen der offenen Abende
      // oben und diesem Anlegen könnte ein Abend einem anderen Dozenten
      // zugeordnet worden sein — dann stünde er hier in der falschen Abrechnung.
      // Ab dem Anlegen hält jeder Posten eine Fremdschlüssel-Sperre auf seinem
      // Termin; die Umhänge-Route sperrt die Terminzeile (FOR UPDATE) und wartet
      // damit auf uns. Was vorher umgehängt wurde, sieht diese Zählung.
      const nochZugeordnet = await tx.unterrichtstermin.count({
        where: { id: { in: posten.map((p) => p.terminId) }, dozentId },
      });
      if (nochZugeordnet !== posten.length) throw new ZuordnungGeaendert();
      return angelegt;
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
    if (fehler instanceof ZuordnungGeaendert) {
      return {
        ok: false,
        code: "konflikt",
        meldung: "Die Abrechnung konnte nicht angelegt werden — die Dozentenzuordnung eines Abends wurde zwischenzeitlich geändert. Bitte neu laden.",
      };
    }
    // Nur die Unique-Verletzung auf terminId (P2002) heißt „schon abgerechnet"
    // (Konflikt, 409). Jeder andere Fehler (DB weg, o. Ä.) wird weitergeworfen,
    // damit die 500-Guard der Route greift — sonst würde ein echter Serverfehler
    // als harmloses fachliches Nein getarnt.
    if (fehler instanceof Prisma.PrismaClientKnownRequestError && fehler.code === "P2002") {
      return {
        ok: false,
        code: "konflikt",
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
  dozentId: string;
  dozentName: string;
  hatBankverbindung: boolean;
  semesterId: string;
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
    dozentId: a.dozentId,
    dozentName: `${a.dozent.nachname}, ${a.dozent.vorname}`,
    hatBankverbindung: a.dozent.ibanVerschluesselt !== null,
    semesterId: a.semesterId,
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

export type FreigabeErgebnis =
  | { ok: true; belegNr: string; dmsGesendet: boolean; dmsVersand: DmsVersand }
  | { ok: false; code: KorrekturFehler; meldung: string };

/**
 * Gibt eine offene Abrechnung zur Auszahlung frei und schickt den Zahlungsbeleg
 * (mit IBAN im Klartext) an das DMS. Der Status wird ZUERST gesetzt (die Freigabe
 * ist die fachliche Tatsache) — scheitert der Belegversand, bleibt die Abrechnung
 * freigegeben und der Versand sichtbar offen (dmsGesendetAm leer, `dmsVersand`
 * nennt den Ausgang). Nachgeholt wird er über `sendeAbrechnungsBelegNach`.
 *
 * Erfordert eine hinterlegte Bankverbindung; der Aufrufer (Route) muss zusätzlich
 * das Recht BANKVERBINDUNG_LESEN prüfen, weil hier die IBAN herausgegeben wird.
 */
export async function gibAbrechnungFrei(abrechnungId: string, akteurId: string, headers?: Headers): Promise<FreigabeErgebnis> {
  const a = await prisma.honorarAbrechnung.findUnique({
    where: { id: abrechnungId },
    select: { id: true, status: true, summe: true, dozent: { select: { ibanVerschluesselt: true } } },
  });
  if (!a) return { ok: false, code: "fehlt", meldung: "Diese Abrechnung gibt es nicht." };
  if (a.status !== "OFFEN") return { ok: false, code: "konflikt", meldung: "Nur eine offene Abrechnung kann freigegeben werden." };
  if (!a.dozent.ibanVerschluesselt) {
    return {
      ok: false,
      code: "konflikt",
      meldung: "Für diesen Dozenten ist keine Bankverbindung hinterlegt. Die IBAN trägt der Dozent selbst unter „Meine Daten“ ein.",
    };
  }

  let iban: string;
  try {
    iban = entschluesseln(a.dozent.ibanVerschluesselt);
  } catch (fehler) {
    console.error("[HONORAR-ABRECHNUNG] IBAN nicht entschlüsselbar für Abrechnung", a.id, fehler);
    return {
      ok: false,
      code: "server",
      meldung: "Die Bankverbindung ist nicht lesbar. Vermutlich passt der Verschlüsselungsschlüssel nicht zu den Daten.",
    };
  }

  const jetzt = new Date();
  const belegNr = honorarBelegNr("HONA", jetzt, randomUUID());

  // Atomarer Statuswechsel OFFEN -> FREIGEGEBEN: nur EIN Aufruf gewinnt. Ohne die
  // Bedingung `status: "OFFEN"` im updateMany könnten zwei nahezu gleichzeitige
  // Freigaben (zwei Tabs/Retries) beide durchlaufen und den IBAN-Beleg DOPPELT ans
  // DMS schicken. Der Verlierer bekommt count 0 und bricht ab.
  const anspruch = await prisma.honorarAbrechnung.updateMany({
    where: { id: a.id, status: "OFFEN" },
    data: { status: "FREIGEGEBEN", freigegebenVonId: akteurId, freigegebenAm: jetzt, belegNr },
  });
  if (anspruch.count === 0) {
    // Verloren: parallel freigegeben — oder inzwischen storniert.
    const noch = await prisma.honorarAbrechnung.findUnique({ where: { id: a.id }, select: { id: true } });
    if (!noch) {
      return { ok: false, code: "fehlt", meldung: "Diese Abrechnung gibt es nicht mehr — sie wurde zwischenzeitlich storniert." };
    }
    return { ok: false, code: "konflikt", meldung: "Diese Abrechnung wurde zwischenzeitlich schon freigegeben." };
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

  let dmsVersand: DmsVersand = "FEHLGESCHLAGEN";
  try {
    const ausgang = await versendeAbrechnungsBeleg(a.id, iban, false);
    dmsVersand = ausgang === "SCHON_GESENDET" ? "GESENDET" : ausgang;
  } catch (fehler) {
    console.error("[HONORAR-ABRECHNUNG] DMS-Beleg konnte nicht erzeugt/versendet werden für", a.id, fehler);
  }

  return { ok: true, belegNr, dmsGesendet: dmsVersand === "GESENDET", dmsVersand };
}

/**
 * Erzeugt den Zahlungsbeleg aus den EINGEFRORENEN Posten und schickt ihn an das
 * DMS — gemeinsamer Weg für die Freigabe und den Nachversand (M12). Beleg-Nr,
 * Freigabe und Posten stammen aus der Abrechnung; nur „erzeugt am“ ist der
 * Zeitpunkt dieses Versands, der Status der aktuelle (beim Nachversand ggf.
 * „Ausgezahlt“ samt Datum). Die IBAN reicht der Aufrufer entschlüsselt herein —
 * sie wird bewusst nicht in der Abrechnung gespeichert, beim Nachversand gilt
 * also die dann hinterlegte Bankverbindung (so steht es auch in der Mail).
 *
 * Unter der DMS-Sperre wird die Abrechnung frisch gelesen: Ist der Beleg
 * inzwischen gesendet, geht er nicht noch einmal raus (kein doppelter
 * IBAN-Beleg). Nur der echte Versand setzt `dmsGesendetAm` — scheitert danach die
 * Sperr-Transaktion (Zeitlimit, Festhalten wirft), wird es ausserhalb bedingt
 * nachgetragen und GESENDET gemeldet: FEHLGESCHLAGEN forderte zum Nachsenden auf,
 * also zu einem zweiten Zahlungsbeleg (siehe `mitDmsSperre`). Beim Nachversand
 * traegt das PDF selbst den Kopie-Vermerk (`nachversand`).
 */
async function versendeAbrechnungsBeleg(abrechnungId: string, iban: string, nachversand: boolean): Promise<BelegAusgang> {
  const an = dmsAdresse();
  if (!an) return "KEINE_ADRESSE";

  // Gesetzt, sobald der Mailserver den Beleg angenommen hat.
  let gesendetAm = null as Date | null;
  try {
    return await mitDmsSperre(`honorar-abrechnung:${abrechnungId}`, async (tx): Promise<BelegAusgang> => {
      const a = await tx.honorarAbrechnung.findUnique({
        where: { id: abrechnungId },
        include: {
          posten: { orderBy: { datum: "asc" }, select: { datum: true, fach: true, betrag: true } },
          dozent: { select: { vorname: true, nachname: true, kontoinhaber: true } },
          semester: { select: { bezeichnung: true } },
        },
      });
      if (!a?.belegNr || a.status === "OFFEN") return "FEHLGESCHLAGEN";
      if (a.dmsGesendetAm) return "SCHON_GESENDET";

      const freigeberName = a.freigegebenVonId
        ? (await ladeAkteurNamen([a.freigegebenVonId], tx)).get(a.freigegebenVonId) ?? null
        : null;
      const daten: AbrechnungBelegDaten = {
        belegNr: a.belegNr,
        erzeugtAm: new Date(),
        dozent: `${a.dozent.nachname}, ${a.dozent.vorname}`,
        semester: a.semester.bezeichnung,
        statusText: abrechnungStatusText(a.status),
        kontoinhaber: a.dozent.kontoinhaber,
        iban,
        freigegebenVon: freigeberName,
        freigegebenAm: a.freigegebenAm,
        ausgezahltAm: a.ausgezahltAm,
        posten: a.posten,
        summe: a.summe,
        notiz: a.notiz,
        nachversand,
      };
      const pdf = erzeugePdf(baueAbrechnungBelegBloecke(daten));
      const mail = baueAbrechnungDmsMail(daten, nachversand);

      const gesendet = await sendeBelegAnDms(an, { betreff: mail.betreff, text: mail.text, dateiname: mail.dateiname, pdf });
      if (!gesendet) return "FEHLGESCHLAGEN";

      gesendetAm = new Date();
      await tx.honorarAbrechnung.update({ where: { id: a.id }, data: { dmsGesendetAm: gesendetAm } });
      return "GESENDET";
    });
  } catch (fehler) {
    const am = gesendetAm;
    if (!am) throw fehler;
    // Der Zahlungsbeleg ist draussen, nur das Festhalten unter der Sperre scheiterte.
    console.error("[HONORAR-ABRECHNUNG] Beleg gesendet, Festhalten unter der Sperre gescheitert — wird nachgetragen:", abrechnungId, fehler);
    try {
      await prisma.honorarAbrechnung.updateMany({
        where: { id: abrechnungId, dmsGesendetAm: null },
        data: { dmsGesendetAm: am },
      });
    } catch (nachtragFehler) {
      console.error("[HONORAR-ABRECHNUNG] dmsGesendetAm nicht nachgetragen — der Beleg ist trotzdem gesendet:", abrechnungId, nachtragFehler);
    }
    return "GESENDET";
  }
}

// -----------------------------------------------------------------------------
// Beleg nachsenden (M12)
// -----------------------------------------------------------------------------

/**
 * Sendet den Zahlungsbeleg einer freigegebenen oder ausgezahlten Abrechnung
 * erneut an das DMS, wenn er dort nicht angekommen ist (`dmsGesendetAm` leer):
 * aus den eingefrorenen Posten, mit derselben Beleg-Nr. Wie die Freigabe gibt
 * das die IBAN heraus — der Aufrufer (Route) prüft deshalb dieselben Rechte
 * (HONORAR_ABRECHNEN + BANKVERBINDUNG_LESEN). Jeder Versuch, der bis zum Versand
 * kommt, steht im Audit-Log (auch ein gescheiterter).
 */
export async function sendeAbrechnungsBelegNach(
  abrechnungId: string,
  akteurId: string,
  headers?: Headers,
): Promise<NachversandErgebnis> {
  const a = await prisma.honorarAbrechnung.findUnique({
    where: { id: abrechnungId },
    select: { status: true, belegNr: true, dmsGesendetAm: true, dozent: { select: { ibanVerschluesselt: true } } },
  });
  if (!a) return { ok: false, code: "fehlt", meldung: "Diese Abrechnung gibt es nicht." };
  const sperre = pruefeAbrechnungNachversand(a);
  if (sperre !== null || !a.belegNr) {
    return { ok: false, code: "konflikt", meldung: sperre ?? "Diese Abrechnung hat keine Beleg-Nr." };
  }
  if (!a.dozent.ibanVerschluesselt) {
    return {
      ok: false,
      code: "konflikt",
      meldung: "Für diesen Dozenten ist keine Bankverbindung mehr hinterlegt. Die IBAN trägt der Dozent selbst unter „Meine Daten“ ein.",
    };
  }

  let iban: string;
  try {
    iban = entschluesseln(a.dozent.ibanVerschluesselt);
  } catch (fehler) {
    console.error("[HONORAR-ABRECHNUNG] IBAN nicht entschlüsselbar für Abrechnung", abrechnungId, fehler);
    return {
      ok: false,
      code: "server",
      meldung: "Die Bankverbindung ist nicht lesbar. Vermutlich passt der Verschlüsselungsschlüssel nicht zu den Daten.",
    };
  }

  let ausgang: BelegAusgang = "FEHLGESCHLAGEN";
  try {
    ausgang = await versendeAbrechnungsBeleg(abrechnungId, iban, true);
  } catch (fehler) {
    console.error("[HONORAR-ABRECHNUNG] Nachversand des DMS-Belegs fehlgeschlagen für", abrechnungId, fehler);
  }

  if (ausgang === "GESENDET" || ausgang === "FEHLGESCHLAGEN") {
    await protokolliere({
      aktion: "HONORAR_ABRECHNUNG_BELEG_NACHVERSAND",
      objektTyp: "HonorarAbrechnung",
      objektId: abrechnungId,
      akteurId,
      nachher: { belegNr: a.belegNr, ausgang, belegEnthaeltIban: true },
      headers,
    });
  }

  return nachversandErgebnis(a.belegNr, ausgang);
}

// -----------------------------------------------------------------------------
// Storno einer OFFENEN Abrechnung (M11)
// -----------------------------------------------------------------------------

export type StornoErgebnis =
  | { ok: true; abende: number; summe: number }
  | { ok: false; code: KorrekturFehler; meldung: string };

/**
 * Storniert eine OFFENE Abrechnung: Sie wird gelöscht, ihre Posten per Cascade
 * mit — die Abende sind danach wieder offen und lassen sich neu abrechnen. Das ist
 * der Korrekturweg, den die Sperre im Stundenplan voraussetzt (Dozentenwechsel an
 * einem abgerechneten Abend: erst stornieren, dann umhängen, dann neu abrechnen).
 *
 * Nur OFFEN: Eine freigegebene Abrechnung hat ihren Zahlungsbeleg mit IBAN schon
 * herausgegeben, eine ausgezahlte ist bezahlt — die bleiben unangetastet. Atomar
 * über ein bedingtes deleteMany (status OFFEN in der schreibenden Anweisung): Eine
 * gleichzeitige Freigabe und dieser Storno können nicht beide gewinnen. Die
 * gelöschten Posten stehen vollständig im Audit-Log (vorher).
 */
export async function storniereAbrechnung(abrechnungId: string, akteurId: string, headers?: Headers): Promise<StornoErgebnis> {
  const a = await prisma.honorarAbrechnung.findUnique({
    where: { id: abrechnungId },
    select: {
      dozentId: true,
      semesterId: true,
      summe: true,
      erstelltAm: true,
      posten: { orderBy: { datum: "asc" }, select: { terminId: true, datum: true, fach: true, betrag: true } },
    },
  });
  if (!a) return { ok: false, code: "fehlt", meldung: "Diese Abrechnung gibt es nicht." };

  const geloescht = await prisma.honorarAbrechnung.deleteMany({ where: { id: abrechnungId, status: "OFFEN" } });
  if (geloescht.count === 0) {
    const noch = await prisma.honorarAbrechnung.findUnique({ where: { id: abrechnungId }, select: { id: true } });
    if (!noch) return { ok: false, code: "fehlt", meldung: "Diese Abrechnung gibt es nicht mehr." };
    return {
      ok: false,
      code: "konflikt",
      meldung: "Nur eine offene Abrechnung lässt sich stornieren — diese ist bereits freigegeben.",
    };
  }

  await protokolliere({
    aktion: "HONORAR_ABRECHNUNG_STORNIERT",
    objektTyp: "HonorarAbrechnung",
    objektId: abrechnungId,
    akteurId,
    vorher: {
      dozentId: a.dozentId,
      semesterId: a.semesterId,
      status: "OFFEN",
      summe: a.summe,
      erstelltAm: a.erstelltAm.toISOString(),
      posten: a.posten.map((p) => ({ terminId: p.terminId, datum: p.datum.toISOString(), fach: p.fach, betrag: p.betrag })),
    },
    headers,
  });

  return { ok: true, abende: a.posten.length, summe: a.summe };
}

// -----------------------------------------------------------------------------
// Als ausgezahlt markieren
// -----------------------------------------------------------------------------

export type AusgezahltErgebnis = { ok: true } | { ok: false; code: KorrekturFehler; meldung: string };

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
    if (!vorhanden) return { ok: false, code: "fehlt", meldung: "Diese Abrechnung gibt es nicht." };
    return { ok: false, code: "konflikt", meldung: "Nur eine freigegebene Abrechnung kann als ausgezahlt markiert werden." };
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
