/**
 * GBS Campus — Belegversand an das DMS
 *
 * Honorarsatz-Belege, Zahlungsbelege der Honorar-Abrechnung und
 * Zeugnis-Archivkopien gehen als PDF-Anhang an dieselbe DMS-Adresse
 * (`DMS_EMAIL`). Vorher stand der Versand dreimal ausgeschrieben, und die
 * Sperre lag im Honorarmodul — das Zeugnismodul hing deshalb am Honorar.
 *
 * Hier liegen nur die gemeinsamen Bausteine: die Sperre je Beleg und der
 * Versand eines PDF-Belegs. Was im Beleg steht und wann `dmsGesendetAm` gesetzt
 * wird, entscheidet weiter der jeweilige Fachteil.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendeMail } from "@/lib/mailer";

/**
 * Zeitlimit der Versand-Transaktion. Sie bleibt waehrend des SMTP-Versands offen;
 * der Mailer bricht nach seinen Transport-Timeouts (10 s Verbindung, 10 s Gruss,
 * 20 s Funkstille) selbst ab — das Limit liegt grosszuegig darueber.
 */
const DMS_SPERRE_ZEITLIMIT_MS = 60_000;

/**
 * Fuehrt einen DMS-Belegversand unter einer Sperre JE BELEG aus (Postgres-
 * Advisory-Lock fuer die Dauer der Transaktion). Zwei gleichzeitige Versuche —
 * Nachversand in zwei Tabs, Nachversand waehrend der Erstversand noch laeuft —
 * duerfen denselben Beleg nicht zweimal ans DMS schicken (beim Zahlungsbeleg:
 * doppelte IBAN-Anweisung). Der zweite bekommt sofort „LAEUFT“, statt zu warten.
 *
 * `arbeit` muss den Stand innerhalb der Sperre frisch lesen (dmsGesendetAm) und
 * setzt ihn nach Erfolg ueber `tx` — so gibt der naechste Versuch erst nach dem
 * Festhalten wieder frei. Alle Lesezugriffe darin laufen ueber `tx` (keine zweite
 * Pool-Verbindung neben der wartenden Transaktion).
 *
 * Die Transaktion bleibt ueber den SMTP-Versand offen. Scheitert sie NACH der
 * angenommenen Mail (Zeitlimit ueberschritten, Festhalten wirft), rollt Prisma
 * zurueck, obwohl der Beleg draussen ist. Die Belegversender merken sich deshalb
 * den Versand und tragen `dmsGesendetAm` dann ausserhalb bedingt nach — statt
 * FEHLGESCHLAGEN zu melden und damit zum Nachsenden (zweiter Beleg) aufzufordern.
 */
export async function mitDmsSperre<T>(
  schluessel: string,
  arbeit: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T | "LAEUFT"> {
  return prisma.$transaction(
    async (tx): Promise<T | "LAEUFT"> => {
      const [sperre] = await tx.$queryRaw<{ frei: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${schluessel}, 0)) AS frei`;
      if (!sperre?.frei) return "LAEUFT";
      return arbeit(tx);
    },
    { timeout: DMS_SPERRE_ZEITLIMIT_MS },
  );
}

/**
 * Schickt einen Beleg als PDF-Anhang an die DMS-Adresse `an` (der Aufrufer
 * liest sie vorher über `dmsAdresse()` und meldet ihr Fehlen selbst). Liefert,
 * ob der Mailserver den Beleg angenommen hat; der Versand steht wie jede Mail im
 * Versandprotokoll. Keine Personennamen in den Betreff — er bliebe in
 * `email_versand` stehen.
 */
export async function sendeBelegAnDms(
  an: string,
  beleg: { betreff: string; text: string; dateiname: string; pdf: Buffer },
): Promise<boolean> {
  const ergebnis = await sendeMail({
    an,
    betreff: beleg.betreff,
    text: beleg.text,
    anhaenge: [{ dateiname: beleg.dateiname, inhalt: beleg.pdf, typ: "application/pdf" }],
  });
  return ergebnis.gesendet;
}
