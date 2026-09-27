/**
 * GBS Campus — Anzeige-Helfer der Personenakte
 *
 * Welche Farbe ein Stand als `StatusPunkt` bekommt und wie Anwesenheit,
 * Ergebnis und Alter als Wort erscheinen (Oberflächenplan 09/2026: Farbe nur
 * als Punkt vor einem Wort, die Aussage trägt das Wort). Bewusst Funktionen
 * statt Tint-Tabellen; die Farben folgen denselben Regeln wie die Badges in
 * `components/ui/badges.tsx`, damit ein Abend in der Akte dieselbe Farbe hat
 * wie in der Schüler-Akte. DB-frei und ohne "use client".
 */

import type { StatusTon } from "@/components/ui/status-punkt";
import { STATUS } from "@/lib/constants";
import { ergebnisName, giltAlsBestanden, type LeistungWert } from "@/lib/leistung";
import { ANWESENHEIT, anwesenheitName, zaehltAlsTeilgenommen } from "@/lib/stundenplan";

/** Personenstatus: Aktiv grün, Interessent und Angenommen blau, Beurlaubt gelb, Ausgeschlossen rot, sonst grau. */
export function personStatusTon(code: string): StatusTon {
  switch (code) {
    case STATUS.AKTIV:
      return "gruen";
    case STATUS.INTERESSENT:
    case STATUS.ANGENOMMEN:
      return "blau";
    case STATUS.BEURLAUBT:
      return "gelb";
    case STATUS.AUSGESCHLOSSEN:
      return "rot";
    default:
      return "grau";
  }
}

/** Ein Abend: teilgenommen (anwesend, nachgearbeitet) grün, entschuldigt gelb, gefehlt rot, noch offen grau. */
export function anwesenheitTon(status: string | null): StatusTon {
  if (zaehltAlsTeilgenommen(status)) return "gruen";
  if (status === ANWESENHEIT.ENTSCHULDIGT) return "gelb";
  if (status === ANWESENHEIT.GEFEHLT) return "rot";
  return "grau";
}

/**
 * Das Wort zum Abend. Einen Eintrag, den der Teilnehmer selbst gesetzt hat,
 * nennt die Akte „selbst bestätigt“ — die Verwaltung sieht so, was der Dozent
 * erfasst hat und was nicht.
 */
export function anwesenheitText(status: string | null, selbst: boolean): string {
  if (!status) return "noch offen";
  if (!selbst) return anwesenheitName(status);
  return status === ANWESENHEIT.ANWESEND ? "selbst bestätigt" : `${anwesenheitName(status)}, selbst bestätigt`;
}

/** Ergebnis: bestanden grün, nicht bestanden rot, teilgenommen blau — dieselbe Regel wie `ErgebnisBadge`. */
export function ergebnisTon(ergebnis: string): StatusTon {
  if (giltAlsBestanden(ergebnis)) return "gruen";
  if (ergebnis === "NICHT_BESTANDEN") return "rot";
  if (ergebnis === "TEILGENOMMEN") return "blau";
  return "grau";
}

/** „bestanden · 87 Punkte · Note gut“ — Punkte und Note nur, wo sie erfasst sind. */
export function ergebnisText(wert: LeistungWert): string {
  return [
    ergebnisName(wert.ergebnis),
    wert.punkte != null ? `${wert.punkte} Punkte` : null,
    wert.note ? `Note ${wert.note}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Zeugnis: gültig grün, storniert rot, ersetzt grau. */
export function zeugnisTon(status: string): StatusTon {
  if (status === "GUELTIG") return "gruen";
  if (status === "STORNIERT") return "rot";
  return "grau";
}

/**
 * Volle Lebensjahre zwischen einem Geburtstag (Spalte `date`, also UTC-Mitternacht)
 * und dem heutigen Berliner Kalendertag („JJJJ-MM-TT“, `heuteBerlin()`).
 */
export function alterInJahren(geburtsdatum: Date, heute: string): number | null {
  const [jahr, monat, tag] = heute.split("-").map(Number);
  if (!jahr || !monat || !tag) return null;
  const gMonat = geburtsdatum.getUTCMonth() + 1;
  const vorDemGeburtstag = monat < gMonat || (monat === gMonat && tag < geburtsdatum.getUTCDate());
  const alter = jahr - geburtsdatum.getUTCFullYear() - (vorDemGeburtstag ? 1 : 0);
  return alter >= 0 ? alter : null;
}
