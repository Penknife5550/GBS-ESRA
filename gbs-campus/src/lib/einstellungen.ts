/**
 * GBS Campus — Einstellungen
 *
 * Werte, die der Betrieb ohne Deploy ändern können muss. Sie stehen in der
 * Tabelle `einstellungen`; der Code kennt zu jedem Schlüssel einen
 * Rückfallwert und die zulässigen Grenzen.
 *
 * Zwei Grundsätze:
 *
 *  1. **Eine kaputte Einstellung legt nichts lahm.** Fehlt die Zeile, ist der
 *     Wert unlesbar oder liegt er außerhalb der Grenzen, greift der
 *     Rückfallwert — und es geht eine Warnung ins Log. Die Alternative wäre,
 *     dass ein Tippfehler im Verwaltungsbereich die Anmeldung aller Teilnehmer
 *     blockiert.
 *
 *  2. **Die Grenzen stehen im Code, nicht nur im Formular.** Ein Magic-Link,
 *     der ein Jahr gilt, ist kein Magic-Link mehr, sondern ein dauerhafter
 *     Generalschlüssel im Postfach. Solche Werte dürfen sich auch über die API
 *     nicht setzen lassen.
 */

import { EinstellungTyp } from "@prisma/client";
import { prisma } from "@/lib/db";

type ZahlDefinition = {
  bezeichnung: string;
  beschreibung: string;
  bereich: string;
  typ: typeof EinstellungTyp.ZAHL;
  standard: number;
  minimum: number;
  maximum: number;
  einheit: string;
  sortierung: number;
};

export const EINSTELLUNGEN = {
  AUTH_MAGIC_LINK_GUELTIG_MINUTEN: {
    bezeichnung: "Gültigkeit des Anmeldelinks",
    beschreibung:
      "Wie lange ein per E-Mail verschickter Anmeldelink benutzbar bleibt. Kürzer ist sicherer; " +
      "zu kurz führt dazu, dass der Link abgelaufen ist, bevor jemand sein Postfach geöffnet hat. " +
      "Der Link ist unabhängig davon immer nur einmal verwendbar.",
    bereich: "AUTH",
    typ: EinstellungTyp.ZAHL,
    standard: 30,
    minimum: 5,
    maximum: 1440, // 24 Stunden — darüber ist es kein Anmeldelink mehr, sondern ein Dauerschlüssel
    einheit: "Minuten",
    sortierung: 10,
  },
  AUTH_MAGIC_LINK_MAX_PRO_ADRESSE: {
    bezeichnung: "Anmeldelinks je E-Mail-Adresse",
    beschreibung: "Wie viele Anmeldelinks eine Adresse im Drosselfenster anfordern darf.",
    bereich: "AUTH",
    typ: EinstellungTyp.ZAHL,
    standard: 5,
    minimum: 1,
    maximum: 50,
    einheit: "Anfragen",
    sortierung: 20,
  },
  AUTH_MAGIC_LINK_MAX_PRO_IP: {
    bezeichnung: "Anmeldelinks je Internetanschluss",
    beschreibung:
      "Gleiche Drossel, aber je Anschluss. Höher als der Wert je Adresse, weil sich eine ganze " +
      "Gemeinde einen Anschluss teilen kann.",
    bereich: "AUTH",
    typ: EinstellungTyp.ZAHL,
    standard: 20,
    minimum: 1,
    maximum: 500,
    einheit: "Anfragen",
    sortierung: 30,
  },
  AUTH_DROSSEL_FENSTER_MINUTEN: {
    bezeichnung: "Zeitfenster der Drosselung",
    beschreibung: "Über welchen Zeitraum die beiden Obergrenzen gezählt werden.",
    bereich: "AUTH",
    typ: EinstellungTyp.ZAHL,
    standard: 60,
    minimum: 5,
    maximum: 1440,
    einheit: "Minuten",
    sortierung: 40,
  },
  AUTH_SITZUNG_STUNDEN: {
    bezeichnung: "Dauer einer Sitzung",
    beschreibung: "Wie lange jemand nach dem Anmelden angemeldet bleibt, bevor er einen neuen Link braucht.",
    bereich: "AUTH",
    typ: EinstellungTyp.ZAHL,
    standard: 12,
    minimum: 1,
    maximum: 720, // 30 Tage
    einheit: "Stunden",
    sortierung: 50,
  },
  AUTH_PASSWORT_MAX_VERSUCHE: {
    bezeichnung: "Passwortversuche je E-Mail-Adresse",
    beschreibung:
      "Wie oft im Drosselfenster mit Passwort angemeldet werden darf. Eigener Wert und nicht der des " +
      "Anmeldelinks: Wer die Linkgrenze senkt, soll nicht unbemerkt auch das Passwort-Login zudrehen. " +
      "Erfolgreiche Anmeldungen zählen nicht mit.",
    bereich: "AUTH",
    typ: EinstellungTyp.ZAHL,
    standard: 10,
    minimum: 3,
    maximum: 50,
    einheit: "Versuche",
    sortierung: 65,
  },
  AUTH_EMAIL_AENDERUNG_MAX: {
    bezeichnung: "Anträge auf eine neue E-Mail-Adresse",
    beschreibung:
      "Wie viele Adressänderungen eine Person im Drosselfenster beantragen darf. Jeder Antrag " +
      "verschickt eine Mail an eine frei gewählte Adresse — deshalb überhaupt eine Grenze.",
    bereich: "AUTH",
    typ: EinstellungTyp.ZAHL,
    standard: 5,
    minimum: 1,
    maximum: 20,
    einheit: "Anträge",
    sortierung: 68,
  },
  ZUGANG_HILFE_MAX_PRO_IP: {
    bezeichnung: "Meldungen „Ich komme nicht rein\" je Anschluss",
    beschreibung:
      "Grenze für das öffentliche Hilfeformular. Jede Meldung erzeugt Mails an Schulleitung und " +
      "Verwaltung — ohne Grenze ließe sich damit der Zustellruf der Absenderdomain ruinieren.",
    bereich: "ANMELDUNG",
    typ: EinstellungTyp.ZAHL,
    standard: 5,
    minimum: 1,
    maximum: 50,
    einheit: "Meldungen",
    sortierung: 30,
  },
  ZUGANG_HILFE_MAX_GESAMT: {
    bezeichnung: "Meldungen „Ich komme nicht rein\" insgesamt",
    beschreibung:
      "Obergrenze über alle Anschlüsse hinweg im selben Zeitfenster. Fängt den Fall ab, dass jemand " +
      "die Anschlussgrenze durch wechselnde Adressen umgeht.",
    bereich: "ANMELDUNG",
    typ: EinstellungTyp.ZAHL,
    standard: 20,
    minimum: 1,
    maximum: 200,
    einheit: "Meldungen",
    sortierung: 40,
  },
  AUFRAEUMEN_DROSSEL_TAGE: {
    bezeichnung: "Aufbewahrung der Drosselzeilen",
    beschreibung: "Wie lange Zeilen in `rate_limit` stehen bleiben, bevor der Aufräumlauf sie entfernt.",
    bereich: "BETRIEB",
    typ: EinstellungTyp.ZAHL,
    standard: 1,
    minimum: 1,
    maximum: 30,
    einheit: "Tage",
    sortierung: 10,
  },
  AUFRAEUMEN_TOKEN_TAGE: {
    bezeichnung: "Aufbewahrung benutzter Anmelde- und Bestätigungslinks",
    beschreibung:
      "Wie lange abgelaufene Anmeldelinks und Anträge auf eine neue E-Mail-Adresse für die " +
      "Nachvollziehbarkeit aufbewahrt werden. Art. 5 Abs. 1 lit. e DSGVO verlangt, sie nicht länger " +
      "als nötig zu speichern — deshalb ist das ein Regler und keine Konstante im Code.",
    bereich: "BETRIEB",
    typ: EinstellungTyp.ZAHL,
    standard: 7,
    minimum: 1,
    maximum: 90,
    einheit: "Tage",
    sortierung: 20,
  },
  AUTH_EMAIL_AENDERUNG_GUELTIG_STUNDEN: {
    bezeichnung: "Gültigkeit des Bestätigungslinks für eine neue E-Mail-Adresse",
    beschreibung:
      "Wie lange der Link gilt, mit dem eine geänderte E-Mail-Adresse bestätigt wird. Länger als " +
      "der Anmeldelink, weil die neue Adresse erst eingerichtet oder abgerufen werden muss — aber " +
      "nicht beliebig lang: Bis zur Bestätigung gilt weiterhin die alte Adresse.",
    bereich: "AUTH",
    typ: EinstellungTyp.ZAHL,
    standard: 24,
    minimum: 1,
    maximum: 168, // eine Woche
    einheit: "Stunden",
    sortierung: 60,
  },
  AUTH_PASSWORT_MIN_LAENGE: {
    bezeichnung: "Mindestlänge des Passworts",
    beschreibung:
      "Das Passwort ist der zweite Anmeldeweg neben dem Anmeldelink und freiwillig. Bewusst nur eine " +
      "Längenvorgabe und keine Regeln über Sonderzeichen: Die führen zu „Passwort1!\" und zu Zetteln " +
      "am Bildschirm. Ein ganzer Satz ist leichter zu merken und deutlich sicherer.",
    bereich: "AUTH",
    typ: EinstellungTyp.ZAHL,
    standard: 10,
    minimum: 8,
    maximum: 64,
    einheit: "Zeichen",
    sortierung: 70,
  },
  ANMELDUNG_MAX_PRO_IP: {
    bezeichnung: "Anmeldungen je Internetanschluss",
    beschreibung:
      "Wie viele Anmeldungen im Drosselfenster von einem Anschluss abgeschickt werden dürfen. " +
      "Schützt das öffentliche Formular vor automatisiertem Missbrauch. Nicht zu niedrig setzen: " +
      "Ehepaare melden sich nacheinander vom selben Anschluss an.",
    bereich: "ANMELDUNG",
    typ: EinstellungTyp.ZAHL,
    standard: 10,
    minimum: 1,
    maximum: 200,
    einheit: "Anmeldungen",
    sortierung: 20,
  },
  ANMELDUNG_FORTSETZEN_TAGE: {
    bezeichnung: "Anmeldung fortsetzen",
    beschreibung:
      "Wie lange eine begonnene, noch nicht abgeschickte Anmeldung über den Fortsetzen-Link " +
      "wieder aufgerufen werden kann.",
    bereich: "ANMELDUNG",
    typ: EinstellungTyp.ZAHL,
    standard: 14,
    minimum: 1,
    maximum: 90,
    einheit: "Tage",
    sortierung: 10,
  },
  // Semesterüberleitung (Re-Enrollment): Wann vor Semesterstart die drei
  // Erinnerungen an noch nicht bestätigte Teilnehmer rausgehen. Als Regler, weil
  // der Betrieb den Rhythmus ohne Deploy anpassen können muss. Der
  // Bestätigungslink selbst gilt bis zum Semesterstart und braucht keinen
  // eigenen Regler.
  SEMESTER_ERINNERUNG_1_TAGE: {
    bezeichnung: "1. Erinnerung vor Semesterstart",
    beschreibung:
      "Tage vor Semesterstart, an denen die erste Erinnerung an noch nicht bestätigte Teilnehmer geht.",
    bereich: "SEMESTER",
    typ: EinstellungTyp.ZAHL,
    standard: 14,
    minimum: 1,
    maximum: 90,
    einheit: "Tage",
    sortierung: 10,
  },
  SEMESTER_ERINNERUNG_2_TAGE: {
    bezeichnung: "2. Erinnerung vor Semesterstart",
    beschreibung: "Tage vor Semesterstart für die zweite Erinnerung.",
    bereich: "SEMESTER",
    typ: EinstellungTyp.ZAHL,
    standard: 7,
    minimum: 1,
    maximum: 90,
    einheit: "Tage",
    sortierung: 20,
  },
  SEMESTER_ERINNERUNG_3_TAGE: {
    bezeichnung: "3. Erinnerung vor Semesterstart",
    beschreibung: "Tage vor Semesterstart für die letzte Erinnerung.",
    bereich: "SEMESTER",
    typ: EinstellungTyp.ZAHL,
    standard: 3,
    minimum: 1,
    maximum: 90,
    einheit: "Tage",
    sortierung: 30,
  },
  ANWESENHEIT_MINDEST_PROZENT: {
    bezeichnung: "Mindest-Anwesenheit",
    beschreibung:
      "Wie viel Prozent der Unterrichtstermine ein Teilnehmer besuchen muss. Nachgearbeiteter " +
      "Unterricht zählt wie eine Teilnahme. Unter dieser Schwelle wird die Quote im Stundenplan " +
      "markiert.",
    bereich: "SEMESTER",
    typ: EinstellungTyp.ZAHL,
    standard: 80,
    minimum: 0,
    maximum: 100,
    einheit: "%",
    sortierung: 40,
  },
  // Die vier Beträge stehen bewusst als Regler und nicht als Konstante im Code:
  // Preise ändern sich, und der künftige Beitragslauf soll sie hier finden statt
  // in einer Codezeile. Eingezogen wird bisher nichts — die Werte spiegeln den
  // Hinweistext des Bewerbungsformulars. Die Beschreibungen stehen in
  // /verwaltung/einstellungen, deshalb dort keine Releasenummern (Code-Review 4).
  // Kurz halten: scripts/pruefe-beitrag.ts sucht den Standardwert höchstens 300
  // Zeichen hinter dem Schlüssel.
  BEITRAG_REGULAER_MONATLICH: {
    bezeichnung: "Beitrag monatlich (regulär)",
    beschreibung: "Monatlicher Semesterbeitrag ohne Ermäßigung. Wird derzeit nicht eingezogen.",
    bereich: "BEITRAG",
    typ: EinstellungTyp.ZAHL,
    standard: 20,
    minimum: 0,
    maximum: 100000,
    einheit: "€",
    sortierung: 10,
  },
  BEITRAG_REGULAER_HALBJAEHRLICH: {
    bezeichnung: "Beitrag halbjährlich (regulär)",
    beschreibung: "Halbjährlicher Semesterbeitrag ohne Ermäßigung. Wird derzeit nicht eingezogen.",
    bereich: "BEITRAG",
    typ: EinstellungTyp.ZAHL,
    standard: 120,
    minimum: 0,
    maximum: 100000,
    einheit: "€",
    sortierung: 20,
  },
  BEITRAG_EHEPARTNER_MONATLICH: {
    bezeichnung: "Beitrag monatlich (mit Ehepartner)",
    beschreibung:
      "Monatlicher Beitrag bei gemeinsamer Anmeldung mit dem Ehepartner (zweiter Partner 50 %). " +
      "Wird derzeit nicht eingezogen.",
    bereich: "BEITRAG",
    typ: EinstellungTyp.ZAHL,
    standard: 30,
    minimum: 0,
    maximum: 100000,
    einheit: "€",
    sortierung: 30,
  },
  BEITRAG_EHEPARTNER_HALBJAEHRLICH: {
    bezeichnung: "Beitrag halbjährlich (mit Ehepartner)",
    beschreibung:
      "Halbjährlicher Beitrag bei gemeinsamer Anmeldung mit dem Ehepartner (zweiter Partner 50 %). " +
      "Wird derzeit nicht eingezogen.",
    bereich: "BEITRAG",
    typ: EinstellungTyp.ZAHL,
    standard: 180,
    minimum: 0,
    maximum: 100000,
    einheit: "€",
    sortierung: 40,
  },
  // Der Dozentenhonorarsatz war bis Release 0.2 ein einzelner Regler hier. Ab 0.3
  // führt er eine Genehmigungs-Historie mit Gültig-ab-Datum (Modell HonorarSatz,
  // Verwaltung unter /verwaltung/honorar/saetze) — ein einzelner editierbarer
  // Wert würde vergangene Abende rückwirkend neu bewerten. Der Rückfallwert für
  // eine leere Historie steht als Konstante HONORAR_SATZ_FALLBACK in honorar.ts.
} as const satisfies Record<string, ZahlDefinition>;

export type EinstellungSchluessel = keyof typeof EINSTELLUNGEN;

/**
 * Ob ein Schlüssel von außen (API, Formular) eine der hier definierten
 * Einstellungen ist.
 *
 * `Object.hasOwn` statt `in`: `in` folgt der Prototypkette, und
 * `"constructor" in EINSTELLUNGEN` ist wahr. `setzeZahl` bekam dann die
 * Object-Funktion als Definition — ohne Grenzen und ohne Bezeichnung —, und der
 * upsert endete in einem 500 statt in einem 404 (Code-Review 4).
 */
export function istEinstellungSchluessel(schluessel: string): schluessel is EinstellungSchluessel {
  return Object.hasOwn(EINSTELLUNGEN, schluessel);
}

/**
 * Liest einen Zahlenwert. Fällt bei jedem Problem auf den Standard zurück.
 * Ein einzelner Primärschlüssel-Zugriff — bei dieser Nutzerzahl ist ein Cache
 * unnötige Komplexität.
 */
export async function zahl(schluessel: EinstellungSchluessel): Promise<number> {
  const definition = EINSTELLUNGEN[schluessel];

  let eintrag;
  try {
    eintrag = await prisma.einstellung.findUnique({ where: { schluessel } });
  } catch (fehler) {
    console.error(`[EINSTELLUNG] ${schluessel} nicht lesbar, nutze Standard ${definition.standard}.`, fehler);
    return definition.standard;
  }

  if (!eintrag) return definition.standard;

  const wert = Number(eintrag.wert);
  if (!Number.isFinite(wert) || !Number.isInteger(wert)) {
    console.warn(`[EINSTELLUNG] ${schluessel} ist keine ganze Zahl ("${eintrag.wert}"), nutze Standard.`);
    return definition.standard;
  }
  if (wert < definition.minimum || wert > definition.maximum) {
    console.warn(
      `[EINSTELLUNG] ${schluessel} = ${wert} liegt außerhalb von ${definition.minimum}–${definition.maximum}, nutze Standard.`,
    );
    return definition.standard;
  }

  return wert;
}

export type SetzErgebnis = { ok: true } | { ok: false; meldung: string };

/**
 * Setzt einen Zahlenwert nach Prüfung gegen die im Code hinterlegten Grenzen.
 * Diese Prüfung ist die eigentliche Absicherung — das Formular kann sie nicht
 * ersetzen.
 */
export async function setzeZahl(schluessel: EinstellungSchluessel, wert: number): Promise<SetzErgebnis> {
  const definition = EINSTELLUNGEN[schluessel];

  if (!Number.isInteger(wert)) {
    return { ok: false, meldung: "Bitte eine ganze Zahl angeben." };
  }
  if (wert < definition.minimum || wert > definition.maximum) {
    return {
      ok: false,
      meldung: `Der Wert muss zwischen ${definition.minimum} und ${definition.maximum} ${definition.einheit} liegen.`,
    };
  }

  // `upsert` statt `update`: Kommt ein neuer Schlüssel mit einem Deploy dazu und
  // der Seed lief noch nicht, gäbe es sonst einen unbehandelten P2025 — also
  // einen 500 ohne Erklärung, obwohl `zahl()` für denselben Fall sauber auf den
  // Standard zurückfällt.
  await prisma.einstellung.upsert({
    where: { schluessel },
    update: { wert: String(wert) },
    create: {
      schluessel,
      wert: String(wert),
      bezeichnung: definition.bezeichnung,
      beschreibung: definition.beschreibung,
      bereich: definition.bereich,
      typ: definition.typ,
      minimum: definition.minimum,
      maximum: definition.maximum,
      einheit: definition.einheit,
      sortierung: definition.sortierung,
    },
  });
  return { ok: true };
}
