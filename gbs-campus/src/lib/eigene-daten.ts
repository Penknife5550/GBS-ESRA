/**
 * GBS Campus — Selbstpflege der eigenen Akte
 *
 * Prüfung und Normalisierung der Angaben, die ein Teilnehmer selbst ändern darf.
 * Ohne Datenbank, damit `scripts/pruefe-eigene-daten.ts` das ohne laufenden
 * Postgres gegenprüfen kann.
 *
 * Zwei Entscheidungen, die hier sichtbar werden:
 *
 *  1. **Ein leeres IBAN-Feld löscht nichts.** Die Bankverbindung wird nie im
 *     Klartext angezeigt, nur maskiert — das Eingabefeld ist deshalb immer
 *     leer. Würde „leer" als „löschen" gelten, hätte jede gespeicherte
 *     Adressänderung die Bankverbindung mitgelöscht, und der Beitragseinzug
 *     liefe ins Leere. Leer heißt: unverändert lassen.
 *  2. **Die E-Mail-Adresse läuft über einen eigenen Weg.** Sie ist der einzige
 *     Kontoschlüssel; ein Tippfehler sperrt dauerhaft aus. Deshalb steht sie
 *     nicht in `pruefeEigeneDaten`, sondern in `pruefeNeueEmail` — und wird
 *     erst nach Bestätigung über die neue Adresse wirksam.
 */

// Bewusst aus `pruefwerte` und NICHT aus `formular`: Letzteres zieht über
// `@/lib/db` den Prisma-Client mit, und dann bräuchte `npm run pruefen` einen
// generierten Client — obwohl im Kopf dieser Datei „ohne Datenbank" steht.
import { istIbanGueltig, type Pruefmeldung } from "@/lib/pruefwerte";

export type { Pruefmeldung };

export type EigeneDatenEingabe = {
  telefon?: string | null;
  strasse?: string | null;
  plz?: string | null;
  ort?: string | null;
  kontoinhaber?: string | null;
  iban?: string | null;
};

export type GepruefteDaten = {
  telefon: string | null;
  strasse: string | null;
  plz: string | null;
  ort: string | null;
  kontoinhaber: string | null;
  /** Nur gesetzt, wenn eine neue IBAN eingegeben wurde. */
  iban?: string;
};

export type PruefErgebnis = { ok: true; werte: GepruefteDaten } | { ok: false; meldungen: Pruefmeldung[] };

/** Leerer Text und fehlender Wert sind dasselbe: nicht angegeben. */
function text(wert: unknown): string | null {
  if (typeof wert !== "string") return null;
  const sauber = wert.trim();
  return sauber.length === 0 ? null : sauber;
}

function laengePasst(wert: string, min: number, max: number): boolean {
  return wert.length >= min && wert.length <= max;
}

export function pruefeEigeneDaten(eingabe: EigeneDatenEingabe): PruefErgebnis {
  const meldungen: Pruefmeldung[] = [];

  const telefon = text(eingabe.telefon);
  if (telefon && !/^[0-9+\-\s()/]{5,30}$/.test(telefon)) {
    meldungen.push({ feld: "telefon", meldung: "Bitte eine gültige Telefonnummer angeben." });
  }

  const strasse = text(eingabe.strasse);
  if (strasse && !laengePasst(strasse, 2, 120)) {
    meldungen.push({ feld: "strasse", meldung: "Bitte Straße und Hausnummer angeben (2 bis 120 Zeichen)." });
  }

  const plz = text(eingabe.plz);
  if (plz && !laengePasst(plz, 3, 10)) {
    meldungen.push({ feld: "plz", meldung: "Bitte eine gültige Postleitzahl angeben." });
  }

  const ort = text(eingabe.ort);
  if (ort && !laengePasst(ort, 2, 80)) {
    meldungen.push({ feld: "ort", meldung: "Bitte einen gültigen Ort angeben (2 bis 80 Zeichen)." });
  }

  const kontoinhaber = text(eingabe.kontoinhaber);
  if (kontoinhaber && !laengePasst(kontoinhaber, 2, 120)) {
    meldungen.push({ feld: "kontoinhaber", meldung: "Bitte den Namen des Kontoinhabers angeben." });
  }

  // Die IBAN wird nur geprüft, wenn tatsächlich eine eingegeben wurde — siehe
  // Kopf: leer heißt unverändert, nicht löschen.
  const ibanRoh = text(eingabe.iban);
  let iban: string | undefined;
  if (ibanRoh) {
    if (!istIbanGueltig(ibanRoh)) {
      meldungen.push({ feld: "iban", meldung: "Diese IBAN stimmt nicht. Bitte Ziffern und Reihenfolge prüfen." });
    } else {
      iban = ibanRoh.replace(/\s+/g, "").toUpperCase();
    }
  }

  if (meldungen.length > 0) return { ok: false, meldungen };

  return { ok: true, werte: { telefon, strasse, plz, ort, kontoinhaber, ...(iban ? { iban } : {}) } };
}

export type EmailErgebnis = { ok: true; email: string } | { ok: false; meldung: string };

/**
 * Prüft die gewünschte neue Adresse. Dieselbe Regel wie im Anmeldeformular,
 * plus: Sie muss sich von der bisherigen unterscheiden — sonst verschickt das
 * System eine Bestätigungsmail für eine Änderung, die keine ist.
 */
export function pruefeNeueEmail(eingabe: unknown, bisherige: string): EmailErgebnis {
  if (typeof eingabe !== "string") {
    return { ok: false, meldung: "Bitte eine gültige E-Mail-Adresse angeben." };
  }
  const email = eingabe.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) {
    return { ok: false, meldung: "Bitte eine gültige E-Mail-Adresse angeben." };
  }
  if (email === bisherige.trim().toLowerCase()) {
    return { ok: false, meldung: "Das ist bereits deine hinterlegte Adresse." };
  }

  return { ok: true, email };
}

/**
 * Welche Felder haben sich tatsächlich geändert — in Klartext für die Mail an
 * die Verwaltung.
 *
 * Warum nicht einfach „Daten geändert" melden: Die Verwaltung muss wissen, ob
 * sie die Bankverbindung neu einziehen oder nur eine Adresse nachtragen muss.
 * Eine Sammelmeldung würde in beiden Fällen gleich aussehen und deshalb
 * ignoriert werden.
 */
export const FELD_BEZEICHNUNG: Record<string, string> = {
  telefon: "Telefonnummer",
  strasse: "Straße",
  plz: "Postleitzahl",
  ort: "Ort",
  kontoinhaber: "Kontoinhaber",
  iban: "Bankverbindung",
  email: "E-Mail-Adresse",
};

export function geaenderteFelder(
  vorher: Record<string, string | null | undefined>,
  nachher: Record<string, string | null | undefined>,
): string[] {
  const geaendert: string[] = [];
  for (const feld of Object.keys(FELD_BEZEICHNUNG)) {
    if (!(feld in nachher)) continue;
    // undefined heißt „nicht mitgeschickt" und ist keine Änderung; null heißt
    // „geleert" und ist eine.
    if (nachher[feld] === undefined) continue;
    if ((vorher[feld] ?? null) !== (nachher[feld] ?? null)) {
      geaendert.push(FELD_BEZEICHNUNG[feld]);
    }
  }
  return geaendert;
}
