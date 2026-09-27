/**
 * Läuft einmal beim Start des Servers, vor der ersten Anfrage.
 *
 * Zweck: Eine unvollständige Konfiguration soll den Start abbrechen, statt sich
 * später als „niemand kann sich anmelden" zu tarnen. Lieber ein Container, der
 * nicht hochkommt und im Log genau sagt warum, als einer, der läuft und alle
 * aussperrt.
 *
 * Nur in der Node-Laufzeit. Seit es src/middleware.ts gibt (Edge), kompiliert
 * Next diese Datei zusätzlich für Edge und ruft register() beim ersten
 * /api-Aufruf noch einmal in der Edge-Sandbox auf (Next 15.5.22,
 * server/web/adapter.js). Ohne die Weiche standen die Startmeldungen doppelt im
 * Log, und `next build` warnte vor process.exit in Edge-Code. Die Prüfung steht
 * deshalb IM if-Zweig und nicht hinter einem frühen `return`: Nur einen Zweig,
 * dessen Bedingung beim Build feststeht, lässt webpack für Edge ganz weg.
 */

import { dmsAdresse, pruefeKonfiguration, smtpKonfiguriert } from "@/lib/konfiguration";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
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
            ? " In Produktion bedeutet das: Es geht keine E-Mail raus, und es kommt niemand ohne" +
              " Passwort ins Portal. Der Healthcheck meldet das als Störung."
            : " Mails werden in die Konsole geschrieben statt verschickt."
        }\n`,
      );
    }

    if (!dmsAdresse()) {
      console.warn(
        "\n[START] DMS_EMAIL ist nicht gesetzt: Honorar-Belege und Zeugnis-Archivkopien werden erzeugt, aber nicht " +
          "an das DMS zugestellt — sie stehen als offen unter Verwaltung → Betrieb.\n",
      );
    }

    console.log("[START] Konfiguration vollständig.");
  }
}
