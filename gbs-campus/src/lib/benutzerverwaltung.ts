/**
 * GBS Campus — Benutzer- und Rollenverwaltung: DB-freie Kernlogik
 *
 * Wer die Rollen einer Person ändert, setzt eine gewünschte Menge; hier wird
 * DB-frei entschieden, was das gegenüber dem Ist-Zustand bedeutet und ob die
 * Menge überhaupt zulässig ist. Ohne Datenbank, damit
 * `scripts/pruefe-benutzerverwaltung.ts` es ohne laufenden Postgres gegenprüfen
 * kann. Die eine Regel, die nicht DB-frei entscheidbar ist — „es muss immer
 * mindestens ein Administrator bleiben" —, prüft die Route (sie braucht die Zahl
 * der übrigen Administratoren).
 */

/**
 * Diese Rolle darf nicht versehentlich verschwinden: Ohne Administrator kommt
 * niemand mehr an Konten und Rollen. Der Wert spiegelt `ROLLE.ADMIN` aus
 * `constants.ts` — bewusst hier eigenständig, damit dieses Modul DB- und
 * importfrei bleibt.
 */
export const ADMIN_ROLLE = "ADMIN";

export type RollenDiff = { hinzu: string[]; weg: string[] };

/**
 * Was muss angelegt bzw. entfernt werden, um von `vorhanden` auf `gewuenscht`
 * zu kommen? Unveränderte Rollen bleiben unangetastet (so wird ihr `erteiltAm`
 * nicht bei jedem Speichern zurückgesetzt). Doppelte Einträge sind egal — es
 * wird über Mengen gerechnet.
 */
export function rollenDiff(gewuenscht: string[], vorhanden: string[]): RollenDiff {
  const gew = new Set(gewuenscht);
  const vor = new Set(vorhanden);
  return {
    hinzu: [...gew].filter((r) => !vor.has(r)),
    weg: [...vor].filter((r) => !gew.has(r)),
  };
}

/** Sind alle gewünschten Codes bekannte Rollen? Verhindert das Anlegen einer
 * Zuordnung auf eine Rolle, die es gar nicht gibt (Fremdschlüssel-500). */
export function sindRollenBekannt(gewuenscht: string[], bekannt: string[]): boolean {
  const b = new Set(bekannt);
  return gewuenscht.every((r) => b.has(r));
}

/** Würde diese Änderung der Person den Administrator-Zugang entziehen? */
export function entziehtAdmin(diff: RollenDiff): boolean {
  return diff.weg.includes(ADMIN_ROLLE);
}

// -----------------------------------------------------------------------------
// Person anlegen — Prüfung der Eingabe (DB-frei)
//
// Die Regeln spiegeln bewusst die des öffentlichen Anmeldeformulars bzw. der
// Selbstpflege (E-Mail-Format, Telefonmuster), damit von Hand angelegte Konten
// denselben Anforderungen genügen wie selbst angemeldete.
// -----------------------------------------------------------------------------

export type Pruefmeldung = { feld?: string; meldung: string };

const EMAIL_MUSTER = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TELEFON_MUSTER = /^[0-9+\-\s()/]{5,30}$/;

function text(wert: unknown): string {
  return typeof wert === "string" ? wert.trim() : "";
}

/** Prüft einen Namen (Vor- oder Nachname): vorhanden, 1–80 Zeichen. */
export function istNameGueltig(wert: unknown): boolean {
  const n = text(wert);
  return n.length >= 1 && n.length <= 80;
}

export type NeuePersonEingabe = {
  vorname?: unknown;
  nachname?: unknown;
  email?: unknown;
  telefon?: unknown;
};

export type NeuePersonWerte = { vorname: string; nachname: string; email: string; telefon: string | null };
export type NeuePersonErgebnis = { ok: true; werte: NeuePersonWerte } | { ok: false; meldungen: Pruefmeldung[] };

/** Prüft und normalisiert die Eingabe fürs Anlegen einer Person. */
export function pruefeNeuePerson(eingabe: NeuePersonEingabe): NeuePersonErgebnis {
  const meldungen: Pruefmeldung[] = [];

  const vorname = text(eingabe.vorname);
  if (!istNameGueltig(vorname)) meldungen.push({ feld: "vorname", meldung: "Bitte einen Vornamen angeben (1 bis 80 Zeichen)." });

  const nachname = text(eingabe.nachname);
  if (!istNameGueltig(nachname)) meldungen.push({ feld: "nachname", meldung: "Bitte einen Nachnamen angeben (1 bis 80 Zeichen)." });

  const email = text(eingabe.email).toLowerCase();
  if (!EMAIL_MUSTER.test(email) || email.length > 120) {
    meldungen.push({ feld: "email", meldung: "Bitte eine gültige E-Mail-Adresse angeben." });
  }

  const telefonRoh = text(eingabe.telefon);
  let telefon: string | null = null;
  if (telefonRoh) {
    if (!TELEFON_MUSTER.test(telefonRoh)) {
      meldungen.push({ feld: "telefon", meldung: "Bitte eine gültige Telefonnummer angeben." });
    } else {
      telefon = telefonRoh;
    }
  }

  if (meldungen.length > 0) return { ok: false, meldungen };
  return { ok: true, werte: { vorname, nachname, email, telefon } };
}
