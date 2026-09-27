/**
 * GBS Campus — getrennter, rechtebeschränkter Anwendungs-Datenbanknutzer
 *
 * Der Server verbindet sich in Produktion nicht mehr als Datenbank-Eigentümer,
 * sondern als `gbs_app`: nur Lesen/Schreiben (DML), kein DDL, und auf `audit_log`,
 * `einwilligungen` und `einwilligungs_texte` NUR Einfügen — kein UPDATE, kein
 * DELETE. Damit hängt der Append-only-Schutz nicht mehr allein am Trigger (den
 * ein Eigentümer entfernen könnte), sondern zusätzlich am entzogenen Recht.
 * Genau das nennt die Migration `20260727080000_audit_append_only` „den
 * nächsten Härtungsschritt". Ebenso für die eingefrorenen Belege: kein DELETE
 * auf Honorarsätzen, Abrechnungsposten und Zeugnissen, kein UPDATE auf Posten.
 *
 * Läuft im Entrypoint NACH `prisma migrate deploy` (als Eigentümer) — dann sind
 * alle Tabellen vorhanden, und die GRANTs treffen auch neu hinzugekommene. Der
 * Aufruf ist idempotent; er setzt das Passwort bei jedem Start neu (erlaubt
 * Rotation über die Umgebungsvariable).
 *
 * Opt-in: Ohne `APP_DB_PASSWORD` tut das Skript nichts und der Server bleibt am
 * Eigentümer-Zugang — so bricht ein Deploy nicht, nur weil die neue Variable noch
 * fehlt. Der Entrypoint schaltet deshalb ebenfalls nur bei gesetztem Passwort auf
 * `gbs_app` um (nicht schon, weil `APP_DATABASE_URL` gesetzt ist): Ohne Passwort
 * gibt es die Rolle nicht, und der Server stünde ohne DB-Zugriff da.
 */

import { PrismaClient } from "@prisma/client";
import { pruefeAppDbPasswort } from "../src/lib/konfiguration";

const prisma = new PrismaClient();

async function main() {
  const passwort = process.env.APP_DB_PASSWORD;
  if (!passwort) {
    console.log("[GBS] APP_DB_PASSWORD nicht gesetzt — Anwendungsnutzer übersprungen, Server läuft am Eigentümer-Zugang.");
    return;
  }
  // Laut scheitern statt still umschalten: Mit einem Zeichen, das die unkodierte
  // APP_DATABASE_URL zerlegt (z. B. '/' oder '+' aus `openssl rand -base64`),
  // legte das Setup die Rolle an, der Entrypoint schaltete um, und der Server
  // stand ohne DB-Zugriff da. set -e im Entrypoint bricht den Start hier ab.
  const problem = pruefeAppDbPasswort(passwort);
  if (problem) {
    throw new Error(`APP_DB_PASSWORD ${problem}. Erzeugen mit: openssl rand -hex 24`);
  }
  // Für das SQL-Literal: einfache Anführungszeichen verdoppeln. Nach der
  // Prüfung oben kann keins mehr ankommen (nur Buchstaben und Ziffern); das
  // bleibt als zweite Absicherung stehen, falls die Prüfung je gelockert wird.
  const escaped = passwort.replace(/'/g, "''");

  // Rolle idempotent anlegen, Passwort/Login bei jedem Start setzen.
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'gbs_app') THEN
        CREATE ROLE gbs_app LOGIN;
      END IF;
    END
    $$;
  `);
  await prisma.$executeRawUnsafe(`ALTER ROLE gbs_app WITH LOGIN PASSWORD '${escaped}'`);

  // Nur DML, kein DDL. Auf alle jetzigen Tabellen/Sequenzen.
  await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO gbs_app`);
  await prisma.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gbs_app`);
  await prisma.$executeRawUnsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gbs_app`);

  // Append-only jetzt auch per Recht, nicht nur per Trigger: gbs_app darf
  // audit_log und einwilligungen lesen und ergänzen, aber nicht ändern/löschen.
  await prisma.$executeRawUnsafe(`REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM gbs_app`);
  await prisma.$executeRawUnsafe(`REVOKE UPDATE, DELETE, TRUNCATE ON einwilligungen FROM gbs_app`);
  // Dasselbe für die Einwilligungstexte, auf die erteilte Einwilligungen
  // verweisen (Trigger: Migration 20260927100000_einwilligungstexte_unveraenderlich).
  // Die App liest sie nur; neue Fassungen legt der Seed als Eigentümer an.
  await prisma.$executeRawUnsafe(`REVOKE UPDATE, DELETE, TRUNCATE ON einwilligungs_texte FROM gbs_app`);
  // Eingefrorene Belege (Trigger: Migration 20260927160000_belege_unveraenderlich).
  // Abrechnungsposten nur anlegen (Trigger: nur zu einer OFFENEN Abrechnung,
  // beim Commit summe = Summe der Posten): Sie verschwinden ausschließlich per
  // Cascade beim Storno einer OFFENEN Abrechnung — das führt Postgres als
  // Eigentümer der Tabelle aus, dafür braucht gbs_app kein DELETE. Honorarsätze
  // und Zeugnisse nie direkt löschen; UPDATE bleibt für die Nachträge, die der
  // Trigger zulässt (DMS-Versand, Statuswechsel, Anonymisierung). Auf
  // honorar_abrechnungen bleibt DELETE für den Storno (Trigger: nur OFFEN).
  // Grenze: Aus demselben Grund (Cascade als Eigentümer) verschwinden Zeugnisse
  // mit ihrer Person, wenn gbs_app eine Person löscht — das REVOKE unten sperrt
  // nur das direkte DELETE. Heute löscht kein Code Personen (Art. 17 =
  // Anonymisierung).
  await prisma.$executeRawUnsafe(`REVOKE UPDATE, DELETE, TRUNCATE ON honorar_abrechnung_posten FROM gbs_app`);
  await prisma.$executeRawUnsafe(`REVOKE DELETE, TRUNCATE ON honorar_saetze FROM gbs_app`);
  await prisma.$executeRawUnsafe(`REVOKE DELETE, TRUNCATE ON zeugnisse FROM gbs_app`);

  console.log(
    "[GBS] Anwendungsnutzer gbs_app eingerichtet: nur DML, audit_log/einwilligungen append-only, Einwilligungstexte nur lesbar/ergänzbar, eingefrorene Belege nicht löschbar.",
  );
}

main()
  .catch((fehler) => {
    console.error("[GBS] Einrichtung des Anwendungsnutzers fehlgeschlagen:", fehler);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
