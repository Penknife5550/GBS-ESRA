/**
 * GBS Campus — getrennter, rechtebeschränkter Anwendungs-Datenbanknutzer
 *
 * Der Server verbindet sich in Produktion nicht mehr als Datenbank-Eigentümer,
 * sondern als `gbs_app`: nur Lesen/Schreiben (DML), kein DDL, und auf `audit_log`
 * und `einwilligungen` NUR Einfügen — kein UPDATE, kein DELETE. Damit hängt der
 * Append-only-Schutz nicht mehr allein am Trigger (den ein Eigentümer entfernen
 * könnte), sondern zusätzlich am entzogenen Recht. Genau das nennt die Migration
 * `20260727080000_audit_append_only` „den nächsten Härtungsschritt".
 *
 * Läuft im Entrypoint NACH `prisma migrate deploy` (als Eigentümer) — dann sind
 * alle Tabellen vorhanden, und die GRANTs treffen auch neu hinzugekommene. Der
 * Aufruf ist idempotent; er setzt das Passwort bei jedem Start neu (erlaubt
 * Rotation über die Umgebungsvariable).
 *
 * Opt-in: Ohne `APP_DB_PASSWORD` tut das Skript nichts und der Server bleibt am
 * Eigentümer-Zugang — so bricht ein Deploy nicht, nur weil die neue Variable noch
 * fehlt.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const passwort = process.env.APP_DB_PASSWORD;
  if (!passwort) {
    console.log("[GBS] APP_DB_PASSWORD nicht gesetzt — Anwendungsnutzer übersprungen, Server läuft am Eigentümer-Zugang.");
    return;
  }
  if (passwort.length < 16) {
    throw new Error("APP_DB_PASSWORD ist zu kurz (mindestens 16 Zeichen). Erzeugen mit: openssl rand -hex 24");
  }
  // Für das SQL-Literal: einfache Anführungszeichen verdoppeln. Der Wert kommt
  // aus der Umgebung (kein Nutzereingabe), ein Hex-/Base64-Passwort enthält
  // ohnehin keine; das ist die Absicherung gegen einen ungewöhnlichen Wert.
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

  console.log("[GBS] Anwendungsnutzer gbs_app eingerichtet: nur DML, audit_log/einwilligungen append-only.");
}

main()
  .catch((fehler) => {
    console.error("[GBS] Einrichtung des Anwendungsnutzers fehlgeschlagen:", fehler);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
