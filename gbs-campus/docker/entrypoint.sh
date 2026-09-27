#!/bin/sh
# =============================================================================
# GBS Campus — Startskript des App-Containers
# Migrationen einspielen, dann den Server starten. Bricht ab, wenn die
# Migration fehlschlaegt — ein Start gegen ein halb migriertes Schema waere
# schlimmer als ein Container, der nicht hochkommt.
# =============================================================================
set -e

echo "[GBS] Datenbank-Migrationen werden eingespielt..."
prisma migrate deploy

# Rechtebeschraenkten Anwendungsnutzer (gbs_app) einrichten/aktualisieren — als
# Eigentuemer, NACH der Migration (dann sind alle Tabellen fuer die GRANTs da).
# Tut nichts, wenn APP_DB_PASSWORD nicht gesetzt ist (Opt-in). Ist es zu kurz
# oder enthaelt es etwas anderes als Buchstaben und Ziffern, bricht es den Start
# ab (set -e) — sonst schaltete der Server unten auf eine kaputte URL um.
echo "[GBS] Anwendungs-Datenbanknutzer wird eingerichtet (falls konfiguriert)..."
node prisma/setup-app-nutzer.js

# Der Seed ist idempotent und darf nicht uebersprungen werden: ohne die
# Statusmaschine schlaegt schon das Anlegen der ersten Person am Fremdschluessel
# fehl. Bricht er ab, soll der Container nicht starten (set -e greift).
echo "[GBS] Grunddaten werden gesetzt (Status, Rollen, Rechte, Vorlagen)..."
node prisma/seed.js

# Ab hier verbindet sich der Server als der rechtebeschraenkte Nutzer, sofern
# APP_DB_PASSWORD gesetzt ist. Migration, Setup und Seed liefen noch als
# Eigentuemer (sie brauchen DDL bzw. das Anlegen der Rolle) — der laufende Server
# braucht nur DML und soll deshalb nicht als Eigentuemer verbinden.
#
# Der Umschalter haengt am PASSWORT, nicht an APP_DATABASE_URL: docker-compose
# setzt die URL immer, bei leerem Passwort als "gbs_app:@db…". Das Setup oben
# legt die Rolle aber nur mit Passwort an. Am blossen Vorhandensein der URL
# umzuschalten hiesse, einen Server ohne jeden DB-Zugriff zu starten (Login,
# Anmeldung und Healthcheck fallen aus) — genau in dem Fall, fuer den die Doku
# „leer = es aendert sich nichts" zusagt.
if [ -n "${APP_DB_PASSWORD:-}" ] && [ -n "${APP_DATABASE_URL:-}" ]; then
  export DATABASE_URL="$APP_DATABASE_URL"
  # Das Eigentuemer-Passwort kommt ueber env_file (.env) mit in den Container,
  # gebraucht wird es hier aber nicht mehr (Migration, Setup und Seed sind
  # durch, der Server braucht nur DATABASE_URL). Bliebe es in der Umgebung, laege
  # es in process.env des Servers — wer dort Code ausfuehren kann, verbaende sich
  # als Eigentuemer, entfernte die Append-only-Trigger, und der Rechteentzug fuer
  # gbs_app waere wertlos.
  #
  # GRENZE: Das entfernt das Passwort NUR aus dem Serverprozess (PID 1). In der
  # Container-Konfiguration (Config.Env) bleiben DB_PASSWORD (env_file) und die
  # Eigentuemer-DATABASE_URL (docker-compose) stehen. Docker gibt sie jedem
  # Prozess mit, den es im Container startet — dem Healthcheck-curl alle 30 s und
  # jedem `docker exec` —, und die laufen als derselbe Nutzer wie der Server.
  # Code im Serverprozess kann sie deshalb ueber /proc/<pid>/environ solcher
  # Prozesse lesen. Vollstaendig trennt erst ein eigener Migrationsdienst mit
  # Eigentuemer-Zugang und ein App-Dienst, der nur die gbs_app-URL bekommt
  # (offene Entscheidung: macht gbs_app zur Pflicht). Der Durchstich haelt diesen
  # Rest sichtbar fest (Abschnitt 49).
  unset DB_PASSWORD
  echo "[GBS] Server verbindet sich als rechtebeschraenkter Anwendungsnutzer."
elif [ -n "${APP_DB_PASSWORD:-}" ]; then
  echo "[GBS] WARNUNG: APP_DB_PASSWORD ist gesetzt, APP_DATABASE_URL fehlt — Server bleibt am Eigentuemer-Zugang."
else
  echo "[GBS] APP_DB_PASSWORD nicht gesetzt — Server verbindet sich als Eigentuemer."
fi

echo "[GBS] Server startet auf Port ${PORT:-3000}."
exec node server.js
