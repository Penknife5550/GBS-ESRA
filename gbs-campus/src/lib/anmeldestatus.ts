/**
 * GBS Campus — Klartext für den Bearbeitungsstand einer Anmeldung
 *
 * Eine Stelle für Liste, Einzelansicht und Badge der Verwaltung. Vorher pflegten
 * beide Seiten eigene Tabellen, und dieselbe Entscheidung hieß dort
 * „Aufgenommen", in der Datenauskunft „Angenommen". Der Begriff ist jetzt
 * überall „Angenommen" — wie der Status der Person, den die Annahme setzt.
 *
 * Die Datenauskunft (`anmeldungsstatusText` in auskunft-inhalt.ts) erklärt
 * Entwurf und Eingang bewusst ausführlicher, weil ein Laie die PDF liest; bei
 * Annahme und Ablehnung nimmt sie denselben Wortlaut von hier.
 *
 * Ohne Imports: Server- und Client-Komponenten dürfen es nutzen, und
 * `scripts/pruefe-anmeldung-antworten.ts` prüft es ohne Datenbank.
 */

export const ANMELDESTATUS_NAME: Record<string, string> = {
  ENTWURF: "Begonnen, nicht abgeschickt",
  EINGEREICHT: "Wartet auf Entscheidung",
  ANGENOMMEN: "Angenommen",
  ABGELEHNT: "Abgelehnt",
};

/** Klartext zum Anmeldestatus; ein unbekannter Code bleibt sichtbar statt leer. */
export function anmeldestatusName(status: string): string {
  return ANMELDESTATUS_NAME[status] ?? status;
}
