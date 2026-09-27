/**
 * GBS Campus — Anmeldeantworten zeigen und Zwischenstände ehrlich ankündigen:
 * reine Logik, ohne Datenbank
 *
 * Zwei Oberflächen brauchen dieselbe Antwort auf die Frage „welche Angaben sind
 * besonders geschützt?":
 *
 *  - Die Antwortansicht der Verwaltung (`/verwaltung/anmeldungen/[id]`). Die
 *    Schulleitung soll die Bewerbung lesen können, bevor sie aufnimmt — aber
 *    Art.-9-Antworten nur mit Entscheidungsrecht UND wirksamer Einwilligung, und
 *    die IBAN nie im Klartext.
 *  - Das öffentliche Formular. „Später weitermachen" speichert Art.-9-Felder und
 *    die IBAN bewusst NICHT (`bereinigeEntwurf` in `lib/formular.ts`, rechtlich
 *    gewollt). Die Meldungen sollen genau das sagen — aus den Formulardaten
 *    abgeleitet, nicht als fester Satz, der beim nächsten Formularumbau nicht
 *    mehr stimmt.
 *
 * Bewusst ohne Laufzeit-Import aus Prisma: Das öffentliche Formular ist eine
 * Client-Komponente, und nur so lässt sich das Modul per Prüfskript ohne
 * Datenbank testen (`scripts/pruefe-anmeldung-antworten.ts`).
 */

import type { FeldTyp } from "@prisma/client";
import { formatiereWert } from "@/lib/auskunft-inhalt";

/** Die Teile eines Formularfelds, die hier gebraucht werden. */
export type AnsichtFeld = {
  code: string;
  typ: string;
  label: string;
  istArt9: boolean;
  personFeld?: string | null;
};

export type AnsichtAbschnitt = { titel: string; felder: AnsichtFeld[] };

/**
 * Wird ein Feld wie eine IBAN behandelt? Dieselbe Regel wie `geheimeFeldcodes`
 * in `lib/formular.ts`: am Feldtyp UND an der Aktenzuordnung — eine IBAN bleibt
 * geheim, auch wenn sie (versehentlich) nicht der Akte zugeordnet ist. Die
 * Gleichheit beider Regeln sichert das Prüfskript ab.
 */
export function istIbanFeld(feld: { typ: string; personFeld?: string | null }): boolean {
  return feld.typ === "IBAN" || feld.personFeld === "IBAN";
}

// -----------------------------------------------------------------------------
// Einwilligung und Freigabe
// -----------------------------------------------------------------------------

export type EinwilligungsEintrag = { erteilt: boolean; zeitpunkt: Date };

/**
 * Ist eine Einwilligung JETZT wirksam?
 *
 * Das Einwilligungsprotokoll ist append-only (schema.prisma, `Einwilligung`):
 * Erteilung und Verweigerung bzw. Widerruf sind je eigene Zeilen, nichts wird
 * überschrieben. Es gilt deshalb die jüngste Zeile. Stehen eine Erteilung und
 * eine Verweigerung auf demselben Zeitpunkt, gilt die Einwilligung als NICHT
 * wirksam — bei Angaben nach Art. 9 DSGVO wird im Zweifel nichts gezeigt.
 */
export function einwilligungWirksam(eintraege: EinwilligungsEintrag[]): boolean {
  let letzteErteilung: number | null = null;
  let letzteVerweigerung: number | null = null;

  for (const eintrag of eintraege) {
    const zeit = eintrag.zeitpunkt.getTime();
    if (eintrag.erteilt) {
      if (letzteErteilung === null || zeit > letzteErteilung) letzteErteilung = zeit;
    } else if (letzteVerweigerung === null || zeit > letzteVerweigerung) {
      letzteVerweigerung = zeit;
    }
  }

  if (letzteErteilung === null) return false;
  return letzteVerweigerung === null || letzteVerweigerung < letzteErteilung;
}

export type Art9Freigabe = "SICHTBAR" | "KEIN_RECHT" | "KEINE_EINWILLIGUNG";

/**
 * Dürfen Art.-9-Antworten gezeigt werden? Beide Bedingungen müssen erfüllt sein:
 * Der Betrachter entscheidet über die Aufnahme (nur dafür wurden die Angaben
 * erhoben — Zweckbindung), und die Person hat eingewilligt. Das Recht wird
 * zuerst geprüft: Wer es nicht hat, erfährt auch nicht, ob eine Einwilligung
 * vorliegt.
 */
export function art9Freigabe(darfEntscheiden: boolean, einwilligungLiegtVor: boolean): Art9Freigabe {
  if (!darfEntscheiden) return "KEIN_RECHT";
  if (!einwilligungLiegtVor) return "KEINE_EINWILLIGUNG";
  return "SICHTBAR";
}

/**
 * Sind beim Absenden ALLE angebotenen Art.-9-Einwilligungen erteilt? Dieselbe
 * Regel für das öffentliche Formular (schaltet die Art.-9-Abschnitte frei) und
 * für den Server (`nimmAnmeldungEntgegen` speichert Art.-9-Antworten nur dann).
 * Vorher prüfte der Server fest den Code GLAUBENSANGABEN, der Client alle
 * Art.-9-Texte — mit einem zweiten Art.-9-Text hätten beide verschieden
 * entschieden.
 *
 * Maßgeblich sind die angebotenen Texte, nicht die mitgeschickten Codes: Ein
 * Code, zu dem es keinen gültigen Text gibt, erteilt nichts. Und `every` auf
 * einer leeren Liste ergäbe `true` — deshalb gilt ohne jeden Art.-9-Text nichts
 * als erteilt: Die Art.-9-Abschnitte bleiben gesperrt, und Art.-9-Antworten
 * werden verworfen, denn ohne Einwilligungstext gibt es keine Einwilligung.
 */
export function art9Eingewilligt(
  texte: readonly { code: string; istArt9: boolean }[],
  erteilt: ReadonlySet<string>,
): boolean {
  const art9Texte = texte.filter((t) => t.istArt9);
  return art9Texte.length > 0 && art9Texte.every((t) => erteilt.has(t.code));
}

/**
 * Sind die Art.-9-Einwilligungen einer Person JETZT wirksam? Je Einwilligungstext
 * (Code, über alle Fassungen) gilt `einwilligungWirksam`; wirksam ist das Ganze
 * nur, wenn es mindestens einen solchen Text gibt und ALLE wirksam sind —
 * dieselbe Linie wie `art9Eingewilligt` beim Absenden. Übergeben werden die
 * Protokollzeilen aller Texte mit `istArt9`. Vorher entschied die Anzeige allein
 * nach dem Code GLAUBENSANGABEN: Mit einem zweiten Art.-9-Text und dessen
 * Widerruf blieben die Antworten sichtbar.
 */
export function art9EinwilligungenWirksam(eintraege: readonly (EinwilligungsEintrag & { code: string })[]): boolean {
  const jeText = new Map<string, EinwilligungsEintrag[]>();
  for (const eintrag of eintraege) {
    const liste = jeText.get(eintrag.code) ?? [];
    liste.push(eintrag);
    jeText.set(eintrag.code, liste);
  }
  return jeText.size > 0 && [...jeText.values()].every((liste) => einwilligungWirksam(liste));
}

// -----------------------------------------------------------------------------
// Antwortansicht der Verwaltung
// -----------------------------------------------------------------------------

/**
 * Eine Zeile der Antwortansicht. Ausgeblendete Art.-9-Antworten und IBAN-Felder
 * tragen absichtlich KEIN `wert`-Feld — die Seite kann den Inhalt gar nicht
 * versehentlich ausgeben, weil er hier nie ankommt.
 */
export type AnsichtZeile =
  | { code: string; label: string; art: "wert"; wert: string }
  | { code: string; label: string; art: "art9_verborgen" }
  | { code: string; label: string; art: "iban" };

export type AnsichtBlock = { titel: string; zeilen: AnsichtZeile[] };

export type AntwortAnsicht = {
  abschnitte: AnsichtBlock[];
  /** Gespeicherte Antworten zu Codes, die die Fassung nicht kennt. */
  weitere: AnsichtZeile[];
};

/**
 * Ordnet die gespeicherten Antworten den Abschnitten und Feldern ihrer
 * Formularfassung zu — mit den Labels, die damals gestellt wurden.
 *
 *  - Hinweisfelder sind keine Fragen und fehlen.
 *  - Unbeantwortete Fragen erscheinen mit „—": Für die Entscheidung zählt auch,
 *    was offen blieb.
 *  - IBAN-Felder zeigen nie einen Wert — auch dann nicht, wenn eine alte
 *    Anmeldung (vor dem Review) die IBAN noch im Antwort-JSON trägt.
 *  - Art.-9-Felder zeigen ihren Wert nur mit `art9Zeigen`.
 *  - Antworten zu unbekannten Codes lassen sich keiner Frage zuordnen und damit
 *    auch nicht einstufen. Sie werden deshalb wie Art.-9-Angaben behandelt.
 */
export function baueAntwortAnsicht(
  abschnitte: AnsichtAbschnitt[],
  antworten: Record<string, unknown>,
  art9Zeigen: boolean,
): AntwortAnsicht {
  const bekannt = new Set<string>();
  const bloecke: AnsichtBlock[] = [];

  for (const abschnitt of abschnitte) {
    const zeilen: AnsichtZeile[] = [];
    for (const feld of abschnitt.felder) {
      bekannt.add(feld.code);
      if (feld.typ === "HINWEIS") continue;

      if (istIbanFeld(feld)) {
        zeilen.push({ code: feld.code, label: feld.label, art: "iban" });
      } else if (feld.istArt9 && !art9Zeigen) {
        zeilen.push({ code: feld.code, label: feld.label, art: "art9_verborgen" });
      } else {
        const wert = feld.code in antworten ? formatiereWert(feld.typ as FeldTyp, antworten[feld.code]) : "—";
        zeilen.push({ code: feld.code, label: feld.label, art: "wert", wert });
      }
    }
    if (zeilen.length > 0) bloecke.push({ titel: abschnitt.titel, zeilen });
  }

  const weitere: AnsichtZeile[] = [];
  for (const [code, roh] of Object.entries(antworten)) {
    if (bekannt.has(code)) continue;
    const label = `(${code})`;
    weitere.push(
      art9Zeigen
        ? { code, label, art: "wert", wert: formatiereWert("TEXT", roh) }
        : { code, label, art: "art9_verborgen" },
    );
  }

  return { abschnitte: bloecke, weitere };
}

// -----------------------------------------------------------------------------
// Zwischenstand im öffentlichen Formular
// -----------------------------------------------------------------------------

export type NichtImZwischenstand = {
  /** Abschnitte, die NUR aus Art.-9-Fragen bestehen (Hinweisfelder zählen nicht). */
  art9Abschnitte: string[];
  /** Abschnitte, in denen Art.-9-Fragen neben anderen stehen. */
  gemischteAbschnitte: string[];
  /** Enthält das Formular ein IBAN-Feld? */
  iban: boolean;
  /** Codes aller Felder, die ein Zwischenstand verwirft. */
  codes: string[];
};

/**
 * Welche Angaben „Später weitermachen" NICHT speichert — dieselbe Regel wie
 * `bereinigeEntwurf` in `lib/formular.ts` (Art.-9-Felder und IBAN fallen weg,
 * Hinweisfelder haben keinen Wert). Das Prüfskript hält beide Regeln deckungsgleich.
 */
export function nichtImZwischenstand(abschnitte: AnsichtAbschnitt[]): NichtImZwischenstand {
  const art9Abschnitte: string[] = [];
  const gemischteAbschnitte: string[] = [];
  const codes: string[] = [];
  let iban = false;

  for (const abschnitt of abschnitte) {
    let art9Felder = 0;
    let andereFelder = 0;
    for (const feld of abschnitt.felder) {
      if (feld.typ === "HINWEIS") continue;
      const istIban = istIbanFeld(feld);
      if (istIban) iban = true;
      if (feld.istArt9) art9Felder += 1;
      else andereFelder += 1;
      if (feld.istArt9 || istIban) codes.push(feld.code);
    }
    if (art9Felder === 0) continue;
    const ziel = andereFelder === 0 ? art9Abschnitte : gemischteAbschnitte;
    if (!ziel.includes(abschnitt.titel)) ziel.push(abschnitt.titel);
  }

  return { art9Abschnitte, gemischteAbschnitte, iban, codes };
}

/** Abschnittstitel in Anführungszeichen, verbunden mit Komma und „und". */
export function titelListe(titel: string[]): string {
  const zitiert = titel.map((t) => `„${t}“`);
  if (zitiert.length <= 1) return zitiert.join("");
  return `${zitiert.slice(0, -1).join(", ")} und ${zitiert[zitiert.length - 1]}`;
}

/**
 * Benennt, was ein Zwischenstand nicht enthält — als Satzteil für die Meldungen.
 * `fall` wählt den Kasus: „Nicht gespeichert werden **die Antworten in …**"
 * (Nominativ) bzw. „Ihre Angaben außer **den Antworten in …**" (Dativ).
 * Genannt werden die Abschnittstitel, nicht nur „Glaube und Gemeinde": Dass
 * etwa „Motivation" und „Ziele" dazugehören, erkennt ein Laie sonst nicht.
 * Liefert `null`, wenn das Formular nichts dergleichen enthält.
 */
export function beschreibeNichtImZwischenstand(
  teile: NichtImZwischenstand,
  fall: "nominativ" | "dativ",
): string | null {
  const nom = fall === "nominativ";
  const glieder: string[] = [];

  if (teile.art9Abschnitte.length > 0) {
    glieder.push(`${nom ? "die" : "den"} Antworten in ${titelListe(teile.art9Abschnitte)}`);
  }
  if (teile.gemischteAbschnitte.length > 0) {
    glieder.push(`${nom ? "die" : "den"} Angaben zu Glaube und Gemeinde in ${titelListe(teile.gemischteAbschnitte)}`);
  }
  if (teile.iban) glieder.push(nom ? "die IBAN" : "der IBAN");

  if (glieder.length === 0) return null;
  if (glieder.length === 1) return glieder[0];
  return `${glieder.slice(0, -1).join(", ")} sowie ${glieder[glieder.length - 1]}`;
}

/** Hat jemand in ein Feld etwas eingetragen? Auch „Nein" (false) ist eine Eingabe. */
export function hatEingabe(wert: unknown): boolean {
  if (wert === null || wert === undefined) return false;
  if (typeof wert === "string") return wert.trim() !== "";
  if (Array.isArray(wert)) return wert.length > 0;
  return true;
}

/** Stehen schon Eingaben in Feldern, die ein Zwischenstand verwerfen würde? */
export function hatUngesicherteEingaben(teile: NichtImZwischenstand, antworten: Record<string, unknown>): boolean {
  return teile.codes.some((code) => hatEingabe(antworten[code]));
}
