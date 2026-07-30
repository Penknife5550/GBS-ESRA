/**
 * GBS Campus — Honorar-Abrechnung: Zahlungsbeleg fuers DMS (reine Inhaltslogik)
 *
 * Bei der Freigabe einer Abrechnung geht ein Zahlungsbeleg an das DMS. Er ist
 * bewusst vollstaendig — Dozent, Zahlungsempfaenger inkl. IBAN, jede Position
 * (Datum, Fach, Betrag) und die Gesamtsumme —, damit die Finanzbuchhaltung ohne
 * Rueckfrage ueberweisen und ein Dritter alles nachvollziehen kann.
 *
 * DB-frei: baut nur die PDF-Bloecke aus uebergebenen Daten. Die IBAN wird vom
 * IO-Teil (`honorar-abrechnung-io.ts`) aus der Person entschluesselt und hier
 * als Klartext hereingereicht. Kein QR (abhaengigkeitsfreier PDF-Erzeuger) —
 * die DMS-Referenz ist die Beleg-Nummer.
 */

import type { PdfBlock } from "@/lib/pdf";
import { euro } from "@/lib/honorar";
import { datum, datumZeit } from "@/lib/datum";

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
    text: `Beleg-Nr. ${daten.belegNr} · erzeugt am ${datumZeit(daten.erzeugtAm)} · Gemeindebibelschule Minden · Christliches Werk Esra e.V.`,
  });
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
