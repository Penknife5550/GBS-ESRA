/**
 * GBS Campus — Honorar: Korrektur- und Nachholwege (reine Regeln und Texte)
 *
 * Drei Wege, die es vor Code-Review 4 nicht gab:
 *
 *  - Dozentenwechsel an einem abgerechneten Abend (M11): gesperrt, solange der
 *    Abend in einer Abrechnung steht. Sonst bliebe der eingefrorene Posten in der
 *    Abrechnung des bisherigen Dozenten, beim neuen zaehlte der Abend als
 *    gehalten, liesse sich aber nie abrechnen (Posten.terminId ist @unique).
 *    Korrekturweg: eine OFFENE Abrechnung stornieren, umhaengen, neu abrechnen.
 *  - Nachversand eines DMS-Belegs (M12): Freigabe und Satz-Genehmigung setzen
 *    zuerst die fachliche Tatsache und versenden den Beleg best-effort. Scheitert
 *    der Versand, bleibt `dmsGesendetAm` leer — der Beleg muss sich dann mit
 *    derselben Beleg-Nr nachsenden lassen, ohne SQL.
 *  - Ehrliche Rueckmeldung zum Versand: nicht mehr pauschal „E-Mail noch nicht
 *    eingerichtet“, sondern der tatsaechliche Ausgang und der Weg zum Nachholen.
 *
 * Bewusst ohne Datenbank und ohne Importe: Route, IO-Teil, Client-Komponenten
 * und `scripts/pruefe-honorar-abrechnung.ts` nutzen dieselbe Quelle.
 */

/** Status einer Abrechnung — deckungsgleich mit dem Prisma-Enum, hier ohne Prisma-Import. */
export type AbrechnungStatus = "OFFEN" | "FREIGEGEBEN" | "AUSGEZAHLT";

/**
 * Fachliches Nein eines Honorar-Schreibwegs; die Route bildet es auf den
 * HTTP-Status ab. Gilt fuer die Korrekturwege und ebenso fuer Abrechnen,
 * Freigeben und Auszahlen.
 */
export type KorrekturFehler = "eingabe" | "fehlt" | "konflikt" | "server";

/** HTTP-Status je fachlichem Nein (Hausregel: 400 Eingabe, 404 fehlt, 409 Konflikt, 500 Betrieb). */
export function statusFuer(code: KorrekturFehler): number {
  switch (code) {
    case "eingabe":
      return 400;
    case "fehlt":
      return 404;
    case "konflikt":
      return 409;
    case "server":
      return 500;
  }
}

// -----------------------------------------------------------------------------
// Dozentenwechsel an einem abgerechneten Abend (M11)
// -----------------------------------------------------------------------------

/**
 * Ob die Dozentenzuordnung eines Termins geaendert werden darf. Liefert null
 * (erlaubt) oder die Meldung fuer die 409.
 *
 * Gesperrt wird nur eine ECHTE Aenderung: Die Stundenplan-Seite schickt Fach und
 * Dozent immer gemeinsam — eine reine Fach-Korrektur an einem abgerechneten
 * Abend (derselbe Dozent) bleibt erlaubt. Auch das Entfernen des Dozenten (neu =
 * null) ist eine Aenderung.
 *
 * @param bisher der aktuell gespeicherte Dozent des Termins
 * @param neu    der gewuenschte Dozent (undefined = Feld nicht geschickt)
 * @param abrechnungStatus Status der Abrechnung, in der der Abend steht (null = nicht abgerechnet)
 */
export function dozentWechselSperre(
  bisher: string | null,
  neu: string | null | undefined,
  abrechnungStatus: AbrechnungStatus | null,
): string | null {
  if (neu === undefined || neu === bisher) return null;
  if (abrechnungStatus === null) return null;
  if (abrechnungStatus === "OFFEN") {
    return "Dieser Abend ist bereits abgerechnet — erst die Abrechnung stornieren.";
  }
  // Freigegeben/ausgezahlt: Die Auszahlung ist angewiesen (Zahlungsbeleg mit IBAN
  // erzeugt), einen Storno gibt es dafuer bewusst nicht — also auch keinen
  // Hinweis auf einen.
  return "Dieser Abend ist bereits in einer freigegebenen Abrechnung enthalten — die Dozentenzuordnung lässt sich nicht mehr ändern.";
}

// -----------------------------------------------------------------------------
// DMS-Belegversand und Nachversand (M12)
// -----------------------------------------------------------------------------

/**
 * Ausgang eines Belegversands an das DMS.
 *  - GESENDET: Der Mailserver hat den Beleg angenommen, `dmsGesendetAm` ist gesetzt.
 *  - KEINE_ADRESSE: Es ist keine DMS-Adresse eingerichtet (DMS_EMAIL) — nichts versucht.
 *  - FEHLGESCHLAGEN: versucht, aber nicht zugestellt (SMTP-Fehler, PDF-Fehler …);
 *    ein SMTP-Fehler steht mit Ursache in der Betriebsansicht (`email_versand`).
 *    Die sieht nur der Administrator (Recht SYSTEM_EINSTELLUNGEN) — die Texte
 *    unten verweisen deshalb auf ihn, nicht direkt auf die Seite.
 *  - LAEUFT: Derselbe Beleg wird in diesem Moment schon gesendet (Sperre belegt).
 */
export type DmsVersand = "GESENDET" | "KEINE_ADRESSE" | "FEHLGESCHLAGEN" | "LAEUFT";

/**
 * Ob ein Wert ein Versand-Ausgang ist — fuer den Query-Parameter `?freigabe=…`,
 * mit dem der Freigabe-Knopf den Ausgang an die Detailseite weitergibt.
 */
export function istDmsVersand(wert: unknown): wert is DmsVersand {
  return wert === "GESENDET" || wert === "KEINE_ADRESSE" || wert === "FEHLGESCHLAGEN" || wert === "LAEUFT";
}

/**
 * Hinweis statt „Beleg erneut senden“, wenn keine DMS-Adresse (DMS_EMAIL)
 * eingerichtet ist: Der Nachversand lieferte dann sicher eine 500 — Knopf und
 * Aufforderung zum Nachsenden liefen ins Leere.
 */
export const DMS_NICHT_EINGERICHTET =
  "Es ist keine DMS-Adresse (DMS_EMAIL) eingerichtet — nachsenden lässt sich der Beleg erst, wenn der Administrator sie eingerichtet hat.";

/** Ausgang eines Versandversuchs; zusaetzlich: war inzwischen schon gesendet. */
export type BelegAusgang = DmsVersand | "SCHON_GESENDET";

/** Betreff, Text und Anhangname einer Beleg-Mail an das DMS (gebaut in den Beleg-Modulen). */
export type DmsMail = { betreff: string; text: string; dateiname: string };

/**
 * Rueckmeldung nach Freigabe bzw. Satz-Genehmigung zum Belegversand. Nennt den
 * tatsaechlichen Ausgang und — wenn der Beleg nicht angekommen ist — den Weg zum
 * Nachholen. Frueher stand hier bei JEDEM Fehlschlag „E-Mail noch nicht
 * eingerichtet“, auch bei einem SMTP-Aussetzer.
 */
export function dmsVersandText(belegNr: string, versand: DmsVersand): string {
  switch (versand) {
    case "GESENDET":
      return `Beleg ${belegNr} an das DMS gesendet.`;
    case "KEINE_ADRESSE":
      return (
        `Beleg ${belegNr} erzeugt, aber nicht an das DMS gesendet: Es ist keine DMS-Adresse eingerichtet (DMS_EMAIL). ` +
        `Nach der Einrichtung lässt er sich über „Beleg erneut senden“ nachsenden.`
      );
    case "FEHLGESCHLAGEN":
      return (
        `Beleg ${belegNr} erzeugt, aber nicht an das DMS zugestellt. Die Ursache sieht der Administrator im ` +
        `Versandprotokoll (Verwaltung → Betrieb); der Beleg lässt sich über „Beleg erneut senden“ nachsenden.`
      );
    case "LAEUFT":
      return `Beleg ${belegNr} wird gerade an das DMS gesendet. Bitte die Seite gleich neu laden.`;
  }
}

/**
 * Ob der Zahlungsbeleg einer Abrechnung (erneut) gesendet werden darf. Liefert
 * null (erlaubt) oder die Meldung fuer die 409. Erlaubt nur, wenn die Abrechnung
 * freigegeben oder ausgezahlt ist, eine Beleg-Nr traegt (vergeben bei der
 * Freigabe) und der Beleg noch nicht angekommen ist. Dieselbe Funktion
 * entscheidet, ob die Detailseite den Knopf zeigt.
 */
export function pruefeAbrechnungNachversand(a: {
  status: AbrechnungStatus;
  belegNr: string | null;
  dmsGesendetAm: Date | null;
}): string | null {
  if (a.status === "OFFEN") return "Eine offene Abrechnung hat noch keinen Beleg — erst freigeben.";
  if (!a.belegNr) return "Diese Abrechnung hat keine Beleg-Nr.";
  if (a.dmsGesendetAm) return "Der Beleg ist bereits an das DMS gesendet.";
  return null;
}

/** Wie `pruefeAbrechnungNachversand`, fuer den Beleg einer Satz-Genehmigung. */
export function pruefeSatzNachversand(s: { dmsBelegNr: string | null; dmsGesendetAm: Date | null }): string | null {
  if (!s.dmsBelegNr) return "Dieser Satz hat keine Beleg-Nr.";
  if (s.dmsGesendetAm) return "Der Beleg ist bereits an das DMS gesendet.";
  return null;
}

export type NachversandErgebnis =
  | { ok: true; belegNr: string }
  | { ok: false; code: KorrekturFehler; meldung: string };

/**
 * Bildet den Ausgang eines Nachversands auf das Ergebnis der Route ab. Nicht
 * zugestellt ist ein Betriebsfehler (500), kein Eingabefehler; „laeuft gerade“
 * und „inzwischen gesendet“ sind Konflikte mit dem aktuellen Stand (409).
 */
export function nachversandErgebnis(belegNr: string, ausgang: BelegAusgang): NachversandErgebnis {
  switch (ausgang) {
    case "GESENDET":
      return { ok: true, belegNr };
    case "KEINE_ADRESSE":
      return {
        ok: false,
        code: "server",
        meldung: "Es ist keine DMS-Adresse eingerichtet (DMS_EMAIL) — der Beleg kann nicht gesendet werden.",
      };
    case "FEHLGESCHLAGEN":
      return {
        ok: false,
        code: "server",
        meldung:
          `Der Beleg ${belegNr} konnte nicht an das DMS zugestellt werden. Die Ursache sieht der Administrator ` +
          `im Versandprotokoll (Verwaltung → Betrieb). Bitte später noch einmal versuchen.`,
      };
    case "LAEUFT":
      return {
        ok: false,
        code: "konflikt",
        meldung: `Der Beleg ${belegNr} wird gerade schon gesendet. Bitte die Seite gleich neu laden.`,
      };
    case "SCHON_GESENDET":
      return { ok: false, code: "konflikt", meldung: `Der Beleg ${belegNr} ist inzwischen bereits an das DMS gesendet.` };
  }
}
