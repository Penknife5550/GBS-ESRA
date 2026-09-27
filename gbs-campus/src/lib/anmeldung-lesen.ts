/**
 * GBS Campus — eine Anmeldung zum Lesen (DB-frei)
 *
 * Oberflächenplan 09/2026, Etappe 2: Die Schulleitung liest sich kurz ein und
 * entscheidet. Deshalb stehen Motivation, Ziel, Glaube sowie Gemeinde und
 * Dienst zuerst, die Formalien kompakt darunter, leere Antworten gar nicht;
 * die vollständige Fassung („Alle Angaben wie eingereicht“) bleibt aufklappbar.
 *
 * Grundlage ist ausschließlich die Antwortansicht aus `lib/anmeldung-antworten.ts`
 * (`baueAntwortAnsicht`): Ausgeblendete Art.-9-Antworten und IBAN-Felder tragen
 * dort keinen Wert, sie können hier also gar nicht erscheinen. Die Zuordnung zu
 * den Überschriften geht über die Feldcodes des Bewerbungsformulars
 * (prisma/anmeldeformular-definition.ts). Antworten eines geänderten Formulars,
 * die keine Überschrift kennt, gehen nicht verloren: Art.-9-Antworten stehen
 * unter „Weitere Angaben“, alles steht in der vollständigen Fassung.
 */

import type { AntwortAnsicht } from "@/lib/anmeldung-antworten";
import { alsTagesdatum, berlinerTag } from "@/lib/datum";

export type AntwortWert = { label: string; wert: string };

/** Hat jemand etwas geantwortet? „—“ (nicht beantwortet) und „(leer)“ zählen nicht. */
export function istBeantwortet(wert: string): boolean {
  const w = wert.trim();
  return w !== "" && w !== "—" && w !== "(leer)";
}

/** Die sichtbaren, beantworteten Antworten nach Feldcode (ohne ausgeblendete und IBAN-Felder). */
export function sichtbareAntworten(ansicht: AntwortAnsicht): Map<string, AntwortWert> {
  const werte = new Map<string, AntwortWert>();
  for (const block of ansicht.abschnitte) {
    for (const zeile of block.zeilen) {
      if (zeile.art === "wert" && istBeantwortet(zeile.wert)) werte.set(zeile.code, { label: zeile.label, wert: zeile.wert.trim() });
    }
  }
  return werte;
}

export type LeseEintrag = { vorsatz: string | null; text: string };
export type LeseAbschnitt = { titel: string; eintraege: LeseEintrag[] };

/** Die Leseordnung: Überschrift, Feldcodes und ein kurzer Vorsatz, wo die Antwort allein mehrdeutig wäre. */
const LESEFOLGE: { titel: string; felder: { code: string; vorsatz?: string }[] }[] = [
  { titel: "Motivation", felder: [{ code: "motivation" }] },
  { titel: "Ziel", felder: [{ code: "ziele" }] },
  { titel: "Glaube", felder: [{ code: "glaube_bekenntnis" }, { code: "glaube_werdegang" }] },
  {
    titel: "Gemeinde und Dienst",
    felder: [
      { code: "gemeinde_mitglied", vorsatz: "Mitglied" },
      { code: "gemeinde_aktuell", vorsatz: "Besucht zurzeit" },
      { code: "gemeinde_beteiligung", vorsatz: "Im Gemeindeleben" },
      { code: "dienst_erfahrung", vorsatz: "Erfahrung im Dienst" },
      { code: "dienst_vorbereitung", vorsatz: "Vorbereitung auf" },
    ],
  },
];

/**
 * Die Abschnitte zum Lesen, nur mit beantworteten Fragen. `art9Codes` sind die
 * Art.-9-Felder der Formularfassung: Solche, die keine Überschrift kennt, stehen
 * unter „Weitere Angaben“ mit ihrer Frage als Vorsatz.
 */
export function leseAbschnitte(werte: ReadonlyMap<string, AntwortWert>, art9Codes: ReadonlySet<string>): LeseAbschnitt[] {
  const verwendet = new Set<string>();
  const abschnitte: LeseAbschnitt[] = [];
  for (const abschnitt of LESEFOLGE) {
    const eintraege: LeseEintrag[] = [];
    for (const feld of abschnitt.felder) {
      const antwort = werte.get(feld.code);
      if (!antwort) continue;
      verwendet.add(feld.code);
      eintraege.push({ vorsatz: feld.vorsatz ?? null, text: antwort.wert });
    }
    if (eintraege.length > 0) abschnitte.push({ titel: abschnitt.titel, eintraege });
  }
  const weitere = [...werte]
    .filter(([code]) => art9Codes.has(code) && !verwendet.has(code))
    .map(([, antwort]) => ({ vorsatz: antwort.label, text: antwort.wert }));
  if (weitere.length > 0) abschnitte.push({ titel: "Weitere Angaben", eintraege: weitere });
  return abschnitte;
}

export type Formalie = { label: string; wert: string };

const verbinde = (teile: (string | null | undefined)[]) =>
  [...new Set(teile.filter((t): t is string => Boolean(t && t.trim())))].join(" · ");

/** Beruf, Kontakt, Adresse und Familie in je einer Zeile; leere Zeilen fallen weg. */
export function formalien(werte: ReadonlyMap<string, AntwortWert>): Formalie[] {
  const w = (code: string) => werte.get(code)?.wert ?? null;
  const derzeitig = w("derzeitiger_beruf");
  const gelernt = w("erlernter_beruf");
  const plzOrt = [w("plz"), w("ort")].filter(Boolean).join(" ");
  const zeilen: Formalie[] = [
    { label: "Beruf", wert: verbinde([derzeitig, gelernt && gelernt !== derzeitig ? `gelernt: ${gelernt}` : null, w("schulabschluss")]) },
    { label: "Kontakt", wert: verbinde([w("email"), w("telefon")]) },
    { label: "Adresse", wert: [w("strasse"), plzOrt].filter(Boolean).join(", ") },
    { label: "Familie", wert: verbinde([w("familienstand")]) },
  ];
  return zeilen.filter((z) => z.wert !== "");
}

/**
 * Die Beitragsangaben als kurze Teile („Einzug erlaubt“, „halbjährlich“ …).
 * Die IBAN setzt der Aufrufer dazu — sie steht nie im Antwortbogen, nur
 * verschlüsselt an der Person. `name` ist der Name der Anmeldung: Ein
 * abweichender Kontoinhaber wird genannt.
 */
export function beitragTeile(werte: ReadonlyMap<string, AntwortWert>, name: string | null): string[] {
  const w = (code: string) => werte.get(code)?.wert ?? null;
  const einzug = w("einzug_einverstanden");
  const inhaber = w("kontoinhaber");
  return [
    einzug === "Ja" ? "Einzug erlaubt" : einzug === "Nein" ? "kein Einzug" : null,
    w("zahlweise")?.toLowerCase() ?? null,
    inhaber && name && inhaber !== name ? `Konto von ${inhaber}` : null,
    w("ehepartner_gemeinsam") === "Ja" ? "gemeinsam mit dem Ehepartner angemeldet" : null,
  ].filter((t): t is string => Boolean(t));
}

/** „Schüler, mit Prüfungen“ / „Hörer, ohne Prüfungen“ — leer ohne Teilnahmeform. */
export function teilnahmeLang(form: string | null | undefined): string {
  if (form === "SCHUELER") return "Schüler, mit Prüfungen";
  if (form === "HOERER") return "Hörer, ohne Prüfungen";
  return "";
}

/** Ein Datum aus dem Formular („1985-12-09“) deutsch: „09.12.1985“. Anderes bleibt, wie es ist. */
export function deutschesDatum(wert: string): string {
  const tag = alsTagesdatum(wert);
  if (!tag) return wert;
  const [jahr, monat, t] = wert.trim().split("-");
  return `${t}.${monat}.${jahr}`;
}

/** Alter in ganzen Jahren am heutigen Berliner Tag; `geburt` ist ein Kalendertag (UTC-Mitternacht). */
export function alterInJahren(geburt: Date, jetzt: Date): number {
  const [jahr, monat, tag] = berlinerTag(jetzt).split("-").map(Number);
  const vorGeburtstag =
    monat < geburt.getUTCMonth() + 1 || (monat === geburt.getUTCMonth() + 1 && tag < geburt.getUTCDate());
  return jahr - geburt.getUTCFullYear() - (vorGeburtstag ? 1 : 0);
}
