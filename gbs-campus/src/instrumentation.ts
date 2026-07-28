/**
 * Läuft einmal beim Start des Servers, vor der ersten Anfrage.
 *
 * Zweck: Eine unvollständige Konfiguration soll den Start abbrechen, statt sich
 * später als „niemand kann sich anmelden" zu tarnen. Lieber ein Container, der
 * nicht hochkommt und im Log genau sagt warum, als einer, der läuft und alle
 * aussperrt.
 */

import { pruefeKonfiguration, smtpKonfiguriert } from "@/lib/konfiguration";

export async function register() {
  const befunde = pruefeKonfiguration();

  if (befunde.length > 0) {
    console.error("\n[START] Die Konfiguration ist unvollständig:\n");
    for (const b of befunde) console.error(`  ${b.name}: ${b.problem}`);
    console.error("\nSiehe .env.example. Der Server wird nicht gestartet.\n");
    process.exit(1);
  }

  if (!smtpKonfiguriert()) {
    const inProduktion = process.env.NODE_ENV === "production";
    console.warn(
      `\n[START] SMTP ist nicht konfiguriert (SMTP_HOST / MAIL_ABSENDER_ADRESSE).${
        inProduktion
          ? " In Produktion bedeutet das: Es geht keine E-Mail raus, und da der Magic-Link" +
            " der einzige Zugang ist, kommt niemand ins Portal. Der Healthcheck meldet das als Störung."
          : " Mails werden in die Konsole geschrieben statt verschickt."
      }\n`,
    );
  }

  console.log("[START] Konfiguration vollständig.");
}
