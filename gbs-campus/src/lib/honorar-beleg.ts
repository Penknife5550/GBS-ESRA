/**
 * GBS Campus — Honorarsatz-Beleg fuers DMS: reine Inhaltslogik
 *
 * Nach jeder Genehmigung eines Honorarsatzes geht ein Beleg (PDF) an das DMS.
 * Dieses Modul baut aus den gesammelten Daten die PDF-Bausteine (und die
 * Begleitmail ans DMS) — bewusst ohne Datenbank, damit es sich per Pruefskript
 * und im Musterlauf (`scripts/muster-honorar-dms.ts`) ohne laufenden Postgres
 * erzeugen laesst.
 * Der IO-Teil (Daten einsammeln, Beleg-Nr vergeben, an das DMS mailen) liegt in
 * `honorar-io.ts`.
 *
 * Kein QR-Code: Der PDF-Erzeuger (`pdf.ts`) ist bewusst abhaengigkeitsfrei
 * (Node-Bordmittel, weil das Image mit `--ignore-scripts` installiert). Die
 * DMS-Referenz ist deshalb eine gedruckte Beleg-Nummer, kein Bild.
 */

import type { PdfBlock } from "@/lib/pdf";
import type { DmsMail } from "@/lib/honorar-korrektur";
import { euro } from "@/lib/honorar";
import { datum, datumZeit } from "@/lib/datum";
import { EINRICHTUNG } from "@/lib/constants";

/** Eine Zeile der Satz-Historie, wie sie im Beleg erscheint. */
export type BelegSatz = {
  betrag: number;
  gueltigAb: Date;
  notiz: string | null;
  genehmigtVon: string | null;
  genehmigtAm: Date;
};

/** Ein Unterrichtstag mit dem an diesem Tag geltenden Satz. */
export type BelegTag = {
  datum: Date;
  semester: string;
  fach: string | null;
  satz: number;
};

export type HonorarBelegDaten = {
  belegNr: string;
  erzeugtAm: Date;
  /** Genehmiger und Zeitpunkt der ausloesenden Genehmigung. */
  genehmigtVon: string | null;
  genehmigtAm: Date;
  /** Kurzbeschreibung der ausloesenden Genehmigung, z. B. „65 € ab 01.09.2026". */
  anlass: string;
  /** Komplette Historie, juengster Satz zuerst. */
  saetze: BelegSatz[];
  /** Alle Unterrichtstage chronologisch, mit dem je Tag geltenden Satz. */
  tage: BelegTag[];
  /**
   * Nachversand eines nicht angekommenen Belegs (M12): Das PDF traegt dann einen
   * sichtbaren Kopie-Vermerk — nicht nur die Begleitmail, deren Text der
   * DMS-Eingang womoeglich nicht uebernimmt.
   */
  nachversand?: boolean;
};

/** Baut aus den gesammelten Daten die PDF-Bausteine. Rein, ohne Datenbank. */
export function baueHonorarBelegBloecke(daten: HonorarBelegDaten): PdfBlock[] {
  const b: PdfBlock[] = [];

  b.push({ art: "titel", text: "Honorarsatz — Beleg für das Dokumentenmanagement" });
  b.push({
    art: "klein",
    text: `Beleg-Nr. ${daten.belegNr} · erzeugt am ${datumZeit(daten.erzeugtAm)} · ${EINRICHTUNG.name} · ${EINRICHTUNG.traeger}`,
  });
  if (daten.nachversand) {
    b.push({ art: "h2", text: `NACHVERSAND – Kopie des Belegs ${daten.belegNr}` });
    b.push({
      art: "absatz",
      text:
        "Dieser Beleg ist bei der Genehmigung nicht im DMS angekommen und wird mit unveränderter Beleg-Nr. " +
        "nachgereicht. Liegt der Beleg dort bereits vor, ist dies eine Kopie. Die Historie reicht bis zu dieser " +
        "Genehmigung; die Unterrichtstage entsprechen dem Stand beim Nachversand.",
    });
  }
  b.push({
    art: "absatz",
    text:
      "Dieser Beleg dokumentiert die Genehmigung eines Dozentenhonorarsatzes und den vollständigen " +
      "Verlauf aller bisher genehmigten Sätze. Er wird bei jeder Genehmigung maschinell erzeugt und an das " +
      "Dokumentenmanagement der Schule übergeben. Die Beleg-Nummer dient als Referenz im DMS.",
  });

  b.push({ art: "h2", text: "Genehmigung" });
  b.push({ art: "kv", label: "Anlass", wert: daten.anlass });
  b.push({ art: "kv", label: "Genehmigt von", wert: daten.genehmigtVon ?? "—" });
  b.push({ art: "kv", label: "Genehmigt am", wert: datumZeit(daten.genehmigtAm) });

  b.push({ art: "h2", text: "1. Honorarsatz-Historie" });
  if (daten.saetze.length === 0) {
    b.push({ art: "absatz", text: "Es ist noch kein Honorarsatz genehmigt." });
  }
  for (const s of daten.saetze) {
    b.push({
      art: "kv",
      label: `gültig ab ${datum(s.gueltigAb)}`,
      wert:
        `${euro(s.betrag)} je Unterrichtsabend · genehmigt von ${s.genehmigtVon ?? "—"} ` +
        `am ${datumZeit(s.genehmigtAm)}${s.notiz ? " · " + s.notiz : ""}`,
    });
  }

  b.push({ art: "h2", text: "2. Unterrichtstage mit geltendem Satz" });
  b.push({
    art: "klein",
    text:
      "Für jeden geplanten Unterrichtstag der Satz, der zu seinem Datum gilt (aus der Historie oben). " +
      "Vergangene Tage bleiben bei einer späteren Satzänderung unverändert.",
  });
  if (daten.tage.length === 0) {
    b.push({ art: "absatz", text: "Es sind keine Unterrichtstage angelegt." });
  }
  for (const t of daten.tage) {
    b.push({
      art: "kv",
      label: `${datum(t.datum)} · ${t.semester}`,
      wert: `${t.fach ?? "(kein Fach zugeordnet)"} · ${euro(t.satz)}`,
    });
  }

  b.push({ art: "leer" });
  b.push({
    art: "klein",
    text:
      "Maschinell erzeugt aus dem aktuellen Datenbestand. Rückfragen an die Schulverwaltung unter " +
      "Angabe der Beleg-Nummer.",
  });

  return b;
}

/**
 * Die Satz-Historie, wie sie zum Zeitpunkt einer Genehmigung bestand: alle
 * Zeilen, die bis einschliesslich `stichtag` genehmigt wurden. Beim Erstversand
 * ist das die ganze Historie (der neue Satz ist der juengste); beim Nachversand
 * (M12) haelt es spaeter genehmigte Saetze aus dem Beleg heraus — die haben ihren
 * eigenen Beleg, und ihre Betraege gehoeren nicht in die Unterrichtstage dieses.
 */
export function historieBis<T extends { genehmigtAm: Date }>(saetze: T[], stichtag: Date): T[] {
  return saetze.filter((s) => s.genehmigtAm.getTime() <= stichtag.getTime());
}

/**
 * Betreff, Text und Anhangname der DMS-Mail zum Honorarsatz-Beleg — gemeinsam
 * fuer die Genehmigung und den Nachversand (M12). Beim Nachversand mit Vermerk,
 * dass es dieselbe Beleg-Nr ist (eine schon vorliegende Fassung ist eine Kopie).
 */
export function baueSatzDmsMail(
  daten: { belegNr: string; anlass: string; genehmigtVon: string | null },
  nachversand: boolean,
): DmsMail {
  const vermerk = nachversand
    ? `NACHVERSAND mit unveränderter Beleg-Nr.: Dieser Beleg ist bei der Genehmigung nicht im DMS angekommen und ` +
      `wird hiermit nachgereicht. Liegt der Beleg ${daten.belegNr} dort bereits vor, ist dies eine Kopie. Die ` +
      `Historie reicht bis zu dieser Genehmigung; die Unterrichtstage entsprechen dem Stand beim Nachversand.\n\n`
    : "";
  return {
    betreff: `Honorarsatz-Beleg ${daten.belegNr} — ${daten.anlass}${nachversand ? " (Nachversand)" : ""}`,
    text:
      vermerk +
      `Automatischer Beleg der ${EINRICHTUNG.name}.\n\n` +
      `Anlass: ${daten.anlass}\nGenehmigt von: ${daten.genehmigtVon ?? "—"}\nBeleg-Nr.: ${daten.belegNr}\n\n` +
      `Die vollständige Historie und die Unterrichtstage mit geltendem Satz stehen im angehängten PDF.`,
    dateiname: `${daten.belegNr}.pdf`,
  };
}
