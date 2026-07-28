/**
 * GBS Campus — Formular-Builder: Regeln und Prüfungen
 *
 * Zwei Dinge macht dieses Modul, und beide gehören zwingend auf den Server:
 *
 *  1. Versionsregeln. Eine veröffentlichte Fassung ist unveränderlich. Wer sie
 *     bearbeiten will, bekommt eine Kopie als neuen Entwurf. Ohne diese Regel
 *     ließe sich nachträglich ändern, welche Frage jemand beantwortet hat — und
 *     damit wäre auch das Consent-Protokoll wertlos.
 *
 *  2. Antwortprüfung. Was der Browser schickt, ist Behauptung. Pflichtfelder,
 *     Feldtypen, erlaubte Auswahlwerte und die Art.-9-Sperre werden hier erneut
 *     geprüft, unabhängig von jeder Prüfung im Formular selbst.
 */

import { FeldTyp, FormularVersionStatus, PersonFeld, Prisma, Teilnahmeform } from "@prisma/client";
import { prisma } from "@/lib/db";
import { istIbanGueltig } from "@/lib/pruefwerte";

// -----------------------------------------------------------------------------
// Typen
// -----------------------------------------------------------------------------

export type FeldEingabe = {
  code: string;
  typ: FeldTyp;
  label: string;
  hilfetext?: string | null;
  platzhalter?: string | null;
  pflicht: boolean;
  reihenfolge: number;
  optionen?: string[] | null;
  personFeld: PersonFeld;
  istArt9: boolean;
  /**
   * Nur bei personFeld = TEILNAHMEFORM: welche Antwortmoeglichkeit zu welcher
   * Teilnahmeform fuehrt. Liegt in FormularFeld.validierung.
   */
  teilnahmeformZuordnung?: Record<string, Teilnahmeform> | null;
};

export type Antwortwert = string | string[] | boolean | number | null;

export type PruefFehler = { feldCode: string; meldung: string };

export type PruefErgebnis =
  | { ok: true; werte: Record<string, Antwortwert>; personDaten: PersonUebernahme }
  | { ok: false; fehler: PruefFehler[] };

/** Werte, die aus den Antworten in die Schülerakte übernommen werden. */
export type PersonUebernahme = {
  vorname?: string;
  nachname?: string;
  email?: string;
  telefon?: string;
  geburtsdatum?: Date;
  strasse?: string;
  plz?: string;
  ort?: string;
  gemeinde?: string;
  kontoinhaber?: string;
  /** Klartext — der Aufrufer verschlüsselt vor dem Speichern. */
  iban?: string;
  teilnahmeform?: Teilnahmeform;
};

const FELD_MIT_OPTIONEN: FeldTyp[] = [FeldTyp.AUSWAHL_EINFACH, FeldTyp.AUSWAHL_MEHRFACH];

/** Obergrenze für Freitextantworten. Verhindert, dass ein Feld beliebig viel Speicher bindet. */
export const MAX_TEXT_LAENGE = 5000;

/** Plausibler Bereich für Datumsangaben — verhindert Tippfehler wie 2090 oder 1000. */
const DATUM_MIN_JAHR = 1900;
const DATUM_MAX_JAHR = new Date().getFullYear() + 10;

// -----------------------------------------------------------------------------
// Prüfung der Formulardefinition (beim Speichern im Builder)
// -----------------------------------------------------------------------------

/**
 * Prüft, ob eine Feldliste in sich stimmig ist. Das verhindert Formulare, die
 * sich zwar anlegen, aber nicht sinnvoll ausfüllen lassen.
 */
export function pruefeFelddefinition(felder: FeldEingabe[]): PruefFehler[] {
  const fehler: PruefFehler[] = [];
  const gesehen = new Set<string>();
  const belegteZuordnungen = new Map<PersonFeld, string>();

  for (const feld of felder) {
    if (!/^[a-z][a-z0-9_]{1,49}$/.test(feld.code)) {
      fehler.push({
        feldCode: feld.code,
        meldung:
          "Der Feldschlüssel darf nur Kleinbuchstaben, Ziffern und Unterstriche enthalten und muss mit einem Buchstaben beginnen.",
      });
    }
    if (gesehen.has(feld.code)) {
      fehler.push({ feldCode: feld.code, meldung: "Dieser Feldschlüssel kommt mehrfach vor." });
    }
    gesehen.add(feld.code);

    if (!feld.label.trim()) {
      fehler.push({ feldCode: feld.code, meldung: "Das Feld braucht eine Beschriftung." });
    }

    if (FELD_MIT_OPTIONEN.includes(feld.typ)) {
      const optionen = feld.optionen ?? [];
      if (optionen.length < 2) {
        fehler.push({ feldCode: feld.code, meldung: "Ein Auswahlfeld braucht mindestens zwei Antwortmöglichkeiten." });
      }
      if (new Set(optionen).size !== optionen.length) {
        fehler.push({ feldCode: feld.code, meldung: "Die Antwortmöglichkeiten müssen sich unterscheiden." });
      }
    }

    if (feld.typ === FeldTyp.HINWEIS) {
      if (feld.pflicht) {
        fehler.push({ feldCode: feld.code, meldung: "Ein Hinweistext kann kein Pflichtfeld sein." });
      }
      if (feld.personFeld !== PersonFeld.NICHTS) {
        fehler.push({ feldCode: feld.code, meldung: "Ein Hinweistext kann nicht in die Akte übernommen werden." });
      }
    }

    // Jedes Aktenfeld darf nur von einem einzigen Formularfeld befüllt werden —
    // sonst überschreiben sich zwei Antworten gegenseitig, und welche gewinnt,
    // wäre reine Reihenfolge.
    if (feld.personFeld !== PersonFeld.NICHTS) {
      const bereitsBelegt = belegteZuordnungen.get(feld.personFeld);
      if (bereitsBelegt) {
        fehler.push({
          feldCode: feld.code,
          meldung: `Das Aktenfeld ist bereits dem Feld „${bereitsBelegt}“ zugeordnet.`,
        });
      } else {
        belegteZuordnungen.set(feld.personFeld, feld.code);
      }

      const erwarteterTyp = TYP_FUER_PERSONFELD[feld.personFeld];
      if (erwarteterTyp && !erwarteterTyp.includes(feld.typ)) {
        fehler.push({
          feldCode: feld.code,
          meldung: "Der Feldtyp passt nicht zum zugeordneten Aktenfeld.",
        });
      }

      // Die Teilnahmeform wurde frueher aus dem Optionstext geraten
      // (Suche nach "hoerer"/"gast"). Das lag bei plausiblen Beschriftungen
      // falsch — "Gast-Schueler mit Pruefung" ergab Hoerer — und der Schulleiter
      // sah nirgends, welche Zuordnung seine Beschriftung erzeugt. Daran haengen
      // Pruefungspflicht, Zeugnis und ab Release 0.3 der Beitrag. Deshalb muss
      // die Zuordnung jetzt ausdruecklich je Antwortmoeglichkeit angegeben werden.
      if (feld.personFeld === PersonFeld.TEILNAHMEFORM) {
        const zuordnung = feld.teilnahmeformZuordnung ?? {};
        const ohneZuordnung = (feld.optionen ?? []).filter((o) => !zuordnung[o]);
        if (ohneZuordnung.length > 0) {
          fehler.push({
            feldCode: feld.code,
            meldung: `Für diese Antwortmöglichkeiten fehlt die Angabe, ob sie Schüler oder Hörer bedeuten: ${ohneZuordnung.join(", ")}.`,
          });
        }
      }
    }
  }

  return fehler;
}

const TYP_FUER_PERSONFELD: Partial<Record<PersonFeld, FeldTyp[]>> = {
  [PersonFeld.VORNAME]: [FeldTyp.TEXT],
  [PersonFeld.NACHNAME]: [FeldTyp.TEXT],
  [PersonFeld.EMAIL]: [FeldTyp.EMAIL],
  [PersonFeld.TELEFON]: [FeldTyp.TELEFON, FeldTyp.TEXT],
  [PersonFeld.GEBURTSDATUM]: [FeldTyp.DATUM],
  [PersonFeld.STRASSE]: [FeldTyp.TEXT],
  // NICHT FeldTyp.ZAHL: "01067" (Dresden) wuerde zu 1067 — Adressen in ganz
  // Ostdeutschland waeren still verfaelscht, und der Datensatz saehe plausibel aus.
  [PersonFeld.PLZ]: [FeldTyp.TEXT],
  [PersonFeld.ORT]: [FeldTyp.TEXT],
  [PersonFeld.GEMEINDE]: [FeldTyp.TEXT, FeldTyp.AUSWAHL_EINFACH],
  [PersonFeld.IBAN]: [FeldTyp.IBAN],
  [PersonFeld.KONTOINHABER]: [FeldTyp.TEXT],
  [PersonFeld.TEILNAHMEFORM]: [FeldTyp.AUSWAHL_EINFACH],
};

/**
 * Ein Formular ist erst veröffentlichungsreif, wenn es die Angaben enthält, ohne
 * die keine Akte entstehen kann. Ohne E-Mail-Adresse gibt es keinen Magic-Link
 * und damit keinen Zugang.
 */
export function pruefeVeroeffentlichung(felder: FeldEingabe[]): string[] {
  const fehler: string[] = [];
  const zuordnungen = new Set(felder.map((f) => f.personFeld));

  const noetig: [PersonFeld, string][] = [
    [PersonFeld.VORNAME, "Vorname"],
    [PersonFeld.NACHNAME, "Nachname"],
    [PersonFeld.EMAIL, "E-Mail-Adresse"],
  ];
  for (const [feld, name] of noetig) {
    if (!zuordnungen.has(feld)) {
      fehler.push(`Es fehlt ein Feld, das dem Aktenfeld „${name}“ zugeordnet ist.`);
    }
  }

  const pflichtfehlt = felder.filter(
    (f) => noetig.some(([pf]) => pf === f.personFeld) && !f.pflicht,
  );
  for (const feld of pflichtfehlt) {
    fehler.push(`Das Feld „${feld.label}“ muss ein Pflichtfeld sein.`);
  }

  if (felder.filter((f) => f.typ !== FeldTyp.HINWEIS).length === 0) {
    fehler.push("Das Formular enthält keine einzige Frage.");
  }

  return fehler;
}

// -----------------------------------------------------------------------------
// Prüfung der Antworten (beim Absenden des Formulars)
// -----------------------------------------------------------------------------

/**
 * Prüft eingereichte Antworten gegen die Felddefinition einer Version.
 *
 * @param art9Eingewilligt Liegt die getrennte Einwilligung nach Art. 9 DSGVO
 *   vor? Ohne sie werden als Art.-9 gekennzeichnete Felder nicht gespeichert —
 *   auch dann nicht, wenn der Browser Werte mitschickt.
 */
export function pruefeAntworten(
  felder: FeldEingabe[],
  eingabe: Record<string, unknown>,
  art9Eingewilligt: boolean,
): PruefErgebnis {
  const fehler: PruefFehler[] = [];
  const werte: Record<string, Antwortwert> = {};
  const personDaten: PersonUebernahme = {};

  for (const feld of felder) {
    if (feld.typ === FeldTyp.HINWEIS) continue;

    // Art.-9-Sperre: ohne Einwilligung wird der Wert verworfen, nicht gespeichert.
    if (feld.istArt9 && !art9Eingewilligt) {
      werte[feld.code] = null;
      continue;
    }

    const roh = eingabe[feld.code];
    const ergebnis = pruefeFeld(feld, roh);

    if ("fehler" in ergebnis) {
      fehler.push({ feldCode: feld.code, meldung: ergebnis.fehler });
      continue;
    }

    werte[feld.code] = ergebnis.wert;
    if (ergebnis.wert !== null) {
      uebernehmeInAkte(feld, ergebnis.wert, personDaten);
    }
  }

  if (fehler.length > 0) return { ok: false, fehler };
  return { ok: true, werte, personDaten };
}

function pruefeFeld(feld: FeldEingabe, roh: unknown): { wert: Antwortwert } | { fehler: string } {
  const leer =
    roh === undefined ||
    roh === null ||
    (typeof roh === "string" && roh.trim() === "") ||
    (Array.isArray(roh) && roh.length === 0);

  if (leer) {
    if (feld.pflicht) return { fehler: "Dieses Feld ist ein Pflichtfeld." };
    return { wert: null };
  }

  switch (feld.typ) {
    case FeldTyp.TEXT:
    case FeldTyp.MEHRZEILIG: {
      const text = String(roh).trim();
      if (text.length > MAX_TEXT_LAENGE) return { fehler: "Die Eingabe ist zu lang." };
      return { wert: text };
    }

    case FeldTyp.EMAIL: {
      const text = String(roh).trim().toLowerCase();
      // Bewusst großzügig: strenge Muster schließen gültige Adressen aus.
      // Was wirklich zählt, ist die Zustellbarkeit des Magic-Links.
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text)) {
        return { fehler: "Bitte eine gültige E-Mail-Adresse angeben." };
      }
      return { wert: text };
    }

    case FeldTyp.TELEFON: {
      const text = String(roh).trim();
      if (!/^[0-9+\-\s()/]{5,30}$/.test(text)) {
        return { fehler: "Bitte eine gültige Telefonnummer angeben." };
      }
      return { wert: text };
    }

    case FeldTyp.DATUM: {
      const text = String(roh).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return { fehler: "Bitte ein Datum im Format JJJJ-MM-TT angeben." };
      }
      const datum = new Date(`${text}T00:00:00.000Z`);
      if (Number.isNaN(datum.getTime())) return { fehler: "Das Datum ist ungültig." };
      // Gegenprobe, damit der 31.02. nicht stillschweigend zum 03.03. wird.
      if (datum.toISOString().slice(0, 10) !== text) return { fehler: "Dieses Datum gibt es nicht." };
      // Plausibilitaet: ein Geburtsjahr 2090 oder 1000 ist ein Tippfehler, kein Datum.
      const jahr = datum.getUTCFullYear();
      if (jahr < DATUM_MIN_JAHR || jahr > DATUM_MAX_JAHR) {
        return { fehler: `Bitte ein Jahr zwischen ${DATUM_MIN_JAHR} und ${DATUM_MAX_JAHR} angeben.` };
      }
      return { wert: text };
    }

    case FeldTyp.ZAHL: {
      const zahl = Number(roh);
      if (!Number.isFinite(zahl)) return { fehler: "Bitte eine Zahl angeben." };
      return { wert: zahl };
    }

    case FeldTyp.JA_NEIN: {
      if (typeof roh === "boolean") return { wert: roh };
      if (roh === "true" || roh === "ja") return { wert: true };
      if (roh === "false" || roh === "nein") return { wert: false };
      return { fehler: "Bitte Ja oder Nein wählen." };
    }

    case FeldTyp.AUSWAHL_EINFACH: {
      const text = String(roh);
      if (!(feld.optionen ?? []).includes(text)) {
        return { fehler: "Bitte eine der angebotenen Antworten wählen." };
      }
      return { wert: text };
    }

    case FeldTyp.AUSWAHL_MEHRFACH: {
      const liste = Array.isArray(roh) ? roh.map(String) : [String(roh)];
      const erlaubt = feld.optionen ?? [];
      if (liste.some((eintrag) => !erlaubt.includes(eintrag))) {
        return { fehler: "Bitte nur aus den angebotenen Antworten wählen." };
      }
      if (new Set(liste).size !== liste.length) {
        return { fehler: "Eine Antwort wurde mehrfach übermittelt." };
      }
      return { wert: liste };
    }

    case FeldTyp.IBAN: {
      const text = String(roh).replace(/\s+/g, "").toUpperCase();
      if (!istIbanGueltig(text)) return { fehler: "Diese IBAN ist nicht gültig." };
      return { wert: text };
    }

    default:
      return { fehler: "Unbekannter Feldtyp." };
  }
}

// -----------------------------------------------------------------------------
// Was niemals im Klartext in den Antworten landen darf
// -----------------------------------------------------------------------------

/**
 * Feldcodes, deren Antwort nicht in `anmeldungen.antworten` gespeichert werden
 * darf.
 *
 * Betrifft die IBAN: Sie wird an der Person AES-256-GCM-verschlüsselt abgelegt.
 * Stünde sie zusätzlich im Klartext im Antwort-JSON, wäre die Verschlüsselung
 * wertlos — beide liegen in derselben Datenbank und in demselben `pg_dump`.
 * Genau das war vor dem Review der Fall.
 */
export function geheimeFeldcodes(felder: FeldEingabe[]): Set<string> {
  // Am Feldtyp UND am Aktenfeld: Ein IBAN-Feld ist auch dann geheim, wenn es (versehentlich) nicht
  // der Akte zugeordnet ist. Sonst hinge der Klartextschutz allein an der personFeld-Zuordnung, und
  // eine IBAN ohne personFeld=IBAN läge unverschlüsselt im Antwort-JSON.
  return new Set(
    felder.filter((f) => f.typ === FeldTyp.IBAN || f.personFeld === PersonFeld.IBAN).map((f) => f.code),
  );
}

/** Entfernt die Antworten zu den genannten Feldern aus einem Antwortobjekt. */
export function ohneGeheimeAntworten(
  werte: Record<string, Antwortwert>,
  geheim: Set<string>,
): Record<string, Antwortwert> {
  const ergebnis: Record<string, Antwortwert> = {};
  for (const [code, wert] of Object.entries(werte)) {
    if (!geheim.has(code)) ergebnis[code] = wert;
  }
  return ergebnis;
}

/**
 * Bereinigt einen Zwischenstand, bevor er gespeichert wird.
 *
 * Ein Entwurf entsteht auf dem öffentlichen Endpunkt, ohne Anmeldung und **ohne
 * Einwilligungsnachweis**. Deshalb gilt hier strenger als beim Absenden:
 *
 *  - Unbekannte Schlüssel werden verworfen. Sonst ließe sich über den
 *    öffentlichen Endpunkt beliebiges Fremd-JSON in der Datenbank ablegen.
 *  - Als Art. 9 gekennzeichnete Felder werden verworfen. Zu diesem Zeitpunkt
 *    liegt keine Einwilligung vor, und ohne sie dürfen Angaben zu Glaube oder
 *    Gemeindezugehörigkeit nicht gespeichert werden — auch nicht
 *    zwischengespeichert. (Vor dem Review kamen sie hier ungefiltert durch.)
 *  - Die IBAN wird verworfen, aus demselben Grund wie beim Absenden.
 *  - Texte werden gekürzt, damit ein Entwurf keine beliebige Datenmenge trägt.
 *
 * Pflichtfelder werden bewusst NICHT erzwungen — ein Zwischenstand darf
 * unvollständig sein.
 */
export function bereinigeEntwurf(
  felder: FeldEingabe[],
  eingabe: Record<string, unknown>,
): Record<string, Antwortwert> {
  const geheim = geheimeFeldcodes(felder);
  const ergebnis: Record<string, Antwortwert> = {};

  for (const feld of felder) {
    if (feld.typ === FeldTyp.HINWEIS) continue;
    if (feld.istArt9) continue;
    if (geheim.has(feld.code)) continue;

    const roh = eingabe[feld.code];
    if (roh === undefined || roh === null) continue;

    if (typeof roh === "boolean") {
      ergebnis[feld.code] = roh;
    } else if (typeof roh === "number" && Number.isFinite(roh)) {
      ergebnis[feld.code] = roh;
    } else if (typeof roh === "string") {
      ergebnis[feld.code] = roh.slice(0, MAX_TEXT_LAENGE);
    } else if (Array.isArray(roh)) {
      ergebnis[feld.code] = roh
        .filter((e): e is string => typeof e === "string")
        .slice(0, 100)
        .map((e) => e.slice(0, MAX_TEXT_LAENGE));
    }
  }

  return ergebnis;
}

// Die IBAN-Prüfung wohnt jetzt in `lib/pruefwerte.ts` — einer Datei ohne jede
// Abhängigkeit. Grund: Dieses Modul zieht über `@/lib/db` den Prisma-Client mit,
// und jedes Modul, das nur `istIbanGueltig` brauchte, brauchte dadurch einen
// generierten Client. Hier wird sie weiter re-exportiert, damit bestehende
// Importe unverändert funktionieren.
export { istIbanGueltig };

function uebernehmeInAkte(feld: FeldEingabe, wert: Antwortwert, ziel: PersonUebernahme): void {
  if (feld.personFeld === PersonFeld.NICHTS) return;

  const text = Array.isArray(wert) ? wert.join(", ") : String(wert);

  switch (feld.personFeld) {
    case PersonFeld.VORNAME: ziel.vorname = text; break;
    case PersonFeld.NACHNAME: ziel.nachname = text; break;
    case PersonFeld.EMAIL: ziel.email = text; break;
    case PersonFeld.TELEFON: ziel.telefon = text; break;
    case PersonFeld.GEBURTSDATUM: ziel.geburtsdatum = new Date(`${text}T00:00:00.000Z`); break;
    case PersonFeld.STRASSE: ziel.strasse = text; break;
    case PersonFeld.PLZ: ziel.plz = text; break;
    case PersonFeld.ORT: ziel.ort = text; break;
    case PersonFeld.GEMEINDE: ziel.gemeinde = text; break;
    case PersonFeld.KONTOINHABER: ziel.kontoinhaber = text; break;
    case PersonFeld.IBAN: ziel.iban = text; break;
    case PersonFeld.TEILNAHMEFORM: {
      // Ausdrückliche Zuordnung statt Raten am Text — siehe pruefeFelddefinition.
      // Fehlt sie, wird nichts gesetzt: lieber keine Teilnahmeform als eine
      // falsche, denn daran hängen Prüfungspflicht, Zeugnis und Beitrag.
      const gewaehlt = feld.teilnahmeformZuordnung?.[text];
      if (gewaehlt) ziel.teilnahmeform = gewaehlt;
      break;
    }
  }
}

// -----------------------------------------------------------------------------
// Versionsregeln
// -----------------------------------------------------------------------------

/**
 * Liefert eine bearbeitbare Fassung. Ist die aktuelle Fassung veröffentlicht,
 * entsteht eine vollständige Kopie als nächster Entwurf — die veröffentlichte
 * Fassung bleibt unangetastet.
 */
export async function holeOderErzeugeEntwurf(formularId: string): Promise<string> {
  const vorhandenerEntwurf = await prisma.formularVersion.findFirst({
    where: { formularId, status: FormularVersionStatus.ENTWURF },
    orderBy: { version: "desc" },
  });
  if (vorhandenerEntwurf) return vorhandenerEntwurf.id;

  const letzte = await prisma.formularVersion.findFirst({
    where: { formularId },
    orderBy: { version: "desc" },
    include: { abschnitte: { include: { felder: true }, orderBy: { reihenfolge: "asc" } } },
  });

  const naechsteNummer = (letzte?.version ?? 0) + 1;

  return prisma.$transaction(async (tx) => {
    const neu = await tx.formularVersion.create({
      data: {
        formularId,
        version: naechsteNummer,
        status: FormularVersionStatus.ENTWURF,
        einleitung: letzte?.einleitung ?? null,
      },
    });

    for (const abschnitt of letzte?.abschnitte ?? []) {
      await tx.formularAbschnitt.create({
        data: {
          versionId: neu.id,
          titel: abschnitt.titel,
          beschreibung: abschnitt.beschreibung,
          reihenfolge: abschnitt.reihenfolge,
          felder: {
            create: abschnitt.felder
              .sort((a, b) => a.reihenfolge - b.reihenfolge)
              .map((feld) => ({
                code: feld.code,
                typ: feld.typ,
                label: feld.label,
                hilfetext: feld.hilfetext,
                platzhalter: feld.platzhalter,
                pflicht: feld.pflicht,
                reihenfolge: feld.reihenfolge,
                optionen: feld.optionen ?? Prisma.DbNull,
                personFeld: feld.personFeld,
                istArt9: feld.istArt9,
                validierung: feld.validierung ?? Prisma.DbNull,
              })),
          },
        },
      });
    }

    return neu.id;
  });
}

/** Wandelt die Felder einer Version in die Form, die die Prüffunktionen erwarten. */
type FeldAusDatenbank = {
  code: string;
  typ: FeldTyp;
  label: string;
  hilfetext: string | null;
  platzhalter: string | null;
  pflicht: boolean;
  reihenfolge: number;
  optionen: unknown;
  personFeld: PersonFeld;
  istArt9: boolean;
  validierung?: unknown;
};

/** Liest die Teilnahmeform-Zuordnung aus dem validierung-JSON eines Feldes. */
export function leseTeilnahmeformZuordnung(validierung: unknown): Record<string, Teilnahmeform> | null {
  if (!validierung || typeof validierung !== "object" || Array.isArray(validierung)) return null;
  const roh = (validierung as Record<string, unknown>).teilnahmeform;
  if (!roh || typeof roh !== "object" || Array.isArray(roh)) return null;

  const ergebnis: Record<string, Teilnahmeform> = {};
  for (const [option, wert] of Object.entries(roh as Record<string, unknown>)) {
    if (wert === Teilnahmeform.SCHUELER || wert === Teilnahmeform.HOERER) ergebnis[option] = wert;
  }
  return Object.keys(ergebnis).length > 0 ? ergebnis : null;
}

export function alsFeldEingaben(abschnitte: { felder: FeldAusDatenbank[] }[]): FeldEingabe[] {
  return abschnitte.flatMap((abschnitt) =>
    abschnitt.felder.map((feld) => ({
      code: feld.code,
      typ: feld.typ,
      label: feld.label,
      hilfetext: feld.hilfetext,
      platzhalter: feld.platzhalter,
      pflicht: feld.pflicht,
      reihenfolge: feld.reihenfolge,
      optionen: Array.isArray(feld.optionen) ? (feld.optionen as string[]) : null,
      personFeld: feld.personFeld,
      istArt9: feld.istArt9,
      teilnahmeformZuordnung: leseTeilnahmeformZuordnung(feld.validierung),
    })),
  );
}
