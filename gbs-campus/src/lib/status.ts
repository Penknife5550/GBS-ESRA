/**
 * GBS Campus — Statusmaschine und Ausbildungsdaten: DB-freie Regeln
 *
 * Bis Code-Review 4 (M9) ließ sich der Status einer Person nur an vier fest
 * verdrahteten Stellen setzen; VERSTORBEN, ABGEBROCHEN, AUSGESCHLOSSEN,
 * BEURLAUBT und ABSOLVENT waren über die Oberfläche unerreichbar — der „Not-Aus"
 * griff nie. Hier stehen die Regeln für den Wechsel von Hand und für die
 * Ausbildungsdaten (Geburtsdatum, Gemeinde, Teilnahmeform). Ohne Datenbank,
 * damit `scripts/pruefe-benutzerverwaltung.ts` sie ohne Postgres gegenprüft;
 * das Schreiben steht in `status-io.ts`.
 */

import { STATUS } from "@/lib/constants";
import type { Pruefmeldung } from "@/lib/pruefwerte";
import { alsTagesdatum } from "@/lib/semester";

/**
 * Ziele, die sich von Hand nicht setzen lassen: INTERESSENT entsteht nur durch
 * eine Anmeldung, ANONYMISIERT nur über die eigene Aktion „Anonymisieren" —
 * die überschreibt dabei alle Personendaten, ein bloßer Statuswechsel täte das
 * nicht.
 */
export const NICHT_WAEHLBAR: readonly string[] = [STATUS.INTERESSENT, STATUS.ANONYMISIERT];

/** Wechsel in diese Zustände brauchen einen Grund — sie beenden die Ausbildung. */
export const GRUND_PFLICHT: readonly string[] = [STATUS.ABGEBROCHEN, STATUS.AUSGESCHLOSSEN, STATUS.VERSTORBEN];

export const GRUND_MAX_LAENGE = 500;

/**
 * Die Gründe, die das System selbst in `status_wechsel` schreibt. Alles andere
 * dort ist Freitext der Schulleitung (Wechsel von Hand) und kann Personenbezug
 * tragen — den überschreibt die Anonymisierung, diese hier nicht.
 */
export const SYSTEM_GRUND = {
  ANMELDUNG_EINGEGANGEN: "Anmeldung eingegangen",
  ANMELDUNG_ANGENOMMEN: "Anmeldung angenommen",
  VON_HAND_ANGELEGT: "Von der Verwaltung angelegt",
  ANONYMISIERT: "Anonymisiert nach Art. 17 DSGVO",
} as const;
export const SYSTEM_GRUENDE: string[] = Object.values(SYSTEM_GRUND);

/**
 * Aus einem Endzustand (istTerminal) führt kein Weg heraus — mit einer
 * Ausnahme: Auch die Daten einer ausgeschiedenen oder verstorbenen Person
 * müssen sich löschen lassen, die Anonymisierung bleibt also immer möglich.
 */
export function darfAusEndzustand(nachCode: string): boolean {
  return nachCode === STATUS.ANONYMISIERT;
}

export function brauchtGrund(nachCode: string): boolean {
  return GRUND_PFLICHT.includes(nachCode);
}

export type StatusRegelErgebnis =
  | { ok: true; grund: string | null }
  | { ok: false; status: 400 | 409; meldung: string };

/** Meldung, solange über eine eingereichte Anmeldung der Person nicht entschieden ist. */
export const MELDUNG_ANMELDUNG_OFFEN =
  "Über die Anmeldung dieser Person ist noch nicht entschieden. Bitte zuerst unter „Anmeldungen“ annehmen oder ablehnen.";

/**
 * Darf eine Person von `vonCode` nach `nachCode` wechseln (Wechsel von Hand)?
 * Liefert den bereinigten Grund (leer → null) oder Status und Meldung.
 *
 * `offeneAnmeldung`: Die Person hat eine EINGEREICHTE Anmeldung, über die noch
 * nicht entschieden ist. Dann gibt es keinen Wechsel von Hand (409) — er ginge
 * an der Aufnahme vorbei (keine Teilnahme, keine Willkommensmail, keine
 * Ehepartner-Ermäßigung), und ein späteres „Annehmen" setzte den Status still
 * wieder auf „Angenommen".
 */
export function pruefeStatuswechsel(eingabe: {
  vonCode: string;
  vonIstTerminal: boolean;
  nachCode: string;
  grund?: string | null;
  offeneAnmeldung?: boolean;
}): StatusRegelErgebnis {
  const grund = typeof eingabe.grund === "string" && eingabe.grund.trim().length > 0 ? eingabe.grund.trim() : null;

  if (eingabe.vonIstTerminal) {
    return {
      ok: false,
      status: 409,
      meldung: "Die Person steht in einem Endzustand — daraus führt kein Statuswechsel mehr heraus.",
    };
  }
  if (eingabe.offeneAnmeldung) {
    return { ok: false, status: 409, meldung: MELDUNG_ANMELDUNG_OFFEN };
  }
  if (eingabe.nachCode === STATUS.ANONYMISIERT) {
    return {
      ok: false,
      status: 400,
      meldung: "Anonymisieren läuft über die eigene Aktion „Anonymisieren“ — nur sie löscht auch die Personendaten.",
    };
  }
  if (eingabe.nachCode === STATUS.INTERESSENT) {
    return { ok: false, status: 400, meldung: "Der Status „Interessent“ entsteht nur durch eine Anmeldung." };
  }
  if (eingabe.nachCode === eingabe.vonCode) {
    return { ok: false, status: 400, meldung: "Die Person hat diesen Status bereits." };
  }
  if (grund && grund.length > GRUND_MAX_LAENGE) {
    return { ok: false, status: 400, meldung: `Der Grund ist zu lang (höchstens ${GRUND_MAX_LAENGE} Zeichen).` };
  }
  if (!grund && brauchtGrund(eingabe.nachCode)) {
    return { ok: false, status: 400, meldung: "Für diesen Status ist ein Grund erforderlich." };
  }
  return { ok: true, grund };
}

/**
 * Die Ziele, die die Oberfläche anbietet — dieselben Regeln wie oben, damit
 * kein Knopf zu einem Wechsel führt, den der Server ablehnt. Den eigenen Status
 * lehnt die Route ab (403) — die Seite übergibt dafür selbst eine leere Liste.
 */
export function waehlbareZiele<T extends { code: string }>(
  alle: T[],
  vonCode: string,
  vonIstTerminal: boolean,
  offeneAnmeldung = false,
): T[] {
  if (vonIstTerminal || offeneAnmeldung) return [];
  return alle.filter((s) => !NICHT_WAEHLBAR.includes(s.code) && s.code !== vonCode);
}

// -----------------------------------------------------------------------------
// Ausbildungsdaten: Geburtsdatum, Gemeinde, Teilnahmeform
// -----------------------------------------------------------------------------

export const GEMEINDE_MAX_LAENGE = 120;
/** Wie im Anmeldeformular (`formular.ts`): älter ist ein Tippfehler im Jahr. */
const GEBURTSJAHR_MIN = 1900;

type Form = "SCHUELER" | "HOERER";

export type AusbildungsdatenEingabe = {
  /** „JJJJ-MM-TT"; leer oder null leert, `undefined` lässt unverändert. */
  geburtsdatum?: string | null;
  gemeinde?: string | null;
  teilnahmeform?: string | null;
};

export type AusbildungsdatenBisher = {
  geburtsdatum: Date | null;
  gemeinde: string | null;
  teilnahmeform: string | null;
  /**
   * Formen der ZÄHLENDEN Teilnahmen (nicht abgemeldet) im laufenden Semester
   * und in Semestern, die noch nicht begonnen haben — etwa die Teilnahme, die
   * die Semesterüberleitung oder eine Aufnahme schon für das nächste Semester
   * angelegt hat. Leer = keine solche Teilnahme. Vergangene Semester bleiben,
   * wie sie waren.
   */
  teilnahmeformenOffen: string[];
};

export type AusbildungsdatenErgebnis =
  | {
      ok: true;
      /** Nur die tatsächlich geänderten Personenfelder. */
      person: { geburtsdatum?: Date | null; gemeinde?: string | null; teilnahmeform?: Form | null };
      /**
       * Neue Form für die offenen Teilnahmen (siehe `teilnahmeformenOffen`),
       * wenn mindestens eine davon abweicht; sonst null (nicht anfassen).
       */
      teilnahmen: Form | null;
      /** Namen der geänderten Felder — genau das, was ins Audit darf. */
      felder: string[];
    }
  | { ok: false; status: 400 | 409; meldungen: Pruefmeldung[] };

/**
 * Prüft die Ausbildungsdaten gegen den bisherigen Stand und liefert nur die
 * Änderungen.
 *
 * Die Gemeinde ist hier eine Angabe nach Art. 9 DSGVO (Glaube und
 * Gemeindezugehörigkeit) — dieselbe Linie wie im Anmeldeformular: Ohne erteilte
 * Einwilligung wird kein neuer Wert gespeichert (409). Leeren geht immer.
 *
 * Die Teilnahmeform gilt für die Person UND ihre offenen Teilnahmen. Weicht nur
 * eine Teilnahme ab (die Person hat schon den neuen Wert), bleibt `person` leer
 * und nur `teilnahmen` ist gesetzt — der Aufrufer darf dann nicht mit einem
 * leeren Personen-Update auf „nichts geändert" schließen.
 */
export function pruefeAusbildungsdaten(
  eingabe: AusbildungsdatenEingabe,
  bisher: AusbildungsdatenBisher,
  kontext: { heute: Date; art9Eingewilligt: boolean },
): AusbildungsdatenErgebnis {
  const meldungen: Pruefmeldung[] = [];
  const person: { geburtsdatum?: Date | null; gemeinde?: string | null; teilnahmeform?: Form | null } = {};
  let teilnahmen: Form | null = null;
  let ohneEinwilligung = false;

  if (eingabe.geburtsdatum !== undefined) {
    const roh = (eingabe.geburtsdatum ?? "").trim();
    if (roh === "") {
      if (bisher.geburtsdatum !== null) person.geburtsdatum = null;
    } else {
      const tag = alsTagesdatum(roh);
      if (!tag || tag.getUTCFullYear() < GEBURTSJAHR_MIN) {
        meldungen.push({ feld: "geburtsdatum", meldung: "Bitte ein gültiges Geburtsdatum angeben." });
      } else if (tag.getTime() > kontext.heute.getTime()) {
        meldungen.push({ feld: "geburtsdatum", meldung: "Das Geburtsdatum liegt in der Zukunft." });
      } else if (!bisher.geburtsdatum || bisher.geburtsdatum.getTime() !== tag.getTime()) {
        person.geburtsdatum = tag;
      }
    }
  }

  if (eingabe.gemeinde !== undefined) {
    const neu = (eingabe.gemeinde ?? "").trim() || null;
    if (neu && neu.length > GEMEINDE_MAX_LAENGE) {
      meldungen.push({ feld: "gemeinde", meldung: `Die Gemeinde ist zu lang (höchstens ${GEMEINDE_MAX_LAENGE} Zeichen).` });
    } else if (neu !== (bisher.gemeinde ?? null)) {
      if (neu !== null && !kontext.art9Eingewilligt) ohneEinwilligung = true;
      else person.gemeinde = neu;
    }
  }

  if (eingabe.teilnahmeform !== undefined) {
    const neu = eingabe.teilnahmeform === "" || eingabe.teilnahmeform === null ? null : eingabe.teilnahmeform;
    if (neu !== null && neu !== "SCHUELER" && neu !== "HOERER") {
      meldungen.push({ feld: "teilnahmeform", meldung: "Bitte Schüler oder Hörer wählen." });
    } else if (neu === null && bisher.teilnahmeformenOffen.length > 0) {
      meldungen.push({
        feld: "teilnahmeform",
        meldung:
          "Die Person hat eine Teilnahme im laufenden oder nächsten Semester — dafür muss die Teilnahmeform festgelegt sein.",
      });
    } else {
      if (neu !== (bisher.teilnahmeform ?? null)) person.teilnahmeform = neu;
      if (neu !== null && bisher.teilnahmeformenOffen.some((form) => form !== neu)) teilnahmen = neu;
    }
  }

  if (meldungen.length > 0) return { ok: false, status: 400, meldungen };
  if (ohneEinwilligung) {
    return {
      ok: false,
      status: 409,
      meldungen: [
        {
          feld: "gemeinde",
          meldung:
            "Die Gemeindezugehörigkeit ist eine Angabe nach Art. 9 DSGVO. Ohne erteilte Einwilligung der Person " +
            "wird sie nicht gespeichert — leeren lässt sie sich jederzeit.",
        },
      ],
    };
  }

  const felder = Object.keys(person);
  if (teilnahmen && !felder.includes("teilnahmeform")) felder.push("teilnahmeform");
  return { ok: true, person, teilnahmen, felder };
}
