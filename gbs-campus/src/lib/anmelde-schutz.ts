/**
 * GBS Campus — Schutz des öffentlichen Anmeldeformulars vor Massenanmeldungen
 *
 * `/anmeldung` ist die einzige schreibende Stelle ohne Anmeldung. Jede
 * Einreichung legt eine Akte an, die sich nicht löschen, nur anonymisieren
 * lässt, und schreibt an die eingegebene — womöglich fremde — Adresse sowie an
 * die Verwaltung. Eine Flut automatisierter Anmeldungen hinterließe also
 * Datenmüll und ruinierte den Ruf der Absenderdomain, an der der Anmeldelink
 * hängt (Entscheidung E-ANM-missbrauchsschutz, 27.09.2026).
 *
 * Die Schichten, von außen nach innen (die Route setzt sie in dieser
 * Reihenfolge um):
 *  1. Rumpfgrenze und Schema.
 *  2. Drossel je Anschluss (`ANMELDUNG_MAX_PRO_IP`).
 *  3. Fangfeld — ein unsichtbares Feld, das nur Roboter füllen; verwirft still.
 *  4. Mindestdauer — der Formularstempel unten. Roboter senden im selben
 *     Moment ab, in dem sie die Seite laden; ein Mensch braucht für das
 *     Formular Minuten.
 *  5. Gesamtgrenze über alle Anschlüsse, je Stunde und je Tag. Sie greift auch,
 *     wenn jemand die Anschlussdrossel mit wechselnden Adressen umgeht. Gezählt
 *     werden nur Einreichungen, die tatsächlich angenommen wurden — ein
 *     vergessenes Pflichtfeld verbraucht kein Kontingent.
 *
 * Hier steht nur die Logik ohne Datenbank (geprüft in
 * scripts/pruefe-anmelde-schutz.ts); Zählen und Warnen stehen in
 * `anmelde-schutz-io.ts`.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Schlüssel in `rate_limit` für angenommene Einreichungen. */
export const SCHLUESSEL_EINGANG = "ANMELDUNG_EINGANG";
/** Die Warnung an Schulleitung und Verwaltung geht höchstens einmal pro Stunde raus. */
export const SCHLUESSEL_WARNUNG = "ANMELDUNG_WARNUNG";

/**
 * Zwischenstände („Später weitermachen") dürfen das Dreifache. Sie legen keine
 * Akte an und verschicken keine Mail, belegen aber Zeilen, bis der Aufräumlauf
 * sie nach Ablauf löscht. Gezählt werden neu angelegte Anmeldezeilen, nicht
 * Anfragen ohne Fortsetzen-Token: Ein erfundener oder abgelaufener Token legt
 * ebenfalls eine neue Zeile an und wäre sonst ein Weg an der Grenze vorbei.
 */
export const ENTWURF_FAKTOR = 3;

export type Grenzen = { proStunde: number; proTag: number };
export type Zaehlstand = { letzteStunde: number; letzterTag: number };
export type Fenster = "STUNDE" | "TAG";

/** Welche Grenze erreicht ist — die Stunde zuerst, weil sie früher wieder frei wird. */
export function gesamtgrenzeErreicht(stand: Zaehlstand, grenzen: Grenzen): Fenster | null {
  if (stand.letzteStunde >= grenzen.proStunde) return "STUNDE";
  if (stand.letzterTag >= grenzen.proTag) return "TAG";
  return null;
}

export function entwurfGrenzen(grenzen: Grenzen): Grenzen {
  return { proStunde: grenzen.proStunde * ENTWURF_FAKTOR, proTag: grenzen.proTag * ENTWURF_FAKTOR };
}

// -----------------------------------------------------------------------------
// Formularstempel (Mindestdauer)
// -----------------------------------------------------------------------------

/**
 * Zweck-Präfix der Signatur: Derselbe Schlüssel signiert auch die Sitzungen.
 * Mit eigenem Präfix lässt sich ein Stempel nie als etwas anderes ausgeben
 * und umgekehrt.
 */
const STEMPEL_ZWECK = "gbs-anmeldeformular-v1";

/**
 * Mehr Uhrenversatz als eine Minute gibt es zwischen zwei Anfragen an denselben
 * Server nicht — ein Stempel aus der Zukunft ist nicht vom Server.
 */
const ZUKUNFT_TOLERANZ_MS = 60_000;

function signatur(zeitpunktMs: number, geheimnis: string): string {
  return createHmac("sha256", geheimnis).update(`${STEMPEL_ZWECK}:${zeitpunktMs}`).digest("base64url");
}

/**
 * Der Stempel hält fest, wann der Server das Formular ausgeliefert hat. Er ist
 * signiert, damit ein Roboter keinen älteren Zeitpunkt vortäuschen kann.
 * Er ist bewusst nicht an eine Sitzung gebunden (das Formular ist öffentlich)
 * und nicht einmalig — er soll nur das Absenden im selben Augenblick
 * verhindern; die Mengen begrenzen die anderen Schichten.
 */
export function baueFormularStempel(zeitpunktMs: number, geheimnis: string): string {
  return `${zeitpunktMs}.${signatur(zeitpunktMs, geheimnis)}`;
}

export type StempelGrund = "FEHLT" | "UNGUELTIG" | "ZU_SCHNELL";
export type StempelPruefung = { ok: true } | { ok: false; grund: StempelGrund };

export function pruefeFormularStempel(
  stempel: string | null | undefined,
  jetztMs: number,
  mindestSekunden: number,
  geheimnis: string,
): StempelPruefung {
  if (!stempel) return { ok: false, grund: "FEHLT" };

  const teile = stempel.split(".");
  if (teile.length !== 2 || !/^\d{1,15}$/.test(teile[0])) return { ok: false, grund: "UNGUELTIG" };

  const zeitpunktMs = Number(teile[0]);
  const erwartet = Buffer.from(signatur(zeitpunktMs, geheimnis));
  const erhalten = Buffer.from(teile[1]);
  if (erwartet.length !== erhalten.length || !timingSafeEqual(erwartet, erhalten)) {
    return { ok: false, grund: "UNGUELTIG" };
  }

  const alterMs = jetztMs - zeitpunktMs;
  if (alterMs < -ZUKUNFT_TOLERANZ_MS) return { ok: false, grund: "UNGUELTIG" };
  if (mindestSekunden > 0 && alterMs < mindestSekunden * 1000) return { ok: false, grund: "ZU_SCHNELL" };
  return { ok: true };
}

/**
 * Der Schlüssel für den Stempel ist das Sitzungsgeheimnis — es ist ohnehin
 * Pflicht (der Startprüfer bricht ohne ab), und ein zweites Geheimnis müsste
 * jemand im Notfall-Tresor mitpflegen.
 */
export function stempelGeheimnis(): string {
  const geheim = process.env.SESSION_SECRET;
  if (!geheim || geheim.length < 32) {
    throw new Error("SESSION_SECRET fehlt oder ist zu kurz (mindestens 32 Zeichen).");
  }
  return geheim;
}

// -----------------------------------------------------------------------------
// Meldungen an die Absender
// -----------------------------------------------------------------------------

/**
 * Die Gesamtgrenze trifft im Ernstfall auch echte Bewerber. Die Meldung sagt
 * deshalb, dass nichts verloren ist und wann es wieder geht.
 */
export function gesamtgrenzeMeldung(fenster: Fenster, art: "ABSENDEN" | "ZWISCHENSTAND"): string {
  const wann = fenster === "STUNDE" ? "in einer Stunde" : "morgen";
  if (art === "ZWISCHENSTAND") {
    return (
      "Ihr Zwischenstand konnte gerade nicht gespeichert werden, weil im Moment ungewöhnlich viele " +
      `Anfragen eingehen. Bitte versuchen Sie es ${wann} erneut — Ihre Eingaben bleiben in diesem Fenster stehen.`
    );
  }
  return (
    "Im Moment gehen ungewöhnlich viele Anmeldungen ein, deshalb nimmt das Formular vorübergehend keine " +
    `weiteren an. Bitte senden Sie Ihre Anmeldung ${wann} erneut ab — Ihre Eingaben bleiben in diesem ` +
    "Fenster stehen. Bei Fragen wenden Sie sich bitte direkt an die Bibelschule."
  );
}

export function stempelMeldung(grund: StempelGrund): string {
  if (grund === "ZU_SCHNELL") {
    return (
      "Das Formular wurde schneller abgeschickt, als es sich ausfüllen lässt. Bitte prüfen Sie Ihre " +
      "Angaben und senden Sie die Anmeldung noch einmal ab."
    );
  }
  // FEHLT/UNGUELTIG trifft Menschen praktisch nur, wenn die Seite vor einer
  // neuen Programmversion geladen wurde. Der Zwischenstand braucht keinen
  // Stempel — so geht nichts verloren.
  return (
    "Dieses Formular ist nicht mehr aktuell. Bitte sichern Sie Ihre Eingaben mit „Später weitermachen“, " +
    "laden Sie die Seite neu und senden Sie die Anmeldung dann ab."
  );
}

/** Die Fensterangabe für die Warnung an die Verwaltung, z. B. „10 in der letzten Stunde". */
export function grenzeAlsText(fenster: Fenster, grenzen: Grenzen): string {
  return fenster === "STUNDE"
    ? `${grenzen.proStunde} Anmeldungen in der letzten Stunde`
    : `${grenzen.proTag} Anmeldungen in den letzten 24 Stunden`;
}
