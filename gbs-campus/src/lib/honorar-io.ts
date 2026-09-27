/**
 * GBS Campus — Dozentenhonorar: Datenbank-Operationen
 *
 * Der IO-Teil zur DB-freien Kernlogik (`honorar.ts`) und zum Beleg-Bau
 * (`honorar-beleg.ts`):
 *
 *  - die Dozenten fuer die Zuordnung im Stundenplan,
 *  - die read-only Honorar-Uebersicht je Semester (Abende je Dozent, jeder Abend
 *    zu dem Satz, der zu seinem Datum galt),
 *  - die Satz-Historie und das Genehmigen eines neuen Satzes — samt Beleg, der
 *    nach der Genehmigung an das DMS geht, und dessen Nachversand, falls er dort
 *    nicht angekommen ist,
 *  - (Sperre und Versand eines DMS-Belegs liegen in `dms.ts`, die Namen der
 *    Akteure in `personen-namen.ts` — gemeinsam mit Abrechnung und Zeugnis.)
 */

import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ROLLE } from "@/lib/constants";
import { protokolliere } from "@/lib/audit";
import { erzeugePdf } from "@/lib/pdf";
import { dmsAdresse } from "@/lib/konfiguration";
import { mitDmsSperre, sendeBelegAnDms } from "@/lib/dms";
import { ladeAkteurNamen } from "@/lib/personen-namen";
import { datum } from "@/lib/datum";
import { euro, honorarBelegNr, satzFuer, HONORAR_SATZ_MIN, HONORAR_SATZ_MAX, type SatzZeile } from "@/lib/honorar";
import {
  baueHonorarBelegBloecke,
  baueSatzDmsMail,
  historieBis,
  type BelegSatz,
  type BelegTag,
} from "@/lib/honorar-beleg";
import {
  nachversandErgebnis,
  pruefeSatzNachversand,
  type BelegAusgang,
  type DmsVersand,
  type NachversandErgebnis,
} from "@/lib/honorar-korrektur";

export type DozentAuswahl = { id: string; name: string };

/**
 * Die Personen mit der Rolle Dozent — Grundlage der Zuordnung im Stundenplan.
 * Nur wer diese Rolle trägt, lässt sich einem Abend als Dozent zuordnen; die
 * Zuordnungsroute prüft das noch einmal serverseitig.
 */
export async function ladeDozenten(): Promise<DozentAuswahl[]> {
  const personen = await prisma.person.findMany({
    where: { rollen: { some: { rolleCode: ROLLE.DOZENT } } },
    select: { id: true, vorname: true, nachname: true },
    orderBy: [{ nachname: "asc" }, { vorname: "asc" }],
  });
  return personen.map((p) => ({ id: p.id, name: `${p.nachname}, ${p.vorname}` }));
}

/** Ob eine Person als Dozent zugeordnet werden darf (trägt die Rolle Dozent). */
export async function istDozent(personId: string): Promise<boolean> {
  const treffer = await prisma.personRolle.findUnique({
    where: { personId_rolleCode: { personId, rolleCode: ROLLE.DOZENT } },
    select: { personId: true },
  });
  return treffer !== null;
}

// -----------------------------------------------------------------------------
// Honorar-Uebersicht je Semester
// -----------------------------------------------------------------------------

export type HonorarZeile = { dozentId: string; name: string; abende: number; betrag: number };
export type HonorarUebersicht = { aktuellerSatz: number; zeilen: HonorarZeile[]; summe: number };

/** Laedt die Satz-Historie in der von `satzFuer` erwarteten schlanken Form. */
export async function ladeSatzZeilen(): Promise<SatzZeile[]> {
  const rows = await prisma.honorarSatz.findMany({
    select: { betrag: true, gueltigAb: true, genehmigtAm: true },
  });
  return rows.map((r) => ({ betrag: r.betrag, gueltigAb: r.gueltigAb, genehmigtAm: r.genehmigtAm }));
}

/**
 * Honorar-Übersicht eines Semesters: je Dozent die Anzahl der bereits gehaltenen
 * Unterrichtsabende und die Summe der je Abend geltenden Sätze.
 *
 * „Gehalten" heißt: der Abend hat begonnen (`beginn <= jetzt`) — dieselbe Grenze
 * wie bei der Selbstbestätigung. Künftige, einem Dozenten schon zugeordnete
 * Abende zählen erst mit, sobald sie stattgefunden haben.
 *
 * Weil der Satz eine Historie hat, kann er zwischen Abenden wechseln; deshalb
 * wird je Abend über `satzFuer(beginn)` aufgelöst und summiert — nicht
 * `Anzahl × ein Satz`. Ein schon abgerechneter Abend zählt dagegen mit seinem
 * eingefrorenen Posten-Betrag: Ein später rückdatierter Satz ändert eine
 * bestehende Abrechnung nicht, und die Übersicht soll denselben Betrag zeigen
 * wie der Zahlungsbeleg.
 */
export async function ladeHonorarUebersicht(semesterId: string): Promise<HonorarUebersicht> {
  const jetzt = new Date();
  const [saetze, termine] = await Promise.all([
    ladeSatzZeilen(),
    prisma.unterrichtstermin.findMany({
      where: { semesterId, dozentId: { not: null }, beginn: { lte: jetzt } },
      select: { dozentId: true, beginn: true, abrechnungPosten: { select: { betrag: true } } },
    }),
  ]);

  const aktuellerSatz = satzFuer(jetzt, saetze);
  if (termine.length === 0) return { aktuellerSatz, zeilen: [], summe: 0 };

  const proDozent = new Map<string, { abende: number; betrag: number }>();
  for (const t of termine) {
    if (!t.dozentId) continue;
    const eintrag = proDozent.get(t.dozentId) ?? { abende: 0, betrag: 0 };
    eintrag.abende += 1;
    eintrag.betrag += t.abrechnungPosten ? t.abrechnungPosten.betrag : satzFuer(t.beginn, saetze);
    proDozent.set(t.dozentId, eintrag);
  }

  const nameById = await ladeAkteurNamen([...proDozent.keys()]);

  const zeilen: HonorarZeile[] = [...proDozent.entries()]
    .map(([dozentId, e]) => ({ dozentId, name: nameById.get(dozentId) ?? "—", abende: e.abende, betrag: e.betrag }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));

  const summe = zeilen.reduce((s, z) => s + z.betrag, 0);
  return { aktuellerSatz, zeilen, summe };
}

// -----------------------------------------------------------------------------
// Satz-Historie und Genehmigung
// -----------------------------------------------------------------------------

export type HonorarSatzAnzeige = {
  id: string;
  betrag: number;
  gueltigAb: Date;
  notiz: string | null;
  genehmigtVon: string | null;
  genehmigtAm: Date;
  dmsBelegNr: string | null;
  dmsGesendetAm: Date | null;
};

/** Die komplette Satz-Historie, jüngster Satz zuerst, mit aufgelösten Genehmiger-Namen. */
export async function ladeHonorarSaetze(): Promise<HonorarSatzAnzeige[]> {
  const rows = await prisma.honorarSatz.findMany({
    orderBy: [{ gueltigAb: "desc" }, { genehmigtAm: "desc" }],
  });
  const namen = await ladeAkteurNamen(rows.map((r) => r.genehmigtVonId ?? ""));
  return rows.map((r) => ({
    id: r.id,
    betrag: r.betrag,
    gueltigAb: r.gueltigAb,
    notiz: r.notiz,
    genehmigtVon: r.genehmigtVonId ? namen.get(r.genehmigtVonId) ?? "—" : null,
    genehmigtAm: r.genehmigtAm,
    dmsBelegNr: r.dmsBelegNr,
    dmsGesendetAm: r.dmsGesendetAm,
  }));
}

/**
 * Baut die Beleg-Daten (Historie bis zu dieser Genehmigung + alle
 * Unterrichtstage mit geltendem Satz) aus dem aktuellen Datenbestand. Rein
 * lesend, ueber `client` (unter der DMS-Sperre deren Transaktion). Die Historie
 * endet bei `genehmigtAm` (historieBis): beim Erstversand ist das die ganze, beim
 * Nachversand bleiben spaeter genehmigte Saetze draussen.
 */
async function ladeBelegDaten(
  client: Prisma.TransactionClient,
  belegNr: string,
  anlass: string,
  genehmigtVon: string | null,
  genehmigtAm: Date,
) {
  const [alleSaetze, termine] = await Promise.all([
    client.honorarSatz.findMany({ orderBy: [{ gueltigAb: "desc" }, { genehmigtAm: "desc" }] }),
    client.unterrichtstermin.findMany({
      orderBy: { beginn: "asc" },
      select: {
        beginn: true,
        semester: { select: { bezeichnung: true } },
        kurseinheit: { select: { fach: { select: { bezeichnung: true } } } },
      },
    }),
  ]);

  const saetzeRows = historieBis(alleSaetze, genehmigtAm);
  const namen = await ladeAkteurNamen(saetzeRows.map((r) => r.genehmigtVonId ?? ""), client);
  const saetzeZeilen: SatzZeile[] = saetzeRows.map((r) => ({
    betrag: r.betrag,
    gueltigAb: r.gueltigAb,
    genehmigtAm: r.genehmigtAm,
  }));

  const saetze: BelegSatz[] = saetzeRows.map((r) => ({
    betrag: r.betrag,
    gueltigAb: r.gueltigAb,
    notiz: r.notiz,
    genehmigtVon: r.genehmigtVonId ? namen.get(r.genehmigtVonId) ?? "—" : null,
    genehmigtAm: r.genehmigtAm,
  }));

  const tage: BelegTag[] = termine.map((t) => ({
    datum: t.beginn,
    semester: t.semester.bezeichnung,
    fach: t.kurseinheit?.fach.bezeichnung ?? null,
    satz: satzFuer(t.beginn, saetzeZeilen),
  }));

  return {
    belegNr,
    erzeugtAm: new Date(),
    genehmigtVon,
    genehmigtAm,
    anlass,
    saetze,
    tage,
  };
}

export type GenehmigenEingabe = {
  betrag: number;
  gueltigAb: Date;
  notiz: string | null;
  akteurId: string;
  headers?: Headers;
};

export type GenehmigenErgebnis =
  | { ok: true; satzId: string; belegNr: string; dmsGesendet: boolean; dmsVersand: DmsVersand }
  | { ok: false; meldung: string };

/**
 * Genehmigt einen neuen Honorarsatz: legt die Historien-Zeile an (das Eintragen
 * durch eine berechtigte Person IST die Genehmigung), erzeugt den DMS-Beleg mit
 * der kompletten Historie und schickt ihn an das DMS.
 *
 * Reihenfolge und Fehlerverhalten bewusst wie beim Mailer: Die Genehmigung ist
 * die fachliche Tatsache und wird NICHT zurückgerollt, wenn der Beleg-Versand
 * scheitert. Ein fehlgeschlagener oder mangels DMS-Adresse ausgebliebener
 * Versand bleibt sichtbar (dmsGesendetAm bleibt leer, `dmsVersand` nennt den
 * Ausgang) und wird über `sendeSatzBelegNach` — Knopf „Beleg erneut senden“ auf
 * der Sätze-Seite — mit derselben Beleg-Nr nachgeholt.
 */
export async function genehmigeHonorarSatz(eingabe: GenehmigenEingabe): Promise<GenehmigenErgebnis> {
  if (!Number.isInteger(eingabe.betrag)) {
    return { ok: false, meldung: "Der Satz muss eine ganze Zahl in Euro sein." };
  }
  if (eingabe.betrag < HONORAR_SATZ_MIN || eingabe.betrag > HONORAR_SATZ_MAX) {
    return { ok: false, meldung: `Der Satz muss zwischen ${HONORAR_SATZ_MIN} und ${HONORAR_SATZ_MAX} € liegen.` };
  }
  if (Number.isNaN(eingabe.gueltigAb.getTime())) {
    return { ok: false, meldung: "Das Gültig-ab-Datum ist ungültig." };
  }
  const notiz = eingabe.notiz?.trim() ? eingabe.notiz.trim() : null;

  // Die DMS-Beleg-Nr wird sofort mit angelegt: Die Referenz muss in JEDEM
  // Fehlerzweig existieren (der Satz erscheint dann als „Versand steht aus"),
  // nicht erst nach erfolgreichem Versand — sonst ginge ein bereits gesendeter
  // Beleg bei einem DB-Fehler nach dem Versand unsichtbar verloren.
  const belegNr = honorarBelegNr("HON", new Date(), randomUUID());
  const satz = await prisma.honorarSatz.create({
    data: {
      betrag: eingabe.betrag,
      gueltigAb: eingabe.gueltigAb,
      notiz,
      genehmigtVonId: eingabe.akteurId,
      dmsBelegNr: belegNr,
    },
  });

  await protokolliere({
    aktion: "HONORAR_SATZ_GENEHMIGT",
    objektTyp: "HonorarSatz",
    objektId: satz.id,
    akteurId: eingabe.akteurId,
    nachher: { betrag: satz.betrag, gueltigAb: satz.gueltigAb.toISOString(), notiz },
    headers: eingabe.headers,
  });

  // Beleg erzeugen und an das DMS geben. Scheitert das, bleibt der Satz genehmigt
  // und der Beleg als offener Versand sichtbar (dmsGesendetAm bleibt leer).
  let dmsVersand: DmsVersand = "FEHLGESCHLAGEN";
  try {
    const ausgang = await versendeSatzBeleg(satz.id, false);
    dmsVersand = ausgang === "SCHON_GESENDET" ? "GESENDET" : ausgang;
  } catch (fehler) {
    console.error("[HONORAR] DMS-Beleg konnte nicht erzeugt/versendet werden für Satz", satz.id, fehler);
  }

  return { ok: true, satzId: satz.id, belegNr, dmsGesendet: dmsVersand === "GESENDET", dmsVersand };
}

// -----------------------------------------------------------------------------
// DMS-Versand unter Sperre, Satz-Beleg und Nachversand (M12)
// -----------------------------------------------------------------------------

/** Kurzbeschreibung einer Genehmigung, z. B. „65 € je Unterrichtsabend, gültig ab 01.09.2026“. */
function satzAnlass(betrag: number, gueltigAb: Date): string {
  return `${euro(betrag)} je Unterrichtsabend, gültig ab ${datum(gueltigAb)}`;
}

/**
 * Erzeugt den Honorarsatz-Beleg und schickt ihn an das DMS — gemeinsamer Weg
 * fuer die Genehmigung und den Nachversand. Unter der DMS-Sperre wird der Satz
 * frisch gelesen: Ist der Beleg inzwischen gesendet, geht er nicht noch einmal
 * raus. Nur der echte Versand setzt `dmsGesendetAm` (die Beleg-Nr steht schon
 * seit dem create) — notfalls ausserhalb der Sperre nachgetragen (siehe
 * `mitDmsSperre`).
 */
async function versendeSatzBeleg(satzId: string, nachversand: boolean): Promise<BelegAusgang> {
  const an = dmsAdresse();
  if (!an) return "KEINE_ADRESSE";

  // Gesetzt, sobald der Mailserver den Beleg angenommen hat.
  let gesendetAm = null as Date | null;
  try {
    return await mitDmsSperre(`honorar-satz:${satzId}`, async (tx): Promise<BelegAusgang> => {
      const satz = await tx.honorarSatz.findUnique({ where: { id: satzId } });
      if (!satz?.dmsBelegNr) return "FEHLGESCHLAGEN";
      if (satz.dmsGesendetAm) return "SCHON_GESENDET";

      const genehmiger = satz.genehmigtVonId
        ? (await ladeAkteurNamen([satz.genehmigtVonId], tx)).get(satz.genehmigtVonId) ?? null
        : null;
      const anlass = satzAnlass(satz.betrag, satz.gueltigAb);
      const daten = { ...(await ladeBelegDaten(tx, satz.dmsBelegNr, anlass, genehmiger, satz.genehmigtAm)), nachversand };
      const pdf = erzeugePdf(baueHonorarBelegBloecke(daten));
      const mail = baueSatzDmsMail({ belegNr: satz.dmsBelegNr, anlass, genehmigtVon: genehmiger }, nachversand);

      const gesendet = await sendeBelegAnDms(an, { betreff: mail.betreff, text: mail.text, dateiname: mail.dateiname, pdf });
      if (!gesendet) return "FEHLGESCHLAGEN";

      gesendetAm = new Date();
      await tx.honorarSatz.update({ where: { id: satz.id }, data: { dmsGesendetAm: gesendetAm } });
      return "GESENDET";
    });
  } catch (fehler) {
    const am = gesendetAm;
    if (!am) throw fehler;
    // Der Beleg ist draussen, nur das Festhalten unter der Sperre scheiterte.
    console.error("[HONORAR] Satz-Beleg gesendet, Festhalten unter der Sperre gescheitert — wird nachgetragen:", satzId, fehler);
    try {
      await prisma.honorarSatz.updateMany({ where: { id: satzId, dmsGesendetAm: null }, data: { dmsGesendetAm: am } });
    } catch (nachtragFehler) {
      console.error("[HONORAR] dmsGesendetAm nicht nachgetragen — der Beleg ist trotzdem gesendet:", satzId, nachtragFehler);
    }
    return "GESENDET";
  }
}

/**
 * Sendet den Beleg eines genehmigten Satzes erneut an das DMS, wenn er dort nicht
 * angekommen ist (`dmsGesendetAm` leer) — mit derselben Beleg-Nr und der
 * Historie bis zu dieser Genehmigung. Jeder Versuch, der bis zum Versand kommt,
 * steht im Audit-Log (auch ein gescheiterter: wer hat wann nachgesendet).
 */
export async function sendeSatzBelegNach(satzId: string, akteurId: string, headers?: Headers): Promise<NachversandErgebnis> {
  const satz = await prisma.honorarSatz.findUnique({
    where: { id: satzId },
    select: { dmsBelegNr: true, dmsGesendetAm: true },
  });
  if (!satz) return { ok: false, code: "fehlt", meldung: "Diesen Honorarsatz gibt es nicht." };
  const sperre = pruefeSatzNachversand(satz);
  if (sperre !== null || !satz.dmsBelegNr) {
    return { ok: false, code: "konflikt", meldung: sperre ?? "Dieser Satz hat keine Beleg-Nr." };
  }

  let ausgang: BelegAusgang = "FEHLGESCHLAGEN";
  try {
    ausgang = await versendeSatzBeleg(satzId, true);
  } catch (fehler) {
    console.error("[HONORAR] Nachversand des DMS-Belegs fehlgeschlagen für Satz", satzId, fehler);
  }

  if (ausgang === "GESENDET" || ausgang === "FEHLGESCHLAGEN") {
    await protokolliere({
      aktion: "HONORAR_SATZ_BELEG_NACHVERSAND",
      objektTyp: "HonorarSatz",
      objektId: satzId,
      akteurId,
      nachher: { belegNr: satz.dmsBelegNr, ausgang },
      headers,
    });
  }

  return nachversandErgebnis(satz.dmsBelegNr, ausgang);
}
