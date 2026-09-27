/**
 * GBS Campus — Honorar-Abrechnung: Zahlungsbeleg fuers DMS (reine Inhaltslogik)
 *
 * Bei der Freigabe einer Abrechnung geht ein Zahlungsbeleg an das DMS. Er ist
 * bewusst vollstaendig — Dozent, Zahlungsempfaenger inkl. IBAN, jede Position
 * (Datum, Fach, Betrag) und die Gesamtsumme —, damit die Finanzbuchhaltung ohne
 * Rueckfrage ueberweisen und ein Dritter alles nachvollziehen kann.
 *
 * DB-frei: baut nur die PDF-Bloecke und die Begleitmail ans DMS aus uebergebenen
 * Daten. Die IBAN wird vom IO-Teil (`honorar-abrechnung-io.ts`) aus der Person
 * entschluesselt und hier als Klartext hereingereicht. Kein QR
 * (abhaengigkeitsfreier PDF-Erzeuger) — die DMS-Referenz ist die Beleg-Nummer.
 */

import type { PdfBlock } from "@/lib/pdf";
import type { DmsMail } from "@/lib/honorar-korrektur";
import { euro } from "@/lib/honorar";
import { datum, datumZeit } from "@/lib/datum";
import { EINRICHTUNG } from "@/lib/constants";

export type AbrechnungPosten = { datum: Date; fach: string | null; betrag: number };

export type AbrechnungBelegDaten = {
  belegNr: string;
  erzeugtAm: Date;
  dozent: string;
  semester: string;
  statusText: string;
  kontoinhaber: string | null;
  /** IBAN im Klartext — bewusst vollstaendig auf dem Zahlungsbeleg. */
  iban: string;
  freigegebenVon: string | null;
  freigegebenAm: Date | null;
  ausgezahltAm: Date | null;
  posten: AbrechnungPosten[];
  summe: number;
  notiz: string | null;
  /**
   * Nachversand eines nicht angekommenen Belegs (M12): Das PDF traegt dann einen
   * sichtbaren Kopie-Vermerk. Uebernimmt der DMS-Eingang nur den Anhang, stuende
   * die Warnung aus der Mail sonst nirgends — und ging der erste Versand doch
   * durch, laegen zwei gleich aussehende Zahlungsbelege im DMS.
   */
  nachversand?: boolean;
};

/** IBAN in Vierergruppen fuer die Lesbarkeit: „DE12 3456 7890 …". */
function ibanGruppiert(iban: string): string {
  return iban.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();
}

/** Baut aus den Abrechnungsdaten die PDF-Bausteine. Rein, ohne Datenbank. */
export function baueAbrechnungBelegBloecke(daten: AbrechnungBelegDaten): PdfBlock[] {
  const b: PdfBlock[] = [];

  b.push({ art: "titel", text: "Honorar-Abrechnung — Zahlungsbeleg" });
  b.push({
    art: "klein",
    text: `Beleg-Nr. ${daten.belegNr} · erzeugt am ${datumZeit(daten.erzeugtAm)} · ${EINRICHTUNG.name} · ${EINRICHTUNG.traeger}`,
  });
  if (daten.nachversand) {
    b.push({ art: "h2", text: `NACHVERSAND – Kopie des Belegs ${daten.belegNr}, nicht erneut anweisen` });
    b.push({
      art: "absatz",
      text:
        "Dieser Zahlungsbeleg ist bei der Freigabe nicht im DMS angekommen und wird mit unveränderter Beleg-Nr. " +
        "nachgereicht. Liegt der Beleg dort bereits vor, ist dies eine Kopie — die Auszahlung bitte nicht ein zweites " +
        "Mal anweisen. Die Bankverbindung ist der beim Nachversand hinterlegte Stand.",
    });
  }
  b.push({
    art: "absatz",
    text:
      "Abrechnung des Dozentenhonorars für die unten aufgeführten Unterrichtsabende. Die Beträge sind zum " +
      "Zeitpunkt der Erstellung festgeschrieben und ändern sich durch spätere Satzanpassungen nicht mehr.",
  });

  b.push({ art: "h2", text: "Dozent und Zeitraum" });
  b.push({ art: "kv", label: "Dozent", wert: daten.dozent });
  b.push({ art: "kv", label: "Semester", wert: daten.semester });
  b.push({ art: "kv", label: "Status", wert: daten.statusText });
  if (daten.freigegebenVon) {
    b.push({ art: "kv", label: "Freigegeben von", wert: `${daten.freigegebenVon} am ${datumZeit(daten.freigegebenAm)}` });
  }
  if (daten.ausgezahltAm) {
    b.push({ art: "kv", label: "Ausgezahlt am", wert: datum(daten.ausgezahltAm) });
  }
  if (daten.notiz) b.push({ art: "kv", label: "Vermerk", wert: daten.notiz });

  b.push({ art: "h2", text: "Zahlungsempfänger" });
  b.push({ art: "kv", label: "Kontoinhaber", wert: daten.kontoinhaber ?? daten.dozent });
  b.push({ art: "kv", label: "IBAN", wert: ibanGruppiert(daten.iban) });

  b.push({ art: "h2", text: "Positionen" });
  if (daten.posten.length === 0) {
    b.push({ art: "absatz", text: "Diese Abrechnung enthält keine Positionen." });
  }
  for (const p of daten.posten) {
    b.push({
      art: "kv",
      label: `${datum(p.datum)}${p.fach ? " · " + p.fach : ""}`,
      wert: euro(p.betrag),
    });
  }

  b.push({ art: "leer" });
  b.push({ art: "kv", label: `Summe (${daten.posten.length} Abende)`, wert: euro(daten.summe) });

  b.push({ art: "leer" });
  b.push({
    art: "klein",
    text:
      "Maschinell erzeugt aus dem aktuellen Datenbestand. Rückfragen an die Schulverwaltung unter Angabe " +
      "der Beleg-Nummer.",
  });

  return b;
}

/**
 * Betreff, Text und Anhangname der DMS-Mail zum Zahlungsbeleg — gemeinsam fuer
 * die Freigabe und den Nachversand (M12), damit beide Wege dieselbe Regel tragen.
 *
 * Kein Dozentenname im Betreff: `email_versand.betreff` bleibt in unserer
 * Datenbank stehen und wuerde von der Anonymisierung (Art. 17) nicht erfasst.
 * Der Name steht im PDF und im Text; Beleg-Nr + Semester genuegen zur Zuordnung.
 *
 * Beim Nachversand traegt der Betreff den Vermerk „Nachversand“ und der Text den
 * Hinweis, dass es dieselbe Beleg-Nr ist: Ging der erste Versand doch durch und
 * nur das Festhalten scheiterte, darf die Finanzbuchhaltung nicht doppelt anweisen.
 */
export function baueAbrechnungDmsMail(daten: AbrechnungBelegDaten, nachversand: boolean): DmsMail {
  const vermerk = nachversand
    ? `NACHVERSAND mit unveränderter Beleg-Nr.: Dieser Zahlungsbeleg ist bei der Freigabe nicht im DMS angekommen ` +
      `und wird hiermit nachgereicht. Liegt der Beleg ${daten.belegNr} dort bereits vor, ist dies eine Kopie — ` +
      `bitte nicht erneut anweisen. Die Positionen sind die bei der Abrechnung festgeschriebenen; die Bankverbindung ` +
      `ist der beim Nachversand hinterlegte Stand.\n\n`
    : "";
  return {
    betreff: `Honorar-Abrechnung ${daten.belegNr} — ${daten.semester}${nachversand ? " (Nachversand)" : ""}`,
    text:
      vermerk +
      `Zahlungsbeleg der ${EINRICHTUNG.name} zur Freigabe der Dozentenhonorar-Auszahlung.\n\n` +
      `Dozent: ${daten.dozent}\nSemester: ${daten.semester}\nSumme: ${daten.summe} EUR\nBeleg-Nr.: ${daten.belegNr}\n\n` +
      `Der vollständige Beleg mit Zahlungsempfänger (inkl. IBAN) und allen Positionen liegt im angehängten PDF.`,
    dateiname: `${daten.belegNr}.pdf`,
  };
}
