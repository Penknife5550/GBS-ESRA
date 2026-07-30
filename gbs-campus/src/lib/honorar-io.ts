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
 *    nach der Genehmigung an das DMS geht.
 */

import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { ROLLE } from "@/lib/constants";
import { protokolliere } from "@/lib/audit";
import { erzeugePdf } from "@/lib/pdf";
import { sendeMail } from "@/lib/mailer";
import { dmsAdresse } from "@/lib/konfiguration";
import { euro, satzFuer, type SatzZeile } from "@/lib/honorar";
import { baueHonorarBelegBloecke, type BelegSatz, type BelegTag } from "@/lib/honorar-beleg";

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
async function ladeSatzZeilen(): Promise<SatzZeile[]> {
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
 * `Anzahl × ein Satz`.
 */
export async function ladeHonorarUebersicht(semesterId: string): Promise<HonorarUebersicht> {
  const jetzt = new Date();
  const [saetze, termine] = await Promise.all([
    ladeSatzZeilen(),
    prisma.unterrichtstermin.findMany({
      where: { semesterId, dozentId: { not: null }, beginn: { lte: jetzt } },
      select: { dozentId: true, beginn: true },
    }),
  ]);

  const aktuellerSatz = satzFuer(jetzt, saetze);
  if (termine.length === 0) return { aktuellerSatz, zeilen: [], summe: 0 };

  const proDozent = new Map<string, { abende: number; betrag: number }>();
  for (const t of termine) {
    if (!t.dozentId) continue;
    const eintrag = proDozent.get(t.dozentId) ?? { abende: 0, betrag: 0 };
    eintrag.abende += 1;
    eintrag.betrag += satzFuer(t.beginn, saetze);
    proDozent.set(t.dozentId, eintrag);
  }

  const ids = [...proDozent.keys()];
  const personen = await prisma.person.findMany({
    where: { id: { in: ids } },
    select: { id: true, vorname: true, nachname: true },
  });
  const nameById = new Map(personen.map((p) => [p.id, `${p.nachname}, ${p.vorname}`]));

  const zeilen: HonorarZeile[] = [...proDozent.entries()]
    .map(([dozentId, e]) => ({ dozentId, name: nameById.get(dozentId) ?? "—", abende: e.abende, betrag: e.betrag }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));

  const summe = zeilen.reduce((s, z) => s + z.betrag, 0);
  return { aktuellerSatz, zeilen, summe };
}

// -----------------------------------------------------------------------------
// Satz-Historie und Genehmigung
// -----------------------------------------------------------------------------

/** Grenzen des Honorarsatzes — im Code, nicht nur im Formular (wie bei Einstellungen). */
export const HONORAR_SATZ_MIN = 0;
export const HONORAR_SATZ_MAX = 100000;

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

/** Ordnet Akteur-Ids (genehmigtVonId) lesbare Namen zu. */
async function ladeAkteurNamen(ids: string[]): Promise<Map<string, string>> {
  const eindeutige = [...new Set(ids.filter(Boolean))];
  if (eindeutige.length === 0) return new Map();
  const personen = await prisma.person.findMany({
    where: { id: { in: eindeutige } },
    select: { id: true, vorname: true, nachname: true },
  });
  return new Map(personen.map((p) => [p.id, `${p.nachname}, ${p.vorname}`]));
}

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
 * Baut die Beleg-Daten (komplette Historie + alle Unterrichtstage mit geltendem
 * Satz) aus dem aktuellen Datenbestand. Rein lesend.
 */
async function ladeBelegDaten(belegNr: string, anlass: string, genehmigtVon: string | null, genehmigtAm: Date) {
  const [saetzeRows, termine] = await Promise.all([
    prisma.honorarSatz.findMany({ orderBy: [{ gueltigAb: "desc" }, { genehmigtAm: "desc" }] }),
    prisma.unterrichtstermin.findMany({
      orderBy: { beginn: "asc" },
      select: {
        beginn: true,
        semester: { select: { bezeichnung: true } },
        kurseinheit: { select: { fach: { select: { bezeichnung: true } } } },
      },
    }),
  ]);

  const namen = await ladeAkteurNamen(saetzeRows.map((r) => r.genehmigtVonId ?? ""));
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

/** Eindeutige, im DMS wiederauffindbare Beleg-Nummer, z. B. HON-2026-07-30-1A2B3C4D. */
function neueBelegNr(am: Date): string {
  const tag = am.toISOString().slice(0, 10); // YYYY-MM-DD (UTC — reine Referenz, keine Anzeige)
  return `HON-${tag}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export type GenehmigenEingabe = {
  betrag: number;
  gueltigAb: Date;
  notiz: string | null;
  akteurId: string;
  headers?: Headers;
};

export type GenehmigenErgebnis =
  | { ok: true; satzId: string; belegNr: string; dmsGesendet: boolean }
  | { ok: false; meldung: string };

/**
 * Genehmigt einen neuen Honorarsatz: legt die Historien-Zeile an (das Eintragen
 * durch eine berechtigte Person IST die Genehmigung), erzeugt den DMS-Beleg mit
 * der kompletten Historie und schickt ihn an das DMS.
 *
 * Reihenfolge und Fehlerverhalten bewusst wie beim Mailer: Die Genehmigung ist
 * die fachliche Tatsache und wird NICHT zurückgerollt, wenn der Beleg-Versand
 * scheitert. Ein fehlgeschlagener oder mangels DMS-Adresse ausgebliebener
 * Versand bleibt sichtbar (dmsGesendetAm bleibt leer) und lässt sich später
 * nachholen.
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
  const belegNr = neueBelegNr(new Date());
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
  let dmsGesendet = false;
  try {
    const genehmiger = eingabe.akteurId ? (await ladeAkteurNamen([eingabe.akteurId])).get(eingabe.akteurId) ?? null : null;
    const anlass = `${euro(satz.betrag)} je Unterrichtsabend, gültig ab ${satz.gueltigAb.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}`;
    const daten = await ladeBelegDaten(belegNr, anlass, genehmiger, satz.genehmigtAm);
    const pdf = erzeugePdf(baueHonorarBelegBloecke(daten));

    const an = dmsAdresse();
    if (an) {
      const ergebnis = await sendeMail({
        an,
        betreff: `Honorarsatz-Beleg ${belegNr} — ${anlass}`,
        text:
          `Automatischer Beleg der Gemeindebibelschule Minden.\n\n` +
          `Anlass: ${anlass}\nGenehmigt von: ${genehmiger ?? "—"}\nBeleg-Nr.: ${belegNr}\n\n` +
          `Die vollständige Historie und die Unterrichtstage mit geltendem Satz stehen im angehängten PDF.`,
        anhaenge: [{ dateiname: `${belegNr}.pdf`, inhalt: pdf, typ: "application/pdf" }],
      });
      dmsGesendet = ergebnis.gesendet;
    }

    // Nur den echten Versand festhalten — die Beleg-Nr steht schon seit dem
    // create. Ein Fehler hier lässt den Satz als „Versand steht aus" stehen.
    if (dmsGesendet) {
      await prisma.honorarSatz.update({ where: { id: satz.id }, data: { dmsGesendetAm: new Date() } });
    }
  } catch (fehler) {
    console.error("[HONORAR] DMS-Beleg konnte nicht erzeugt/versendet werden für Satz", satz.id, fehler);
  }

  return { ok: true, satzId: satz.id, belegNr, dmsGesendet };
}
