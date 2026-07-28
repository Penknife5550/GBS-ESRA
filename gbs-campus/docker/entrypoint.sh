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

# Der Seed ist idempotent und darf nicht uebersprungen werden: ohne die
# Statusmaschine schlaegt schon das Anlegen der ersten Person am Fremdschluessel
# fehl. Bricht er ab, soll der Container nicht starten (set -e greift).
echo "[GBS] Grunddaten werden gesetzt (Status, Rollen, Rechte, Vorlagen)..."
node prisma/seed.js

echo "[GBS] Server startet auf Port ${PORT:-3000}."
exec node server.js
