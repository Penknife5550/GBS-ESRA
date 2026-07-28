/**
 * GBS Campus — Wertprüfungen ohne jede Abhängigkeit
 *
 * Hier steht, was sich rein aus einem Wert entscheiden lässt: IBAN-Prüfsumme,
 * die gemeinsame Form einer Prüfmeldung.
 *
 * **Warum eine eigene Datei:** `formular.ts` enthält dieselben Prüfungen, zieht
 * über `@/lib/db` aber den Prisma-Client mit — und der wird beim Import
 * ausgeführt. Jedes Modul, das nur `istIbanGueltig` brauchte, brauchte damit
 * einen generierten Client und eine gesetzte `DATABASE_URL`. Genau daran ist am
 * 27.07. `scripts/pruefe-eigene-daten.ts` gescheitert, obwohl in seinem Kopf
 * „ohne Datenbank" steht. Diese Datei importiert nichts.
 */

/** Die gemeinsame Form aller Prüfbefunde — Feldbezug optional, Meldung deutsch. */
export type Pruefmeldung = { feld?: string; meldung: string };

const IBAN_LAENGE: Record<string, number> = {
  DE: 22, AT: 20, CH: 21, LI: 21, LU: 20, NL: 18, BE: 16, FR: 27, IT: 27,
  ES: 24, PL: 28, CZ: 24, DK: 18, SE: 24, NO: 15, FI: 18, GB: 22, PT: 25,
};

/**
 * IBAN-Prüfung nach ISO 13616: Länderlänge und Modulo-97-Prüfsumme.
 * Ein Zahlendreher in der IBAN fällt sonst erst auf, wenn die Lastschrift
 * zurückkommt — und dann ist der Teilnehmer längst im Semester.
 */
export function istIbanGueltig(iban: string): boolean {
  const bereinigt = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(bereinigt)) return false;

  const laenge = IBAN_LAENGE[bereinigt.slice(0, 2)];
  if (laenge && bereinigt.length !== laenge) return false;

  const umgestellt = bereinigt.slice(4) + bereinigt.slice(0, 4);
  const ziffern = umgestellt.replace(/[A-Z]/g, (buchstabe) => String(buchstabe.charCodeAt(0) - 55));

  // Stückweise rechnen — die Zahl ist für Number zu groß.
  let rest = 0;
  for (const ziffer of ziffern) {
    rest = (rest * 10 + Number(ziffer)) % 97;
  }
  return rest === 1;
}
