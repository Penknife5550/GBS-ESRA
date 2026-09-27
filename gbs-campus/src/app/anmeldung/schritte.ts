/**
 * GBS Campus — Anmeldeformular in Schritten: die Regeln ohne Oberfläche
 *
 * Jeder Abschnitt der veröffentlichten Fassung ist ein Schritt, am Ende steht
 * „Prüfen und absenden“ (Oberflächenplan 09/2026). Hier steht, was vor „Weiter“
 * geprüft wird und wie die Übersicht einen Abschnitt in einer Zeile
 * zusammenfasst.
 *
 * Maßgeblich bleibt die Prüfung auf dem Server (`pruefeAntworten` in
 * lib/formular.ts, die nicht in den Browser darf). Diese hier sagt nur früher
 * und am richtigen Feld, was fehlt — mit denselben Mustern für E-Mail, Telefon
 * und IBAN, damit sie nie strenger ist als der Server.
 */

import { hatEingabe } from "@/lib/anmeldung-antworten";
import { alsTagesdatum, datum } from "@/lib/datum";
import { istIbanGueltig } from "@/lib/pruefwerte";
import type { EinwilligungsAngebot, OeffentlicherAbschnitt, OeffentlichesFeld } from "./oeffentliches-formular";

/** Ein Abschnitt, der erst nach der Art.-9-Einwilligung erscheint. */
export function istNurArt9(abschnitt: OeffentlicherAbschnitt): boolean {
  return abschnitt.felder.length > 0 && abschnitt.felder.every((f) => f.istArt9);
}

/**
 * Schlüssel und Element-ID einer Einwilligung in der Fehlerliste. Feldcodes
 * stehen dort ohne Vorsilbe (der Server meldet sie so), ihr Element heißt
 * `feld-<code>`.
 */
export function einwilligungsId(code: string): string {
  return `einwilligung-${code}`;
}

/** Die Element-ID zu einem Schlüssel der Fehlerliste — Ziel für den Fokus. */
export function elementId(schluessel: string): string {
  return schluessel.startsWith("einwilligung-") ? schluessel : `feld-${schluessel}`;
}

/** Wird das Feld gerade abgefragt? Hinweise nie, Art.-9-Fragen nur mit Einwilligung (wie auf dem Server). */
export function wirdAbgefragt(feld: OeffentlichesFeld, art9Erteilt: boolean): boolean {
  return feld.typ !== "HINWEIS" && (!feld.istArt9 || art9Erteilt);
}

// Dieselben Muster wie pruefeFeld in lib/formular.ts.
const EMAIL_MUSTER = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TELEFON_MUSTER = /^[0-9+\-\s()/]{5,30}$/;

function meldungFuer(feld: OeffentlichesFeld, wert: unknown): string | null {
  if (!hatEingabe(wert)) {
    if (!feld.pflicht) return null;
    if (feld.typ === "AUSWAHL_MEHRFACH") return "Bitte wählen Sie mindestens eine Antwort.";
    if (feld.typ === "AUSWAHL_EINFACH" || feld.typ === "JA_NEIN") return "Bitte wählen Sie eine Antwort.";
    return "Bitte füllen Sie dieses Feld aus.";
  }
  const text = typeof wert === "string" ? wert.trim() : "";
  if (feld.typ === "EMAIL" && !EMAIL_MUSTER.test(text.toLowerCase())) {
    return "Bitte geben Sie eine gültige E-Mail-Adresse an.";
  }
  if (feld.typ === "TELEFON" && !TELEFON_MUSTER.test(text)) return "Bitte geben Sie eine gültige Telefonnummer an.";
  if (feld.typ === "IBAN" && !istIbanGueltig(text.replace(/\s+/g, "").toUpperCase())) {
    return "Diese IBAN stimmt nicht. Bitte Länderkürzel und Ziffern prüfen.";
  }
  return null;
}

/**
 * Was in einem Schritt noch fehlt: Schlüssel (Feldcode bzw. `einwilligung-…`)
 * → Meldung, in der Reihenfolge auf dem Bildschirm. `zustimmungenHier` sind
 * die Einwilligungen, die dieser Schritt selbst abfragt (im ersten Art.-9-
 * Abschnitt die nach Art. 9): Ist eine davon Pflicht, geht es ohne sie nicht
 * weiter — die Fragen des Schritts erscheinen ja erst mit ihr.
 */
export function pruefeAbschnitt(
  abschnitt: OeffentlicherAbschnitt,
  antworten: Record<string, unknown>,
  erteilt: ReadonlySet<string>,
  art9Erteilt: boolean,
  zustimmungenHier: EinwilligungsAngebot[],
): Record<string, string> {
  const offen: Record<string, string> = {};
  for (const einwilligung of zustimmungenHier) {
    if (einwilligung.pflicht && !erteilt.has(einwilligung.code)) {
      offen[einwilligungsId(einwilligung.code)] = "Bitte stimmen Sie zu — ohne diese Zustimmung ist keine Anmeldung möglich.";
    }
  }
  for (const feld of abschnitt.felder) {
    if (!wirdAbgefragt(feld, art9Erteilt)) continue;
    const meldung = meldungFuer(feld, antworten[feld.code]);
    if (meldung) offen[feld.code] = meldung;
  }
  return offen;
}

/** Ein Wert, wie er in der Übersicht steht („09.12.1985“, „Abitur“); ohne Eingabe `null`. */
function alsText(feld: OeffentlichesFeld, wert: unknown): string | null {
  if (!hatEingabe(wert)) return null;
  // Ja/Nein-Fragen sind als Aussage formuliert („Ich bin mit dem Einzug …
  // einverstanden“) — ein „Ja“ zeigt die Aussage, ein „Nein“ nichts.
  if (feld.typ === "JA_NEIN") return wert === true ? feld.label : null;
  if (Array.isArray(wert)) return wert.join(", ");
  const text = String(wert).replace(/\s+/g, " ").trim();
  if (feld.typ === "DATUM") {
    const tag = alsTagesdatum(text);
    return tag ? datum(tag) : text;
  }
  return text;
}

/** Aktenfelder, die sich zusammen lesen: „Ruth Hamm“, „32423 Minden“. */
const PAARE: readonly (readonly [string, string])[] = [
  ["VORNAME", "NACHNAME"],
  ["PLZ", "ORT"],
];

/** Die Angaben eines Abschnitts in einer Zeile („Frau · Ruth Hamm · 09.12.1985 · …“); ohne Angaben `null`. */
export function zusammenfassung(
  abschnitt: OeffentlicherAbschnitt,
  antworten: Record<string, unknown>,
  art9Erteilt: boolean,
): string | null {
  const teile: string[] = [];
  let vorher: string | null = null;
  for (const feld of abschnitt.felder) {
    if (!wirdAbgefragt(feld, art9Erteilt)) continue;
    const text = alsText(feld, antworten[feld.code]);
    if (!text) continue;
    if (PAARE.some(([erstes, zweites]) => erstes === vorher && zweites === feld.personFeld)) {
      teile[teile.length - 1] += ` ${text}`;
    } else {
      teile.push(text);
    }
    vorher = feld.personFeld;
  }
  return teile.length > 0 ? teile.join(" · ") : null;
}
