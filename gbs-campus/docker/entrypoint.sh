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
# Tut nichts, wenn APP_DB_PASSWORD nicht gesetzt ist (Opt-in).
echo "[GBS] Anwendungs-Datenbanknutzer wird eingerichtet (falls konfiguriert)..."
node prisma/setup-app-nutzer.js

# Der Seed ist idempotent und darf nicht uebersprungen werden: ohne die
# Statusmaschine schlaegt schon das Anlegen der ersten Person am Fremdschluessel
# fehl. Bricht er ab, soll der Container nicht starten (set -e greift).
echo "[GBS] Grunddaten werden gesetzt (Status, Rollen, Rechte, Vorlagen)..."
node prisma/seed.js

# Ab hier verbindet sich der Server als der rechtebeschraenkte Nutzer, sofern
# APP_DATABASE_URL gesetzt ist. Migration, Setup und Seed liefen noch als
# Eigentuemer (sie brauchen DDL bzw. das Anlegen der Rolle) — der laufende Server
# braucht nur DML und soll deshalb nicht als Eigentuemer verbinden.
if [ -n "${APP_DATABASE_URL:-}" ]; then
  export DATABASE_URL="$APP_DATABASE_URL"
  echo "[GBS] Server verbindet sich als rechtebeschraenkter Anwendungsnutzer."
fi

echo "[GBS] Server startet auf Port ${PORT:-3000}."
exec node server.js
