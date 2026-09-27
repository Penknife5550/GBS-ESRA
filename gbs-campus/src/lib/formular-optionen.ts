/**
 * GBS Campus — Formular-Builder: Antwortmöglichkeiten ohne jede Abhängigkeit
 *
 * Der Builder läuft im Browser und darf `formular.ts` nicht importieren — das
 * Modul zieht über `@/lib/db` den Prisma-Client mit. Was Builder und
 * `scripts/pruefe-formularlogik.ts` gemeinsam brauchen, steht deshalb hier:
 * das Normalisieren der Antwortmöglichkeiten, das Beschneiden der
 * Teilnahmeform-Zuordnung auf die Antworten, die es noch gibt, und welche
 * Aktenfelder immer als Art. 9 gekennzeichnet sein müssen.
 *
 * Diese Datei importiert nichts.
 */

/**
 * Aktenfelder, deren Formularfeld zwingend als „Besonders geschützt (Art. 9
 * DSGVO)" gekennzeichnet sein muss. Die Gemeindezugehörigkeit offenbart die
 * religiöse Überzeugung — und an `istArt9` hängt alles Weitere: Ohne gesonderte
 * Einwilligung wird die Antwort nicht gespeichert, weder beim Absenden
 * (`pruefeAntworten`) noch im Zwischenstand (`bereinigeEntwurf`); in reinen
 * Art.-9-Abschnitten ist sie zusätzlich ausgeblendet. Steht das Feld in einem
 * gemischten Abschnitt, ist es sichtbar und wird mitgeschickt — erst der Server
 * verwirft es. Vorher ließ sich das Häkchen im Builder abwählen. Der Server
 * prüft die Regel beim Speichern in `pruefeFelddefinition`, der Builder setzt
 * und sperrt das Häkchen; zur Laufzeit gilt sie auch für ältere Fassungen ohne
 * Häkchen (`giltAlsArt9` in formular.ts, Abbildung in anmeldung/page.tsx).
 */
export const ART9_AKTENFELDER: readonly string[] = ["GEMEINDE"];

export function aktenfeldVerlangtArt9(personFeld: string): boolean {
  return ART9_AKTENFELDER.includes(personFeld);
}

/**
 * Zerlegt die Antwortmöglichkeiten (Rohtext mit einer Antwort je Zeile oder
 * schon eine Liste) in die gespeicherte Form: Ränder getrimmt, leere Zeilen
 * weg. Leerzeichen innerhalb einer Antwort bleiben stehen.
 *
 * Nur beim Verlassen des Felds und vor dem Senden aufrufen, nie bei jedem
 * Tastendruck — sonst verschwinden ein Enter am Zeilenende und das Leerzeichen
 * zwischen zwei Wörtern, bevor das nächste Zeichen kommt.
 */
export function normalisiereOptionen(roh: string | readonly string[] | null | undefined): string[] {
  const zeilen: readonly string[] = typeof roh === "string" ? roh.split("\n") : (roh ?? []);
  return zeilen.map((zeile) => zeile.trim()).filter((zeile) => zeile.length > 0);
}

/**
 * Behält von einer Teilnahmeform-Zuordnung nur die Einträge, deren
 * Antwortmöglichkeit es noch gibt. Die Zuordnung hängt am Antworttext: Wird
 * eine Antwort umbenannt oder gelöscht, bliebe ihr alter Eintrag sonst als
 * verwaister Schlüssel im validierung-JSON stehen.
 *
 * Die Schlüssel werden wie die Antworten getrimmt verglichen — eine Antwort,
 * die beim Normalisieren nur ihr Leerzeichen am Rand verliert, behält ihre
 * Zuordnung. Ein leerer Wert (im Builder „— bitte wählen —") ist keine
 * Zuordnung und fällt ebenfalls weg; der Server meldet dann verständlich, für
 * welche Antwort die Angabe fehlt. Gibt `null` zurück, wenn nichts übrig bleibt.
 */
export function behalteVorhandeneZuordnungen<W extends string>(
  zuordnung: Readonly<Record<string, W>> | null | undefined,
  optionen: readonly string[],
): Record<string, W> | null {
  if (!zuordnung) return null;
  const vorhanden = new Set(optionen);
  // Object.entries statt zuordnung[option]: Nur eigene Einträge zählen — eine
  // Antwort „constructor" fände sonst Object.prototype.constructor.
  const eintraege = Object.entries(zuordnung)
    .map(([option, wert]) => [option.trim(), wert] as const)
    .filter(([option, wert]) => vorhanden.has(option) && Boolean(wert));
  return eintraege.length > 0 ? Object.fromEntries(eintraege) : null;
}

/**
 * Antwortmöglichkeiten und Teilnahmeform-Zuordnung eines Feldes so, wie der
 * Builder sie an den Server schickt: Antworten normalisiert, Zuordnung auf die
 * vorhandenen Antworten beschnitten und nur bei einem Teilnahmeform-Feld
 * überhaupt mitgeschickt.
 */
export function bereinigeOptionenUndZuordnung<W extends string>(feld: {
  optionen?: readonly string[] | null;
  personFeld: string;
  teilnahmeformZuordnung?: Readonly<Record<string, W>> | null;
}): { optionen: string[] | null; teilnahmeformZuordnung: Record<string, W> | null } {
  const optionen = feld.optionen ? normalisiereOptionen(feld.optionen) : null;
  return {
    optionen,
    teilnahmeformZuordnung:
      feld.personFeld === "TEILNAHMEFORM"
        ? behalteVorhandeneZuordnungen(feld.teilnahmeformZuordnung, optionen ?? [])
        : null,
  };
}
