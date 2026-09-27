/**
 * GBS Campus — Navigation (DB-frei)
 *
 * Seit dem Oberflächenplan „Weniger suchen, schneller erledigt“ (09/2026) führt
 * eine feste Leiste durch die Bereiche — links am Rechner, unten am Handy —
 * statt einer Startseite mit Kacheln. Hier steht, welche Punkte es gibt, wer sie
 * sieht (dieselben Rechte wie die früheren Kacheln) und wann ein Punkt als aktiv
 * gilt. Ohne Datenbank, damit `scripts/pruefe-navigation.ts` die Regeln prüft;
 * gezeichnet wird in `src/components/rahmen/`.
 */

import type { IconName } from "@/components/icons";
import { RECHT, ROLLE, type RechtCode } from "@/lib/constants";

export type NavPunkt = {
  schluessel: string;
  titel: string;
  pfad: string;
  icon: IconName;
  /** Weitere Pfade, unter denen dieser Punkt als aktiv gilt (samt Unterseiten). */
  auch?: readonly string[];
  /** Nötiges Recht. Ohne Angabe sieht ihn jeder, der den Bereich sieht. */
  recht?: RechtCode;
};

/** Wie jemand die Anwendung sieht: Verwaltung (Leiste links), Dozent oder Teilnehmer (Leiste unten am Handy). */
export type Bereich = "verwaltung" | "dozent" | "teilnehmer";

/** Die Hauptbereiche der Verwaltung, in dieser Reihenfolge. */
export const VERWALTUNG_HAUPT: readonly NavPunkt[] = [
  { schluessel: "heute", titel: "Heute", pfad: "/verwaltung", icon: "heute", recht: RECHT.PERSON_LESEN_ALLE },
  {
    schluessel: "anmeldungen",
    titel: "Anmeldungen",
    pfad: "/verwaltung/anmeldungen",
    icon: "eingang",
    recht: RECHT.ANMELDUNG_LESEN,
  },
  {
    schluessel: "personen",
    titel: "Personen",
    pfad: "/verwaltung/personen",
    icon: "personen",
    auch: ["/verwaltung/teilnehmer"],
    recht: RECHT.PERSON_LESEN_ALLE,
  },
  {
    schluessel: "unterricht",
    titel: "Unterricht",
    pfad: "/verwaltung/stundenplan",
    icon: "kalender",
    recht: RECHT.SEMESTER_VERWALTEN,
  },
  {
    schluessel: "noten",
    titel: "Noten & Zeugnisse",
    pfad: "/verwaltung/noten",
    icon: "abschluss",
    auch: ["/verwaltung/zeugnisse"],
    recht: RECHT.NOTEN_VERWALTEN,
  },
  {
    schluessel: "semester",
    titel: "Semester",
    pfad: "/verwaltung/semester",
    icon: "ebenen",
    auch: ["/verwaltung/semesterueberleitung", "/verwaltung/faecher"],
    recht: RECHT.SEMESTER_VERWALTEN,
  },
];

/** Seltener gebraucht: steht in der Leiste unter „Verwaltung“. */
export const VERWALTUNG_WEITERE: readonly NavPunkt[] = [
  { schluessel: "honorar", titel: "Honorar", pfad: "/verwaltung/honorar", icon: "honorar", recht: RECHT.HONORAR_LESEN },
  {
    schluessel: "formulare",
    titel: "Formulare",
    pfad: "/verwaltung/formulare",
    icon: "formulare",
    recht: RECHT.FORMULAR_BEARBEITEN,
  },
  { schluessel: "protokoll", titel: "Protokoll", pfad: "/verwaltung/protokoll", icon: "protokoll", recht: RECHT.AUDIT_LESEN },
  {
    schluessel: "einstellungen",
    titel: "Einstellungen",
    pfad: "/verwaltung/einstellungen",
    icon: "einstellungen",
    recht: RECHT.SYSTEM_EINSTELLUNGEN,
  },
  { schluessel: "betrieb", titel: "Betrieb", pfad: "/verwaltung/betrieb", icon: "betrieb", recht: RECHT.SYSTEM_EINSTELLUNGEN },
];

/**
 * Unten in der Leiste der Verwaltung, für alle mit eigenen Unterrichtsabenden —
 * vorher erreichte eine Schulleitung, die selbst unterrichtet, „Mein Unterricht“
 * nur über die Adresszeile.
 */
export const MEIN_UNTERRICHT: NavPunkt = {
  schluessel: "mein-unterricht",
  titel: "Mein Unterricht",
  pfad: "/dozent",
  icon: "unterricht",
  recht: RECHT.EIGENE_TERMINE_LESEN,
};

/** Dozenten ohne Verwaltungsrecht. */
export const DOZENT_NAV: readonly NavPunkt[] = [
  { schluessel: "unterricht", titel: "Unterricht", pfad: "/dozent", icon: "kalender" },
  { schluessel: "noten", titel: "Noten", pfad: "/dozent/noten", icon: "abschluss" },
  { schluessel: "ich", titel: "Ich", pfad: "/meine-daten/ich", icon: "profil", auch: ["/meine-daten"] },
];

/** Teilnehmer. */
export const TEILNEHMER_NAV: readonly NavPunkt[] = [
  { schluessel: "uebersicht", titel: "Übersicht", pfad: "/meine-daten", icon: "haus" },
  { schluessel: "abende", titel: "Abende", pfad: "/meine-daten/abende", icon: "kalender" },
  { schluessel: "ich", titel: "Ich", pfad: "/meine-daten/ich", icon: "profil", auch: ["/meine-daten/email"] },
];

/** Die eigene Akte (Kontakt, Bank, E-Mail, Passwort) — Ziel von „Meine Daten“ im Profilmenü. */
export const EIGENE_DATEN_PFAD = "/meine-daten/ich";

/**
 * Welcher Bereich? Dieselbe Weiche wie früher auf der Startseite der Verwaltung:
 * wer alle Personen lesen darf, arbeitet in der Verwaltung; wer eigene Abende
 * hat, als Dozent; alle anderen als Teilnehmer.
 */
export function bereichFuer(hat: (recht: RechtCode) => boolean): Bereich {
  if (hat(RECHT.PERSON_LESEN_ALLE)) return "verwaltung";
  if (hat(RECHT.EIGENE_TERMINE_LESEN)) return "dozent";
  return "teilnehmer";
}

/** Nur die Punkte, für die das Konto das Recht hat. */
export function sichtbarePunkte(punkte: readonly NavPunkt[], hat: (recht: RechtCode) => boolean): NavPunkt[] {
  return punkte.filter((p) => !p.recht || hat(p.recht));
}

/** Liegt `pfadname` auf `pfad` oder darunter? („/verwaltung/personen/123“ liegt unter „/verwaltung/personen“.) */
export function liegtUnter(pfadname: string, pfad: string): boolean {
  return pfadname === pfad || pfadname.startsWith(pfad.endsWith("/") ? pfad : `${pfad}/`);
}

/**
 * Der aktive Punkt: der mit dem längsten passenden Pfad. So gewinnt
 * „/verwaltung/personen“ gegen „/verwaltung“ (Heute), und Unterseiten ohne
 * eigenen Punkt (etwa eine einzelne Anmeldung) markieren ihren Bereich.
 */
export function aktiverPunkt(punkte: readonly NavPunkt[], pfadname: string): string | null {
  let bester: { schluessel: string; laenge: number } | null = null;
  for (const punkt of punkte) {
    for (const kandidat of [punkt.pfad, ...(punkt.auch ?? [])]) {
      if (liegtUnter(pfadname, kandidat) && (!bester || kandidat.length > bester.laenge)) {
        bester = { schluessel: punkt.schluessel, laenge: kandidat.length };
      }
    }
  }
  return bester?.schluessel ?? null;
}

/** Wie die Rolle unter dem Namen im Profil heißt — die „höchste“ Rolle zuerst. */
export function rollenBezeichnung(rollen: readonly string[]): string {
  if (rollen.includes(ROLLE.SCHULLEITER)) return "Schulleitung";
  if (rollen.includes(ROLLE.VERWALTUNG)) return "Verwaltung";
  if (rollen.includes(ROLLE.ADMIN)) return "Administration";
  if (rollen.includes(ROLLE.DOZENT) || rollen.includes(ROLLE.GASTDOZENT)) return "Dozent";
  if (rollen.includes(ROLLE.TEILNEHMER)) return "Teilnehmer";
  return "Konto";
}

/** Initialen für das Profilzeichen: „Andreas Klassen“ → „AK“. */
export function initialen(vorname: string, nachname: string): string {
  const erster = (text: string) => Array.from(text.trim())[0] ?? "";
  return `${erster(vorname)}${erster(nachname)}`.toUpperCase() || "?";
}
