#!/bin/bash
# =============================================================================
# GBS Campus — Durchstich fuer Semester, Teilnehmerliste und Excel-Export
#
# Laeuft gegen das gebaute Image und eine FRISCHE Datenbank. Prueft die Kette
# vom Semester ueber die Anmeldung und die Aufnahme bis zur Excel-Datei.
#
# Kalenderunabhaengig (Code-Review 4, M19): Jedes Datum ist relativ zum heutigen
# Berliner Kalendertag gerechnet, jeder Abend mit Vergangenheits- oder
# Zukunftsbezug ist ein eigener, per Id referenzierter Termin. Der Lauf muss an
# jedem Tag des Jahres dasselbe Ergebnis liefern.
# =============================================================================
set -u

DBNAME=gbs_durchstich
PORT=3100
BASIS="http://localhost:${PORT}"
PSQL="docker exec -i gbs-campus-db-dev psql -U gbs -d ${DBNAME} -tAqc"

ok=0
fehler=0
pruefe() {
  if [ "$2" = "1" ]; then
    echo "  ok    $1"
    ok=$((ok + 1))
  else
    echo "  FEHLT $1  ${3:-}"
    fehler=$((fehler + 1))
  fi
}
# Leere Werte gelten nie als Treffer — sonst besteht eine Pruefung, weil beide
# Seiten leer sind, und meldet Erfolg, wo gar nichts passiert ist.
gleich() { [ -n "$1" ] && [ "$1" = "$2" ] && echo 1 || echo 0; }

# Suche in einem Text, der auch leer sein koennte — beide Richtungen.
#
# Genau daran ist die Excel-Pruefung vorbeigelaufen: Schlug `unzip` fehl, war
# der Inhalt leer, und `grep -q 'DE89'` fand erwartungsgemaess nichts. Die
# Pruefung meldete „KEINE IBAN in der Datei", obwohl sie gar keine Datei gesehen
# hatte. Ein leerer Inhalt gilt hier deshalb immer als Fehlschlag, auch bei der
# negativen Suche.
enthaelt() { # $1 = Inhalt, $2 = Muster
  [ -n "$1" ] || { echo 0; return; }
  echo "$1" | grep -q "$2" && echo 1 || echo 0
}
fehlt_in() { # $1 = Inhalt, $2 = Muster — leerer Inhalt beweist nichts
  [ -n "$1" ] || { echo 0; return; }
  echo "$1" | grep -q "$2" && echo 0 || echo 1
}

# Kalender (Code-Review 4, M19). Frueher begann das Testsemester fest am
# 15.09.2026, und die Honorar- und Dozentenabschnitte waehlten ihre Abende ueber
# `beginn <= now() order by beginn` — seit dem 22.09.2026 kippten damit die
# Vorbedingungen, ab Februar 2027 auch die Semesterueberleitung (Ziel 2027-F
# hatte dann begonnen). Gerechnet wird in der Datenbank und ausdruecklich im
# Berliner Kalender — derselbe Tag, den `alsHeutigerTag` im Container bildet —,
# damit weder die Zeitzone noch das `date` des aufrufenden Rechners (BSD/GNU)
# hineinspielen.
tag() { # $1 = Versatz in Tagen (z. B. 14 oder -60) -> „JJJJ-MM-TT“
  docker exec -i gbs-campus-db-dev psql -U gbs -d postgres -tAqc \
    "select to_char((now() at time zone 'Europe/Berlin')::date + (${1}), 'YYYY-MM-DD');"
}
tag_de() { # wie tag, aber „TT.MM.JJJJ“ — so nennen Antworten und Mails Fristen
  docker exec -i gbs-campus-db-dev psql -U gbs -d postgres -tAqc \
    "select to_char((now() at time zone 'Europe/Berlin')::date + (${1}), 'DD.MM.YYYY');"
}

# Token wie im System: Klartext nur hier, in der Datenbank der SHA-256-Hash.
neuer_token() { uuidgen | tr 'A-Z' 'a-z'; }
hash_von() { printf %s "$1" | shasum -a 256 | cut -d' ' -f1; }

# Meldet eine Person ueber einen frisch gesetzten Anmeldelink an und gibt das
# Sitzungscookie aus (wie in den Abschnitten 3, 9 und 28 von Hand).
anmelden_als() { # $1 = personId
  local token
  token=$(neuer_token)
  $PSQL "insert into magic_links (id, \"personId\", \"tokenHash\", \"laeuftAb\", \"erstelltAm\") values (gen_random_uuid(), '$1', '$(hash_von "$token")', now() + interval '1 hour', now());" > /dev/null
  curl -s -D - -o /dev/null -X POST "${BASIS}/api/auth/token" -H 'Content-Type: application/json' -d "{\"token\":\"${token}\"}" \
    | grep -i '^set-cookie:' | head -1 | sed 's/^[^:]*: //' | cut -d';' -f1
}

# Legt eine Person ohne Rolle an und gibt ihre Id aus. Die Adresse entsteht aus
# dem Namen (vorname.nachname@beispiel.de) — Namen deshalb eindeutig waehlen.
person_anlegen() { # $1 Vorname, $2 Nachname, $3 Status, $4 Teilnahmeform (leer = keine)
  local form="null"
  [ -n "${4:-}" ] && form="'$4'"
  $PSQL "insert into personen (id, vorname, nachname, email, \"statusCode\", teilnahmeform, \"erstelltAm\", \"aktualisiertAm\") values (gen_random_uuid(), '$1', '$2', '$(printf '%s.%s@beispiel.de' "$1" "$2" | tr 'A-Z' 'a-z')', '$3', ${form}, now(), now()) returning id;"
}

# Nur der Statuscode; bzw. der Statuscode mit dem Rumpf in /tmp/gbs-rumpf.txt.
status_von() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
rumpf_und_status() { curl -s -o /tmp/gbs-rumpf.txt -w '%{http_code}' "$@"; }

# Datenbank-Sperren, als Eigentuemer gbs geprueft (psql -c endet bei einem
# SQL-Fehler mit Exit 1):
#  - abgewiesen: scheitert mit der Meldung der Unveraenderlichkeits-Trigger
#    („… ist nicht zulaessig") — nicht nur irgendwie.
#  - laeuft_durch / scheitert: nur der Ausgang.
abgewiesen() { $PSQL "$1" 2>&1 | grep -q 'ist nicht zulaessig' && echo 1 || echo 0; }

# IBAN-Stuecke der Testdaten (DE89…, DE02…, AT61…) fuer die Suche in Protokollen
# und Belegen — als Postgres-Regex (~, Gross-/Kleinschreibung beachtet) und lang
# genug, dass sie weder in UUIDs (klein geschrieben) noch im 8-stelligen
# Hex-Suffix der Beleg-Nrn zufaellig vorkommen. Ein blosses ilike '%DE89%' traf
# in rund 1-2 % der Laeufe eine UUID oder Beleg-Nr und meldete eine IBAN, die es
# nicht gab. Mit und ohne Leerzeichen (normalisiert gespeicherte IBAN).
IBAN_MUSTER='(DE89 ?3704|DE02 ?1203|AT61 ?1904|0532 ?0130)'
laeuft_durch() { $PSQL "$1" > /dev/null 2>&1 && echo 1 || echo 0; }
scheitert() { $PSQL "$1" > /dev/null 2>&1 && echo 0 || echo 1; }

# Vollstaendige, gueltige Anmeldung wie in Abschnitt 5 — fuer weitere Personen.
# Das Fangfeld `hp_feld` schickt das echte Formular immer mit (leer).
anmeldung_rumpf() { # $1 Vorname, $2 Nachname, $3 E-Mail, $4 Geburtsdatum, $5 Fangfeld
  cat <<JSON
{
  "aktion": "absenden", "versionId": "${VERSION_ID}", "hp_feld": "${5:-}",
  "einwilligungen": ["DATENSCHUTZ", "GLAUBENSANGABEN"],
  "antworten": {
    "anrede": "Frau",
    "vorname": "${1}", "nachname": "${2}", "geburtsdatum": "${4}",
    "strasse": "Testweg 5", "plz": "32423", "ort": "Minden",
    "email": "${3}", "telefon": "0571 555666",
    "schulabschluss": "Abitur", "erlernter_beruf": "Buchhalterin", "derzeitiger_beruf": "Buchhalterin",
    "glaube_bekenntnis": "Ja.", "glaube_werdegang": "Seit der Jugend.",
    "gemeinde_mitglied": "Gemeinde am Test", "gemeinde_beteiligung": "Woechentlich.",
    "dienst_erfahrung": "Hauskreis.",
    "motivation": "Vertiefung.", "ziele": "Bibelkenntnis.",
    "teilnahmeform": "Als Schüler — mit Prüfungen",
    "kontoinhaber": "${1} ${2}", "iban": "DE89 3704 0044 0532 0130 00",
    "bank_name": "Sparkasse", "einzug_einverstanden": true, "zahlweise": "Monatlich"
  }
}
JSON
}

echo "=== Frische Datenbank ==="
docker exec -i gbs-campus-db-dev psql -U gbs -d postgres \
  -c "DROP DATABASE IF EXISTS ${DBNAME} WITH (FORCE);" \
  -c "CREATE DATABASE ${DBNAME} OWNER gbs;" > /dev/null

echo "=== Container starten (Migration + Seed laufen im Entrypoint) ==="
docker rm -f gbs-durchstich > /dev/null 2>&1
# APP_DB_PASSWORD/APP_DATABASE_URL gesetzt: der Entrypoint richtet gbs_app ein und
# der laufende Server verbindet sich als dieser rechtebeschraenkte Nutzer — der
# ganze Durchstich laeuft also gegen die App als gbs_app, nicht als Eigentuemer.
# DB_PASSWORD bildet nach, was env_file (.env) im Betrieb mitbringt: Der
# Entrypoint muss es vor dem Serverstart entfernen (Abschnitt 49 prueft das).
APP_PW=$(openssl rand -hex 24)
docker run -d --name gbs-durchstich -p ${PORT}:3000 \
  -e DATABASE_URL="postgresql://gbs:gbs_dev_2026@host.docker.internal:5434/${DBNAME}?schema=public" \
  -e DB_PASSWORD="gbs_dev_2026" \
  -e APP_DB_PASSWORD="${APP_PW}" \
  -e APP_DATABASE_URL="postgresql://gbs_app:${APP_PW}@host.docker.internal:5434/${DBNAME}?schema=public" \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  -e APP_URL="https://durchstich.example.org" \
  -e TZ=Europe/Berlin \
  gbs-campus-test:local > /dev/null

# Der Healthcheck meldet ohne SMTP absichtlich eine Stoerung (503) — geprueft
# wird deshalb, ob ueberhaupt geantwortet wird, nicht der Statuscode.
for i in $(seq 1 60); do
  KOPF=$(curl -s -o /dev/null -w '%{http_code}' "${BASIS}/api/health" 2>/dev/null)
  [ "$KOPF" != "000" ] && break
  sleep 2
done
pruefe "Container antwortet" "$([ "$KOPF" != "000" ] && echo 1 || echo 0)" "HTTP ${KOPF}"

# Schutz vor Massenanmeldungen (lib/anmelde-schutz.ts): Der Seed legt die drei
# Regler mit ihren Standardwerten an. Die folgenden Abschnitte schicken
# Anmeldungen per curl ohne Formularstempel und dicht hintereinander ab — fuer
# den Lauf werden Mindestdauer und Gesamtgrenzen deshalb gelockert; Abschnitt 50
# schaltet sie einzeln scharf.
ANMELDESCHUTZ="select string_agg(wert, '/' order by schluessel collate \"C\") from einstellungen where schluessel in ('ANMELDUNG_MAX_GESAMT_STUNDE', 'ANMELDUNG_MAX_GESAMT_TAG', 'ANMELDUNG_MINDESTDAUER_SEKUNDEN');"
pruefe "der Seed legt den Anmeldeschutz mit Standardwerten an (10/30/3)" "$(gleich "$($PSQL "$ANMELDESCHUTZ")" "10/30/3")" "$($PSQL "$ANMELDESCHUTZ")"
$PSQL "update einstellungen set wert = case schluessel when 'ANMELDUNG_MAX_GESAMT_STUNDE' then '500' when 'ANMELDUNG_MAX_GESAMT_TAG' then '2000' else '0' end where schluessel in ('ANMELDUNG_MAX_GESAMT_STUNDE', 'ANMELDUNG_MAX_GESAMT_TAG', 'ANMELDUNG_MINDESTDAUER_SEKUNDEN');" > /dev/null
pruefe "fuer den Lauf gelockert (500/2000/0)" "$(gleich "$($PSQL "$ANMELDESCHUTZ")" "500/2000/0")" "$($PSQL "$ANMELDESCHUTZ")"

echo
echo "=== 0. Datumsannahmen (kalenderunabhaengig) ==="
# Alles Folgende rechnet mit diesen Werten. Stimmt hier etwas nicht, sind die
# spaeteren Datumspruefungen wertlos — deshalb zuerst und ausdruecklich.
HEUTE=$(tag 0)
pruefe "der heutige Berliner Kalendertag ist bestimmt" \
  "$(echo "$HEUTE" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' && echo 1 || echo 0)" "$HEUTE"
CONTAINER_TAG=$(docker exec gbs-durchstich date +%F 2>/dev/null)
pruefe "der Container rechnet mit demselben Kalendertag (TZ Europe/Berlin)" \
  "$(gleich "$CONTAINER_TAG" "$HEUTE")" "${CONTAINER_TAG} / ${HEUTE}"
# Prisma schreibt Zeitpunkte als UTC in `timestamp`-Spalten; das Skript setzt
# sie mit now(). Beides passt nur zusammen, wenn die Sitzung in UTC rechnet.
pruefe "die Datenbank rechnet in UTC (now() im Skript passt zu Prisma)" \
  "$(gleich "$($PSQL "select now()::timestamp = (now() at time zone 'UTC');")" "t")"
# Das Testsemester beginnt in zwei Wochen — wie beim Schreiben dieses Skripts,
# als der 15.09.2026 noch bevorstand: Alle generierten Abende liegen in der
# Zukunft, und das Anmeldefenster schliesst heute ein.
SEM_START=$(tag 14); SEM_ENDE=$(tag 180); ANM_VON=$(tag -60); ANM_BIS=$(tag 13)
pruefe "Testsemester beginnt nach heute, das Anmeldefenster schliesst heute ein" \
  "$([ "$SEM_START" \> "$HEUTE" ] && [ "$ANM_VON" \< "$HEUTE" ] && [ "$ANM_BIS" \> "$HEUTE" ] && echo 1 || echo 0)" \
  "Fenster ${ANM_VON} bis ${ANM_BIS}, Beginn ${SEM_START}"
# Der Startpruefer steht in instrumentation.ts nur im Node-Zweig; ohne die
# Weiche liefe er beim ersten /api-Aufruf ein zweites Mal in der Edge-Sandbox.
# Die Health-Schleife oben hat /api schon aufgerufen.
pruefe "die Startpruefung laeuft genau einmal (nicht zusaetzlich in Edge)" \
  "$(gleich "$(docker logs gbs-durchstich 2>&1 | grep -c 'Konfiguration vollständig')" "1")"

echo
echo "=== 1. Schema ==="
pruefe "Spalte anmeldungen.semesterId existiert" \
  "$(gleich "$($PSQL "select data_type from information_schema.columns where table_name='anmeldungen' and column_name='semesterId';")" "text")"
pruefe "Index auf semesterId existiert" \
  "$(gleich "$($PSQL "select count(*) from pg_indexes where tablename='anmeldungen' and indexname='anmeldungen_semesterId_idx';")" "1")"
pruefe "Fremdschluessel loescht nicht mit (SET NULL)" \
  "$(gleich "$($PSQL "select confdeltype from pg_constraint where conname='anmeldungen_semesterId_fkey';")" "n")"
pruefe "Migration ist als angewendet eingetragen" \
  "$(gleich "$($PSQL "select count(*) from _prisma_migrations where migration_name='20260727170000_anmeldung_semesterbezug' and finished_at is not null;")" "1")"
pruefe "genau ein laufendes Semester ist per Index abgesichert" \
  "$(gleich "$($PSQL "select count(*) from pg_indexes where tablename='semester' and indexname='semester_genau_ein_aktuelles';")" "1")"
pruefe "die fuenf Migrationen aus Code-Review 4 sind eingespielt" \
  "$(gleich "$($PSQL "select count(*) from _prisma_migrations where finished_at is not null and migration_name in ('20260927100000_einwilligungstexte_unveraenderlich','20260927110000_teilnahme_rueckmeldung','20260927130000_versandprotokoll_betreff_ohne_namen','20260927160000_belege_unveraenderlich','20260927160500_leistung_kurseinheit_restrict');")" "5")"

echo
echo "=== 2. Seed: Recht und Rollen ==="
pruefe "Recht SEMESTER_VERWALTEN existiert" \
  "$(gleich "$($PSQL "select count(*) from rechte where code='SEMESTER_VERWALTEN';")" "1")"
pruefe "Schulleitung und Verwaltung haben das Recht" \
  "$(gleich "$($PSQL "select count(*) from rolle_recht where \"rechtCode\"='SEMESTER_VERWALTEN';")" "2")"
pruefe "Teilnehmer hat das Recht NICHT" \
  "$(gleich "$($PSQL "select count(*) from rolle_recht where \"rechtCode\"='SEMESTER_VERWALTEN' and \"rolleCode\"='TEILNEHMER';")" "0")"

echo
echo "=== 3. Anmeldung als Schulleitung ==="
SCHULLEITER_ID=$($PSQL "insert into personen (id, vorname, nachname, email, \"statusCode\", \"erstelltAm\", \"aktualisiertAm\") values (gen_random_uuid(), 'Peter', 'Leiter', 'leiter@beispiel.de', 'AKTIV', now(), now()) returning id;")
$PSQL "insert into person_rolle (\"personId\", \"rolleCode\") values ('${SCHULLEITER_ID}', 'SCHULLEITER');" > /dev/null

TOKEN=$(uuidgen | tr 'A-Z' 'a-z')
HASH=$(printf %s "$TOKEN" | shasum -a 256 | cut -d' ' -f1)
$PSQL "insert into magic_links (id, \"personId\", \"tokenHash\", \"laeuftAb\", \"erstelltAm\") values (gen_random_uuid(), '${SCHULLEITER_ID}', '${HASH}', now() + interval '1 hour', now());" > /dev/null

curl -s -D /tmp/gbs-kopf.txt -o /dev/null -X POST "${BASIS}/api/auth/token" \
  -H 'Content-Type: application/json' -d "{\"token\":\"${TOKEN}\"}"
KEKS=$(grep -i '^set-cookie:' /tmp/gbs-kopf.txt | head -1 | sed 's/^[^:]*: //' | cut -d';' -f1)
pruefe "Anmeldelink wird gegen eine Sitzung eingeloest" "$([ -n "$KEKS" ] && echo 1 || echo 0)"

echo
echo "=== 4. Semester anlegen ==="
# Test-Code 2099-H, damit er NICHT mit den sechs echten Semestern kollidiert, die
# der Seed jetzt anlegt (2026-H … 2029-F). Das Anmeldefenster (heute innerhalb)
# macht dieses Semester zum Ziel der eingehenden Anmeldung in Abschnitt 5. Alle
# Daten relativ zu heute (Abschnitt 0): Beginn in zwei Wochen.
ANTWORT=$(curl -s -X POST "${BASIS}/api/semester" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d "{\"code\":\"2099-H\",\"bezeichnung\":\"Testsemester 2099\",\"start\":\"${SEM_START}\",\"ende\":\"${SEM_ENDE}\",\"anmeldungVon\":\"${ANM_VON}\",\"anmeldungBis\":\"${ANM_BIS}\",\"istAktuell\":true}")
SEMESTER_ID=$(echo "$ANTWORT" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
pruefe "Semester wird angelegt" "$([ -n "$SEMESTER_ID" ] && echo 1 || echo 0)" "$ANTWORT"
pruefe "Semester ist das laufende" \
  "$(gleich "$($PSQL "select count(*) from semester where \"istAktuell\" = true;")" "1")"

MANGEL=$(curl -s -X POST "${BASIS}/api/semester" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d "{\"code\":\"2027-F\",\"bezeichnung\":\"Fruehjahr\",\"start\":\"$(tag 200)\",\"ende\":\"$(tag 100)\"}")
pruefe "Ende vor Beginn wird abgewiesen" "$(echo "$MANGEL" | grep -qc 'nach seinem Beginn' 2>/dev/null && echo 1 || echo 0)" "$MANGEL"

DOPPELT=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/semester" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d "{\"code\":\"2099-H\",\"bezeichnung\":\"Noch einmal\",\"start\":\"${SEM_START}\",\"ende\":\"${SEM_ENDE}\"}")
pruefe "doppeltes Kuerzel wird mit 409 abgewiesen" "$(gleich "$DOPPELT" "409")" "$DOPPELT"

echo
echo "=== 5. Oeffentliche Anmeldung bekommt den Semesterbezug ==="
VERSION_ID=$($PSQL "select id from formular_versionen where status='VEROEFFENTLICHT' order by version desc limit 1;")
EINREICHEN=$(curl -s -X POST "${BASIS}/api/anmeldung" -H 'Content-Type: application/json' -H 'X-Real-Ip: 203.0.113.9' -d "{
  \"aktion\": \"absenden\",
  \"versionId\": \"${VERSION_ID}\",
  \"einwilligungen\": [\"DATENSCHUTZ\", \"GLAUBENSANGABEN\"],
  \"antworten\": {
    \"anrede\": \"Frau\",
    \"vorname\": \"Petra\", \"nachname\": \"Beispiel\", \"geburtsdatum\": \"1990-05-04\",
    \"strasse\": \"Hauptstr. 1\", \"plz\": \"32423\", \"ort\": \"Minden\",
    \"email\": \"petra@beispiel.de\", \"telefon\": \"0571 123456\",
    \"schulabschluss\": \"Abitur\", \"erlernter_beruf\": \"Erzieherin\", \"derzeitiger_beruf\": \"Erzieherin\",
    \"glaube_bekenntnis\": \"Ja, aus Ueberzeugung.\", \"glaube_werdegang\": \"Als Jugendliche zum Glauben gekommen.\",
    \"gemeinde_mitglied\": \"FeG Minden\", \"gemeinde_beteiligung\": \"Woechentlich, Kindergottesdienst.\",
    \"dienst_erfahrung\": \"Kindergottesdienst seit 2015.\",
    \"motivation\": \"Ich moechte die Bibel besser verstehen.\", \"ziele\": \"Die Bibel im Zusammenhang verstehen.\",
    \"teilnahmeform\": \"Als Schüler — mit Prüfungen\",
    \"kontoinhaber\": \"Petra Beispiel\", \"iban\": \"DE89 3704 0044 0532 0130 00\",
    \"bank_name\": \"Sparkasse Minden-Luebbecke\", \"einzug_einverstanden\": true, \"zahlweise\": \"Halbjährlich\"
  }
}")
pruefe "Anmeldung wird angenommen" "$(echo "$EINREICHEN" | grep -qc 'eingereicht' 2>/dev/null && echo 1 || echo 0)" "$EINREICHEN"
pruefe "Anmeldung haengt am angelegten Semester" \
  "$(gleich "$($PSQL "select \"semesterId\" from anmeldungen where status='EINGEREICHT' limit 1;")" "$SEMESTER_ID")"
pruefe "IBAN steht NICHT im Antwort-JSON" \
  "$(gleich "$($PSQL "select count(*) from anmeldungen where antworten::text ilike '%DE89%';")" "0")"

echo
echo "=== 6. Aufnahme legt die Teilnahme an ==="
ANMELDUNG_ID=$($PSQL "select id from anmeldungen where status='EINGEREICHT' limit 1;")
ENTSCHEIDUNG=$(curl -s -X POST "${BASIS}/api/anmeldungen/${ANMELDUNG_ID}/entscheiden" -H "Cookie: ${KEKS}" \
  -H 'Content-Type: application/json' -d '{"entscheidung":"ANNEHMEN"}')
pruefe "Aufnahme meldet die Semesterzuordnung" "$(echo "$ENTSCHEIDUNG" | grep -qc '"semesterZugeordnet":true' 2>/dev/null && echo 1 || echo 0)" "$ENTSCHEIDUNG"
pruefe "Teilnahme im Semester ist angelegt" \
  "$(gleich "$($PSQL "select count(*) from teilnahmen where \"semesterId\"='${SEMESTER_ID}';")" "1")"
pruefe "Teilnahmeform wurde uebernommen" \
  "$(gleich "$($PSQL "select \"teilnahmeform\" from teilnahmen where \"semesterId\"='${SEMESTER_ID}' limit 1;")" "SCHUELER")"

echo
echo "=== 7. Sammeluebernahme ==="
HOERER_ID=$($PSQL "insert into personen (id, vorname, nachname, email, \"statusCode\", teilnahmeform, \"erstelltAm\", \"aktualisiertAm\") values (gen_random_uuid(), 'Hans', 'Hoerer', 'hans@beispiel.de', 'ANGENOMMEN', 'HOERER', now(), now()) returning id;")
OHNE_ID=$($PSQL "insert into personen (id, vorname, nachname, email, \"statusCode\", \"erstelltAm\", \"aktualisiertAm\") values (gen_random_uuid(), 'Ohne', 'Form', 'ohne@beispiel.de', 'ANGENOMMEN', now(), now()) returning id;")
# Beide bekommen die Rolle Teilnehmer — genau das tut die Anmeldung auch.
$PSQL "insert into person_rolle (\"personId\", \"rolleCode\") values ('${HOERER_ID}', 'TEILNEHMER'), ('${OHNE_ID}', 'TEILNEHMER');" > /dev/null
UEBERNAHME=$(curl -s -X POST "${BASIS}/api/semester/${SEMESTER_ID}/teilnehmer" -H "Cookie: ${KEKS}")
pruefe "Hoerer wird uebernommen" "$(echo "$UEBERNAHME" | grep -qc '"uebernommen":1' 2>/dev/null && echo 1 || echo 0)" "$UEBERNAHME"
# Genau 1: die Person ohne Teilnahmeform wird gemeldet statt geraten — und die
# Schulleitung (aktiv, ohne Teilnahmeform, ohne Rolle Teilnehmer) taucht hier
# NICHT auf.
pruefe "Person ohne Teilnahmeform wird gemeldet, Schulleitung nicht mitgezaehlt" "$(echo "$UEBERNAHME" | grep -qc '"ohneTeilnahmeform":1' 2>/dev/null && echo 1 || echo 0)" "$UEBERNAHME"
NOCHMAL=$(curl -s -X POST "${BASIS}/api/semester/${SEMESTER_ID}/teilnehmer" -H "Cookie: ${KEKS}")
pruefe "zweiter Klick legt nichts doppelt an" "$(echo "$NOCHMAL" | grep -qc '"uebernommen":0' 2>/dev/null && echo 1 || echo 0)" "$NOCHMAL"

echo
echo "=== 8. Excel-Export ==="
STATUS=$(curl -s -o /tmp/gbs-liste.xlsx -w '%{http_code}' "${BASIS}/api/semester/${SEMESTER_ID}/export" -H "Cookie: ${KEKS}")
pruefe "Export antwortet mit 200" "$(gleich "$STATUS" "200")"
pruefe "Datei ist eine echte Excel-Mappe" "$(file /tmp/gbs-liste.xlsx | grep -qc 'Zip\|Excel' 2>/dev/null && echo 1 || echo 0)"
# Das GANZE Archiv auspacken, nicht nur xl/sharedStrings.xml: Wer den Export auf
# Inline-Strings umstellt (exceljs kann das), schreibt die Werte direkt in
# xl/worksheets/sheet1.xml — die Datei mit den Namen waere dann leer, und eine
# IBAN darin fiele niemandem auf. `unzip -p` ohne Dateinamen gibt alle Eintraege
# hintereinander aus.
INHALT=$(unzip -p /tmp/gbs-liste.xlsx 2>/dev/null)
# Erst der Beweis, dass ueberhaupt etwas ausgepackt wurde. Ohne ihn haengen alle
# folgenden Zeilen in der Luft — besonders die verneinenden.
pruefe "der Inhalt der Mappe ist lesbar" "$([ -n "$INHALT" ] && echo 1 || echo 0)"
pruefe "beide Teilnehmer stehen in der Datei" "$(enthaelt "$INHALT" 'Beispiel')"
pruefe "der Hoerer steht in der Datei" "$(enthaelt "$INHALT" 'Hoerer')"
pruefe "KEINE deutsche IBAN in der Datei" "$(fehlt_in "$INHALT" 'DE89')"
# Auch die oesterreichische Form: `/DE\d{2}/` als einziger Waechter haette eine
# AT-, CH- oder NL-IBAN anstandslos durchgelassen.
pruefe "KEINE auslaendische IBAN in der Datei" "$(fehlt_in "$INHALT" 'AT61')"
pruefe "Person ohne Teilnahmeform fehlt (nicht uebernommen)" "$(fehlt_in "$INHALT" 'Ohne')"

echo
echo "=== 9. Rechte greifen ==="
TEILNEHMER_ID=$($PSQL "select id from personen where email='petra@beispiel.de';")
TOKEN2=$(uuidgen | tr 'A-Z' 'a-z')
HASH2=$(printf %s "$TOKEN2" | shasum -a 256 | cut -d' ' -f1)
$PSQL "insert into magic_links (id, \"personId\", \"tokenHash\", \"laeuftAb\", \"erstelltAm\") values (gen_random_uuid(), '${TEILNEHMER_ID}', '${HASH2}', now() + interval '1 hour', now());" > /dev/null
curl -s -D /tmp/gbs-kopf2.txt -o /dev/null -X POST "${BASIS}/api/auth/token" -H 'Content-Type: application/json' -d "{\"token\":\"${TOKEN2}\"}"
KEKS2=$(grep -i '^set-cookie:' /tmp/gbs-kopf2.txt | head -1 | sed 's/^[^:]*: //' | cut -d';' -f1)

S1=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/semester" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' -d "{\"code\":\"X-1\",\"bezeichnung\":\"Fremd\",\"start\":\"${SEM_START}\",\"ende\":\"${SEM_ENDE}\"}")
pruefe "Teilnehmer darf kein Semester anlegen (403)" "$(gleich "$S1" "403")" "$S1"
S2=$(curl -s -o /dev/null -w '%{http_code}' "${BASIS}/api/semester/${SEMESTER_ID}/export" -H "Cookie: ${KEKS2}")
pruefe "Teilnehmer darf nicht exportieren (403)" "$(gleich "$S2" "403")" "$S2"
# Ohne Sitzung ist das „nicht angemeldet" (401), nicht „keine Berechtigung" —
# seit Code-Review 4 unterscheidet `pruefeZugriff` beides.
S3=$(curl -s -o /dev/null -w '%{http_code}' "${BASIS}/api/semester/${SEMESTER_ID}/export")
pruefe "ohne Anmeldung kein Export (401)" "$(gleich "$S3" "401")" "$S3"
# Derselbe Link im Browser (Accept: text/html): zur Anmeldung statt rohem JSON,
# bzw. eine deutsche Fehlerseite.
S3_HTML=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -H 'Accept: text/html' "${BASIS}/api/semester/${SEMESTER_ID}/export")
pruefe "im Browser ohne Sitzung: 303 zur Anmeldung" "$(echo "$S3_HTML" | grep -q '^303 .*/anmelden$' && echo 1 || echo 0)" "$S3_HTML"
S2_HTML=$(curl -s -o /dev/null -w '%{http_code} %{content_type}' -H 'Accept: text/html' "${BASIS}/api/semester/${SEMESTER_ID}/export" -H "Cookie: ${KEKS2}")
pruefe "im Browser mit Teilnehmer-Sitzung: 403 als Fehlerseite (text/html)" "$(echo "$S2_HTML" | grep -q '^403 text/html' && echo 1 || echo 0)" "$S2_HTML"

echo
echo "=== 10. Selbstpflege der eigenen Akte ==="
SEITE=$(curl -s -o /dev/null -w '%{http_code}' "${BASIS}/meine-daten" -H "Cookie: ${KEKS2}")
pruefe "Teilnehmer sieht die eigene Akte (200)" "$(gleich "$SEITE" "200")" "$SEITE"
UMLEITUNG=$(curl -s -o /dev/null -w '%{http_code}' "${BASIS}/verwaltung" -H "Cookie: ${KEKS2}")
pruefe "Teilnehmer wird vom Verwaltungsbereich weggeleitet (307)" "$(gleich "$UMLEITUNG" "307")" "$UMLEITUNG"

IBAN_VORHER=$($PSQL "select \"ibanVerschluesselt\" from personen where id='${TEILNEHMER_ID}';")
SPEICHERN=$(curl -s -X PUT "${BASIS}/api/meine-daten" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' \
  -d '{"telefon":"0571 999888","strasse":"Neue Straße 7","plz":"32425","ort":"Porta Westfalica","kontoinhaber":"Petra Beispiel","iban":null}')
pruefe "Adressaenderung wird gespeichert" "$(echo "$SPEICHERN" | grep -qc 'Straße' 2>/dev/null && echo 1 || echo 0)" "$SPEICHERN"
pruefe "neue Strasse steht in der Akte" \
  "$(gleich "$($PSQL "select strasse from personen where id='${TEILNEHMER_ID}';")" "Neue Straße 7")"
pruefe "leeres IBAN-Feld loescht die Bankverbindung NICHT" \
  "$(gleich "$($PSQL "select \"ibanVerschluesselt\" from personen where id='${TEILNEHMER_ID}';")" "$IBAN_VORHER")"

NEUE_IBAN=$(curl -s -X PUT "${BASIS}/api/meine-daten" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' \
  -d '{"telefon":"0571 999888","strasse":"Neue Straße 7","plz":"32425","ort":"Porta Westfalica","kontoinhaber":"Petra Beispiel","iban":"AT61 1904 3002 3457 3201"}')
pruefe "neue Bankverbindung wird gemeldet" "$(echo "$NEUE_IBAN" | grep -qc 'Bankverbindung' 2>/dev/null && echo 1 || echo 0)" "$NEUE_IBAN"
pruefe "neue IBAN steht NICHT im Klartext in der Akte" \
  "$(gleich "$($PSQL "select count(*) from personen where \"ibanVerschluesselt\" like '%AT61%';")" "0")"
pruefe "die Bankverbindung hat sich geaendert" \
  "$([ "$($PSQL "select \"ibanVerschluesselt\" from personen where id='${TEILNEHMER_ID}';")" != "$IBAN_VORHER" ] && echo 1 || echo 0)"
# Wer ueber eine uebernommene Sitzung die IBAN tauscht, soll nicht unbemerkt
# bleiben: Hinweis an die hinterlegte Adresse. Ohne SMTP ehrlich „nicht gesendet".
pruefe "der Hinweis an die Person wird ehrlich gemeldet (ohne SMTP: nicht gesendet)" \
  "$(enthaelt "$NEUE_IBAN" '"hinweisGesendet":false')" "$NEUE_IBAN"
pruefe "der Hinweis steht im Versandprotokoll (BANKVERBINDUNG_GEAENDERT)" \
  "$(gleich "$($PSQL "select count(*) > 0 from email_versand where \"vorlageCode\"='BANKVERBINDUNG_GEAENDERT' and \"personId\"='${TEILNEHMER_ID}';")" "t")"

FALSCH=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "${BASIS}/api/meine-daten" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' \
  -d '{"telefon":"ruf mich an","iban":"DE00 1111"}')
pruefe "unsinnige Eingaben werden mit 400 abgewiesen" "$(gleich "$FALSCH" "400")" "$FALSCH"
OHNE=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "${BASIS}/api/meine-daten" -H 'Content-Type: application/json' -d '{"ort":"Fremd"}')
pruefe "ohne Anmeldung keine Selbstpflege (401)" "$(gleich "$OHNE" "401")" "$OHNE"

echo
echo "=== 11. E-Mail-Aenderung erst nach Bestaetigung ==="
BEANTRAGT=$(curl -s -X POST "${BASIS}/api/meine-daten/email" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' \
  -d '{"email":"petra.neu@beispiel.de"}')
pruefe "Aenderung wird angenommen" "$(echo "$BEANTRAGT" | grep -qc '"beantragt":true' 2>/dev/null && echo 1 || echo 0)" "$BEANTRAGT"
pruefe "die Adresse in der Akte bleibt vorerst unveraendert" \
  "$(gleich "$($PSQL "select email from personen where id='${TEILNEHMER_ID}';")" "petra@beispiel.de")"
pruefe "der Antrag ist hinterlegt" \
  "$(gleich "$($PSQL "select count(*) from email_aenderungen where \"neueEmail\"='petra.neu@beispiel.de' and \"benutztAm\" is null;")" "1")"
pruefe "nur der Hash des Tokens liegt in der Datenbank" \
  "$(gleich "$($PSQL "select count(*) from email_aenderungen where \"tokenHash\" ~ '^[0-9a-f]{64}\$';")" "1")"

GLEICH=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/meine-daten/email" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' \
  -d '{"email":"petra@beispiel.de"}')
pruefe "die eigene Adresse noch einmal wird abgewiesen (400)" "$(gleich "$GLEICH" "400")" "$GLEICH"

# Fremde Adresse: Die Antwort muss dieselbe sein wie bei einer freien Adresse —
# sonst waere der Endpunkt eine Auskunft darueber, wer die Bibelschule besucht.
VERGEBEN=$(curl -s -X POST "${BASIS}/api/meine-daten/email" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' \
  -d '{"email":"leiter@beispiel.de"}')
pruefe "vergebene Adresse wird nicht verraten" "$(echo "$VERGEBEN" | grep -qc '"beantragt":true' 2>/dev/null && echo 1 || echo 0)" "$VERGEBEN"
pruefe "aber es entsteht kein Antrag darauf" \
  "$(gleich "$($PSQL "select count(*) from email_aenderungen where \"neueEmail\"='leiter@beispiel.de';")" "0")"
pruefe "der Versuch steht im Protokoll" \
  "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='EMAIL_AENDERUNG_ADRESSE_VERGEBEN';")" "t")"

# Der Klartext-Token existiert nur in der Mail. Fuer den Durchstich wird er
# deshalb selbst erzeugt und die Zeile direkt gesetzt — geprueft wird die
# Einloese-Route, nicht der Mailversand.
ETOKEN=$(uuidgen | tr 'A-Z' 'a-z')
EHASH=$(printf %s "$ETOKEN" | shasum -a 256 | cut -d' ' -f1)
$PSQL "update email_aenderungen set \"tokenHash\"='${EHASH}' where \"neueEmail\"='petra.neu@beispiel.de';" > /dev/null

BESTAETIGT=$(curl -s -X POST "${BASIS}/api/meine-daten/email/bestaetigen" -H 'Content-Type: application/json' -d "{\"token\":\"${ETOKEN}\"}")
pruefe "Bestaetigung ohne Sitzung moeglich (anderes Geraet)" "$(echo "$BESTAETIGT" | grep -qc '"bestaetigt":true' 2>/dev/null && echo 1 || echo 0)" "$BESTAETIGT"
pruefe "jetzt gilt die neue Adresse" \
  "$(gleich "$($PSQL "select email from personen where id='${TEILNEHMER_ID}';")" "petra.neu@beispiel.de")"
ZWEITMAL=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/meine-daten/email/bestaetigen" -H 'Content-Type: application/json' -d "{\"token\":\"${ETOKEN}\"}")
pruefe "derselbe Link ein zweites Mal wird abgewiesen (401)" "$(gleich "$ZWEITMAL" "401")" "$ZWEITMAL"

# Abgelaufener Link: laeuftAb in die Vergangenheit setzen.
ATOKEN=$(uuidgen | tr 'A-Z' 'a-z')
AHASH=$(printf %s "$ATOKEN" | shasum -a 256 | cut -d' ' -f1)
$PSQL "insert into email_aenderungen (id, \"personId\", \"neueEmail\", \"tokenHash\", \"laeuftAb\", \"erstelltAm\") values (gen_random_uuid(), '${TEILNEHMER_ID}', 'zu.spaet@beispiel.de', '${AHASH}', now() - interval '1 hour', now());" > /dev/null
ABGELAUFEN=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/meine-daten/email/bestaetigen" -H 'Content-Type: application/json' -d "{\"token\":\"${ATOKEN}\"}")
pruefe "abgelaufener Link wird abgewiesen (401)" "$(gleich "$ABGELAUFEN" "401")" "$ABGELAUFEN"
pruefe "die Adresse blieb dabei unveraendert" \
  "$(gleich "$($PSQL "select email from personen where id='${TEILNEHMER_ID}';")" "petra.neu@beispiel.de")"

echo
echo "=== 12. Zugang vergessen (oeffentliches Hilfeformular) ==="
# Drosselarithmetik: ZUGANG_HILFE_MAX_PRO_IP = 5 je Anschluss und
# ZUGANG_HILFE_MAX_GESAMT = 20 ueber alle Anschluesse im selben Fenster. Hier
# fallen zwei gezaehlte Aufrufe an (198.51.100.7 und 198.51.100.8) — die
# unvollstaendige Meldung wird schon von der Feldpruefung abgewiesen und erreicht
# die Drossel gar nicht. Wer hier Aufrufe ergaenzt, rechnet beide Grenzen nach.
PERSONEN_VORHER=$($PSQL "select count(*) from personen;")
UNVOLLSTAENDIG=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/zugang-hilfe" -H 'Content-Type: application/json' -H 'X-Real-Ip: 198.51.100.7' \
  -d '{"vorname":"Petra","nachname":"Beispiel"}')
pruefe "ohne Erreichbarkeit wird abgewiesen (400)" "$(gleich "$UNVOLLSTAENDIG" "400")" "$UNVOLLSTAENDIG"

HILFE=$(curl -s -X POST "${BASIS}/api/zugang-hilfe" -H 'Content-Type: application/json' -H 'X-Real-Ip: 198.51.100.7' \
  -d '{"vorname":"Petra","nachname":"Beispiel","bisherigeEmail":"petra@beispiel.de","erreichbarEmail":"petra.privat@beispiel.de","nachricht":"Mein altes Postfach ist abgeschaltet."}')
pruefe "Meldung wird angenommen" "$(echo "$HILFE" | grep -qc 'Schulleitung' 2>/dev/null && echo 1 || echo 0)" "$HILFE"
pruefe "die Meldung steht im Protokoll" \
  "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='ZUGANG_HILFE_GEMELDET';")" "t")"
# Seit Code-Review 4 (M6b) ohne Namen im Betreff: Frei getippte Namen aus diesem
# Formular gehoeren oft zu Menschen ohne Akte, die keine Anonymisierung erreicht.
pruefe "die Schulleitung wird benachrichtigt (fester Betreff „Meldung zum Portalzugang“)" \
  "$(gleich "$($PSQL "select count(*) > 0 from email_versand where \"vorlageCode\"='ZUGANG_HILFE_MELDUNG' and betreff='Meldung zum Portalzugang';")" "t")"
pruefe "kein Betreff im Versandprotokoll nennt die meldende Person" \
  "$(gleich "$($PSQL "select count(*) from email_versand where betreff ilike '%Petra%' or betreff ilike '%Beispiel%';")" "0")"
pruefe "das Protokoll der Meldung nennt die Zahl der Empfaenger, keine Adresse" \
  "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='ZUGANG_HILFE_GEMELDET' and nachher ? 'empfaengerAnzahl' and nachher::text not like '%@%';")" "t")"
pruefe "das Formular aendert nichts an den Konten" \
  "$(gleich "$($PSQL "select count(*) from personen;")" "$PERSONEN_VORHER")"
# Gleiche Antwort fuer einen Namen, den es gar nicht gibt: Sonst waere das
# Formular eine Auskunft darueber, wer die Bibelschule besucht.
UNBEKANNT=$(curl -s -X POST "${BASIS}/api/zugang-hilfe" -H 'Content-Type: application/json' -H 'X-Real-Ip: 198.51.100.8' \
  -d '{"vorname":"Niemand","nachname":"Unbekannt","erreichbarTelefon":"0571 000000"}')
pruefe "unbekannter Name bekommt dieselbe Antwort" "$(gleich "$HILFE" "$UNBEKANNT")" "$UNBEKANNT"

echo
echo "=== 13. Benutzerverwaltung: wieder hereinlassen ==="
SEITE_P=$(curl -s -o /dev/null -w '%{http_code}' "${BASIS}/verwaltung/personen" -H "Cookie: ${KEKS}")
pruefe "Schulleitung sieht die Personenliste (200)" "$(gleich "$SEITE_P" "200")" "$SEITE_P"
SEITE_T=$(curl -s -o /dev/null -w '%{http_code}' "${BASIS}/verwaltung/personen" -H "Cookie: ${KEKS2}")
pruefe "Teilnehmer sieht sie nicht (307)" "$(gleich "$SEITE_T" "307")" "$SEITE_T"

VERBOTEN=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "${BASIS}/api/personen/${TEILNEHMER_ID}/email" -H "Cookie: ${KEKS2}" \
  -H 'Content-Type: application/json' -d '{"email":"fremd@beispiel.de"}')
pruefe "Teilnehmer darf keine Adresse aendern (403)" "$(gleich "$VERBOTEN" "403")" "$VERBOTEN"

VERGEBEN2=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "${BASIS}/api/personen/${TEILNEHMER_ID}/email" -H "Cookie: ${KEKS}" \
  -H 'Content-Type: application/json' -d '{"email":"leiter@beispiel.de"}')
pruefe "eine bereits vergebene Adresse wird abgewiesen (409)" "$(gleich "$VERGEBEN2" "409")" "$VERGEBEN2"

# Die eigene Adresse laesst sich hier NICHT aendern: Dafuer gibt es
# /api/meine-daten/email mit Bestaetigung ueber die neue Adresse. An dieser
# Stelle gibt es die nicht — ein Tippfehler wuerde den Bedienenden im selben
# Moment selbst aussperren.
SELBST=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "${BASIS}/api/personen/${SCHULLEITER_ID}/email" -H "Cookie: ${KEKS}" \
  -H 'Content-Type: application/json' -d '{"email":"leiter.neu@beispiel.de"}')
pruefe "das eigene Konto laesst sich hier nicht aendern (403)" "$(gleich "$SELBST" "403")" "$SELBST"
pruefe "die eigene Adresse ist unveraendert" \
  "$(gleich "$($PSQL "select email from personen where id='${SCHULLEITER_ID}';")" "leiter@beispiel.de")"

# Und kein Konto, das mehr darf als der Handelnde. Ohne diese Schranke genuegten
# zwei Aufrufe fuer die Uebernahme des Administratorkontos: Adresse auf die
# eigene aendern, Anmeldelink schicken. Jeder mit Verwaltungsrechten haette
# damit Administratorrechte.
ADMIN_ID=$($PSQL "insert into personen (id, vorname, nachname, email, \"statusCode\", \"erstelltAm\", \"aktualisiertAm\") values (gen_random_uuid(), 'Anna', 'Admin', 'admin@beispiel.de', 'AKTIV', now(), now()) returning id;")
$PSQL "insert into person_rolle (\"personId\", \"rolleCode\") values ('${ADMIN_ID}', 'ADMIN');" > /dev/null
UEBERNAHME_VERSUCH=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "${BASIS}/api/personen/${ADMIN_ID}/email" -H "Cookie: ${KEKS}" \
  -H 'Content-Type: application/json' -d '{"email":"admin.neu@beispiel.de"}')
pruefe "ein Konto mit weitergehenden Rechten bleibt unangetastet (403)" "$(gleich "$UEBERNAHME_VERSUCH" "403")" "$UEBERNAHME_VERSUCH"
pruefe "die Adresse des Administratorkontos ist unveraendert" \
  "$(gleich "$($PSQL "select email from personen where id='${ADMIN_ID}';")" "admin@beispiel.de")"

# Offener Aenderungsantrag muss beim Eingriff der Verwaltung entwertet werden —
# sonst biegt ein alter Bestaetigungslink die Adresse hinterher wieder um.
OTOKEN=$(uuidgen | tr 'A-Z' 'a-z')
OHASH=$(printf %s "$OTOKEN" | shasum -a 256 | cut -d' ' -f1)
$PSQL "insert into email_aenderungen (id, \"personId\", \"neueEmail\", \"tokenHash\", \"laeuftAb\", \"erstelltAm\") values (gen_random_uuid(), '${TEILNEHMER_ID}', 'noch.offen@beispiel.de', '${OHASH}', now() + interval '1 hour', now());" > /dev/null

# Dasselbe fuer einen offenen Anmeldelink: Er liegt im alten — moeglicherweise
# uebernommenen — Postfach und gilt bis zu 24 Stunden. Bliebe er gueltig, waere
# der alte Zugang unmittelbar nach der Adressaenderung wieder offen.
PTOKEN_ALT=$(uuidgen | tr 'A-Z' 'a-z')
PHASH_ALT=$(printf %s "$PTOKEN_ALT" | shasum -a 256 | cut -d' ' -f1)
$PSQL "insert into magic_links (id, \"personId\", \"tokenHash\", \"laeuftAb\", \"erstelltAm\") values (gen_random_uuid(), '${TEILNEHMER_ID}', '${PHASH_ALT}', now() + interval '1 hour', now());" > /dev/null

GEAENDERT=$(curl -s -X PUT "${BASIS}/api/personen/${TEILNEHMER_ID}/email" -H "Cookie: ${KEKS}" \
  -H 'Content-Type: application/json' -d '{"email":"petra.privat@beispiel.de"}')
pruefe "die Verwaltung kann die Adresse aendern" "$(echo "$GEAENDERT" | grep -qc 'petra.privat@beispiel.de' 2>/dev/null && echo 1 || echo 0)" "$GEAENDERT"
pruefe "die neue Adresse steht in der Akte" \
  "$(gleich "$($PSQL "select email from personen where id='${TEILNEHMER_ID}';")" "petra.privat@beispiel.de")"
pruefe "der offene Aenderungsantrag ist entwertet" \
  "$(gleich "$($PSQL "select count(*) from email_aenderungen where \"neueEmail\"='noch.offen@beispiel.de' and \"benutztAm\" is null;")" "0")"
ALTER_LINK=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/meine-daten/email/bestaetigen" -H 'Content-Type: application/json' -d "{\"token\":\"${OTOKEN}\"}")
pruefe "der alte Bestaetigungslink greift nicht mehr (401)" "$(gleich "$ALTER_LINK" "401")" "$ALTER_LINK"
pruefe "der offene Anmeldelink ist ebenfalls entwertet" \
  "$(gleich "$($PSQL "select count(*) from magic_links where \"tokenHash\"='${PHASH_ALT}' and \"benutztAm\" is not null;")" "1")"
ALTER_ANMELDELINK=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/auth/token" -H 'Content-Type: application/json' -d "{\"token\":\"${PTOKEN_ALT}\"}")
pruefe "und er oeffnet keine Sitzung mehr (401)" "$(gleich "$ALTER_ANMELDELINK" "401")" "$ALTER_ANMELDELINK"
# Die Antwort sagt auch, ob dabei ein Passwort entfernt wurde. Hier war noch
# keines gesetzt — der Fall „ja, und zwar mitsamt der laufenden Sitzung" steht
# in Abschnitt 15, wenn Petra eines hat.
pruefe "gemeldet wird auch, dass kein Passwort zu entfernen war" \
  "$(echo "$GEAENDERT" | grep -qc '"passwortEntfernt":false' 2>/dev/null && echo 1 || echo 0)" "$GEAENDERT"
pruefe "beide Adressen wurden benachrichtigt" \
  "$(gleich "$($PSQL "select count(*) from email_versand where \"vorlageCode\"='EMAIL_GEAENDERT_DURCH_VERWALTUNG';")" "2")"

LINKS_VORHER=$($PSQL "select count(*) from magic_links;")
SCHICKEN=$(curl -s -X POST "${BASIS}/api/personen/${TEILNEHMER_ID}/anmeldelink" -H "Cookie: ${KEKS}")
# Der Durchstich hat kein SMTP. Seit Code-Review 4 meldet die Route den echten
# Ausgang statt eines festen `true` — am Telefon soll niemand auf einen Link
# warten, der nie kommt.
pruefe "Anmeldelink: ohne SMTP meldet die Route ehrlich „nicht gesendet“" "$(echo "$SCHICKEN" | grep -qc '"gesendet":false' 2>/dev/null && echo 1 || echo 0)" "$SCHICKEN"
pruefe "der Link geht an die hinterlegte Adresse" "$(echo "$SCHICKEN" | grep -qc 'petra.privat@beispiel.de' 2>/dev/null && echo 1 || echo 0)" "$SCHICKEN"
pruefe "ein neuer Anmeldelink ist entstanden" \
  "$([ "$($PSQL "select count(*) from magic_links;")" -gt "$LINKS_VORHER" ] && echo 1 || echo 0)"
pruefe "der Fehlversand steht im Versandprotokoll (MAGIC_LINK, FEHLER)" \
  "$(gleich "$($PSQL "select status from email_versand where \"vorlageCode\"='MAGIC_LINK' and \"personId\"='${TEILNEHMER_ID}' order by \"erstelltAm\" desc limit 1;")" "FEHLER")"
pruefe "das Protokoll haelt gesendet=false fest — ohne die Adresse" \
  "$(gleich "$($PSQL "select (nachher->>'gesendet') = 'false' and nachher::text not like '%@%' from audit_log where aktion='ANMELDELINK_DURCH_VERWALTUNG' order by \"erstelltAm\" desc limit 1;")" "t")"
# Gegenprobe oeffentlicher Weg: Er verraet weiter nichts ueber den Versand.
OEFFENTLICH=$(curl -s -w '\n%{http_code}' -X POST "${BASIS}/api/auth/anmelden" -H 'Content-Type: application/json' \
  -H 'X-Real-Ip: 203.0.113.42' -d '{"email":"petra.privat@beispiel.de"}')
pruefe "der oeffentliche Weg antwortet gleichbleibend und ohne Versandangabe" \
  "$([ "$(echo "$OEFFENTLICH" | tail -1)" = "200" ] && [ "$(enthaelt "$OEFFENTLICH" 'Wenn die Adresse bei uns hinterlegt ist')" = "1" ] && [ "$(fehlt_in "$OEFFENTLICH" 'gesendet')" = "1" ] && echo 1 || echo 0)" "$OEFFENTLICH"

# Endzustand: kein Anmeldelink, und das wird gesagt statt still geschluckt.
OHNE_ID=$($PSQL "select id from personen where email='ohne@beispiel.de';")
$PSQL "update personen set \"statusCode\"='AUSGESCHLOSSEN' where id='${OHNE_ID}';" > /dev/null
TERMINAL=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/personen/${OHNE_ID}/anmeldelink" -H "Cookie: ${KEKS}")
pruefe "fuer ein abgeschlossenes Konto gibt es keinen Link (409)" "$(gleich "$TERMINAL" "409")" "$TERMINAL"

echo
echo "=== 14. Passwort als zweiter Anmeldeweg ==="
# Petras Adresse wurde in Abschnitt 13 von der Verwaltung geaendert.
PETRA_MAIL="petra.privat@beispiel.de"

# -----------------------------------------------------------------------------
# Anschluesse und Drosselarithmetik (bitte beim Aendern nachrechnen)
#
# /api/auth/passwort drosselt doppelt und ist FAIL-CLOSED: Ohne X-Real-Ip gibt
# es 429, bevor irgendetwas geprueft wird. Jeder curl-Aufruf hierhin braucht
# deshalb den Header.
#   - je Anschluss: AUTH_MAGIC_LINK_MAX_PRO_IP = 20 Aufrufe im Fenster
#   - je Adresse:   AUTH_PASSWORT_MAX_VERSUCHE = 10 Aufrufe im Fenster,
#                   eine GELUNGENE Anmeldung raeumt den Adresszaehler wieder ab
#
# Damit sich die Gruppen nicht gegenseitig aussperren, hat jede ihren eigenen
# Anschluss:
IP_PETRA=203.0.113.20   # Petras Versuche: 1 falsch + 1 richtig + 1 falsch + 9 Schleife + 1 gedrosselt = 13 < 20
IP_VERGLEICH=203.0.113.21  # unbekannte Adresse, Konto ohne Passwort: 2 < 20
IP_HANS=203.0.113.22    # zweites Konto: 3 < 20
#
# Adresszaehler PASSWORT:petra.privat@beispiel.de:
#   falsches Passwort            -> 1
#   richtiges Passwort           -> 2, danach geloescht (Erfolg raeumt ab) -> 0
#   FALSCH_TEXT                  -> 1
#   Schleife mit 9 Fehlversuchen -> 10
#   naechster Aufruf: bereits 10 im Fenster -> 429. Genau darauf zielt die Zeile.
# -----------------------------------------------------------------------------

# Die Adressaenderung in Abschnitt 13 hat `passwortGeaendertAm` gesetzt, und
# `ladeAngemeldeten` verwirft jede Sitzung, die aelter ist. Petras Cookie aus
# Abschnitt 9 ist damit tot — das ist gewollt und wird hier zuerst nachgewiesen.
WIDERRUFEN=$(curl -s -o /dev/null -w '%{http_code}' "${BASIS}/meine-daten" -H "Cookie: ${KEKS2}")
pruefe "die alte Sitzung ist nach dem Eingriff der Verwaltung beendet (307)" "$(gleich "$WIDERRUFEN" "307")" "$WIDERRUFEN"

# Also neu anmelden. Ohne das liefe der ganze Abschnitt in 401er (keine gueltige
# Sitzung mehr).
PTOKEN_NEU=$(uuidgen | tr 'A-Z' 'a-z')
PHASH_NEU=$(printf %s "$PTOKEN_NEU" | shasum -a 256 | cut -d' ' -f1)
$PSQL "insert into magic_links (id, \"personId\", \"tokenHash\", \"laeuftAb\", \"erstelltAm\") values (gen_random_uuid(), '${TEILNEHMER_ID}', '${PHASH_NEU}', now() + interval '1 hour', now());" > /dev/null
curl -s -D /tmp/gbs-kopf-petra.txt -o /dev/null -X POST "${BASIS}/api/auth/token" -H 'Content-Type: application/json' -d "{\"token\":\"${PTOKEN_NEU}\"}"
KEKS2=$(grep -i '^set-cookie:' /tmp/gbs-kopf-petra.txt | head -1 | sed 's/^[^:]*: //' | cut -d';' -f1)
pruefe "mit einem frischen Anmeldelink kommt sie wieder herein" "$([ -n "$KEKS2" ] && echo 1 || echo 0)"

KURZ=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "${BASIS}/api/meine-daten/passwort" -H "Cookie: ${KEKS2}" \
  -H 'Content-Type: application/json' -d '{"passwort":"kurz"}')
pruefe "zu kurzes Passwort wird abgewiesen (400)" "$(gleich "$KURZ" "400")" "$KURZ"

# Ohne Sitzung geht hier gar nichts — weder setzen noch entfernen. Beides sind
# Eingriffe in ein fremdes Konto, wenn niemand angemeldet ist. Die Antwort ist
# „nicht angemeldet" (401), nicht „keine Berechtigung".
OHNE_SITZUNG_PUT=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "${BASIS}/api/meine-daten/passwort" \
  -H 'Content-Type: application/json' -d '{"passwort":"Der Herr ist mein Hirte"}')
pruefe "ohne Sitzung laesst sich kein Passwort setzen (401)" "$(gleich "$OHNE_SITZUNG_PUT" "401")" "$OHNE_SITZUNG_PUT"
OHNE_SITZUNG_DELETE=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "${BASIS}/api/meine-daten/passwort")
pruefe "ohne Sitzung laesst sich kein Passwort entfernen (401)" "$(gleich "$OHNE_SITZUNG_DELETE" "401")" "$OHNE_SITZUNG_DELETE"

# Das Setzen entwertet alle aelteren Sitzungen — auch die eigene. Die Route legt
# deshalb sofort eine frische an; das neue Cookie muss hier eingesammelt und
# weiterverwendet werden, sonst laufen alle folgenden Aufrufe mit einer
# widerrufenen Sitzung.
SETZEN=$(curl -s -D /tmp/gbs-pw-setzen.txt -X PUT "${BASIS}/api/meine-daten/passwort" -H "Cookie: ${KEKS2}" \
  -H 'Content-Type: application/json' -d '{"passwort":"Der Herr ist mein Hirte"}')
KEKS2=$(grep -i '^set-cookie:' /tmp/gbs-pw-setzen.txt | head -1 | sed 's/^[^:]*: //' | cut -d';' -f1)
pruefe "Passwort wird gesetzt" "$(echo "$SETZEN" | grep -qc '"neu":true' 2>/dev/null && echo 1 || echo 0)" "$SETZEN"
pruefe "dabei wird die Sitzung erneuert" "$([ -n "$KEKS2" ] && echo 1 || echo 0)"
pruefe "gespeichert wird ein scrypt-Hash" \
  "$(gleich "$($PSQL "select count(*) from personen where \"passwortHash\" like 'scrypt\$%' and id='${TEILNEHMER_ID}';")" "1")"
pruefe "das Passwort steht NIRGENDS im Klartext" \
  "$(gleich "$($PSQL "select count(*) from personen where \"passwortHash\" ilike '%Hirte%';")" "0")"

# Ein zweites Mal setzen ist eine Aenderung, keine Neuanlage — und muss auch so
# protokolliert werden. Wieder mit frischem Cookie.
NOCHMAL_PW=$(curl -s -D /tmp/gbs-pw-nochmal.txt -X PUT "${BASIS}/api/meine-daten/passwort" -H "Cookie: ${KEKS2}" \
  -H 'Content-Type: application/json' -d '{"passwort":"Der Herr ist mein Hirte"}')
KEKS2=$(grep -i '^set-cookie:' /tmp/gbs-pw-nochmal.txt | head -1 | sed 's/^[^:]*: //' | cut -d';' -f1)
pruefe "ein zweites Mal setzen meldet keine Neuanlage" "$(echo "$NOCHMAL_PW" | grep -qc '"neu":false' 2>/dev/null && echo 1 || echo 0)" "$NOCHMAL_PW"
pruefe "die Aenderung steht als PASSWORT_GEAENDERT im Protokoll" \
  "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='PASSWORT_GEAENDERT' and \"objektId\"='${TEILNEHMER_ID}';")" "t")"

FALSCHES=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/auth/passwort" -H 'Content-Type: application/json' \
  -H "X-Real-Ip: ${IP_PETRA}" -d "{\"email\":\"${PETRA_MAIL}\",\"passwort\":\"Der Herr ist mein Hirt\"}")
pruefe "falsches Passwort wird abgewiesen (401)" "$(gleich "$FALSCHES" "401")" "$FALSCHES"

# Ohne erkennbare Herkunft wird abgewiesen statt durchgelassen: Wer den Header
# unterdrueckt, umginge sonst die Anschlussdrossel vollstaendig und duerfte
# beliebig viele Adressen durchprobieren. Geschickt wird das RICHTIGE Passwort —
# abgewiesen werden muss trotzdem.
#
# Der Header muss LEER mitgeschickt werden ("-H 'X-Forwarded-For;'"), nicht
# weggelassen: Fehlt er ganz, setzt Next.js selbst ein X-Forwarded-For mit der
# TCP-Gegenstelle ein, und die Anfrage hat wieder eine Herkunft. Gemessen am
# 28.07.: ohne Header wurde 203.0.113.10 protokolliert und die Anmeldung ging
# mit 200 durch — die Zeile prueft weggelassen also nichts. Ein vorhandener,
# aber leerer Header ist der realistische Fall (Proxy da, gibt aber nichts
# weiter) und bleibt leer.
OHNE_HERKUNFT=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/auth/passwort" -H 'Content-Type: application/json' \
  -H 'X-Real-Ip;' -H 'X-Forwarded-For;' \
  -d "{\"email\":\"${PETRA_MAIL}\",\"passwort\":\"Der Herr ist mein Hirte\"}")
pruefe "ohne erkennbare Herkunft wird abgewiesen (429)" "$(gleich "$OHNE_HERKUNFT" "429")" "$OHNE_HERKUNFT"
# Der Statuscode allein genuegt hier nicht: 429 kommt auch von der Adress- oder
# Anschlussdrossel, und Petra hat vorher schon Fehlversuche gesammelt. Die Zeile
# waere dann aus dem falschen Grund gruen. Beweisend ist die protokollierte
# Herkunft — nur der Zweig `!ipAdresse` schreibt GEDROSSELT ohne IP-Adresse.
pruefe "und zwar wegen der fehlenden Herkunft, nicht wegen der Drossel" \
  "$(gleich "$($PSQL "select \"ipAdresse\" is null from audit_log where aktion='PASSWORT_ANMELDUNG_GEDROSSELT' order by \"erstelltAm\" desc limit 1;")" "t")"

curl -s -D /tmp/gbs-pw.txt -o /tmp/gbs-pw-rumpf.txt -X POST "${BASIS}/api/auth/passwort" -H 'Content-Type: application/json' \
  -H "X-Real-Ip: ${IP_PETRA}" -d "{\"email\":\"${PETRA_MAIL}\",\"passwort\":\"Der Herr ist mein Hirte\"}"
KEKS3=$(grep -i '^set-cookie:' /tmp/gbs-pw.txt | head -1 | sed 's/^[^:]*: //' | cut -d';' -f1)
pruefe "richtiges Passwort meldet an" "$([ -n "$KEKS3" ] && echo 1 || echo 0)" "$(cat /tmp/gbs-pw-rumpf.txt)"
# Die gelungene Anmeldung raeumt den Adresszaehler ab. Ohne das haette sich
# ausgesperrt, wer sich vom Handy, vom Notebook und noch einmal vom Rechner der
# Verwaltung anmeldet — mit lauter richtigen Passwoertern.
pruefe "eine gelungene Anmeldung raeumt das Versuchskontingent ab" \
  "$(gleich "$($PSQL "select count(*) from rate_limit where schluessel='PASSWORT:${PETRA_MAIL}';")" "0")"

# Der eigentliche Zweck: Postfach verloren, aber mit Passwort hereingekommen —
# und jetzt die Adresse selbst umstellen, ohne dass jemand helfen muss.
MIT_PW=$(curl -s -X POST "${BASIS}/api/meine-daten/email" -H "Cookie: ${KEKS3}" -H 'Content-Type: application/json' \
  -d '{"email":"petra.ganz.neu@beispiel.de"}')
pruefe "mit Passwort angemeldet laesst sich die Adresse selbst umstellen" \
  "$(echo "$MIT_PW" | grep -qc '"beantragt":true' 2>/dev/null && echo 1 || echo 0)" "$MIT_PW"

# Unbekannte Adresse und Konto ohne Passwort muessen gleich aussehen wie ein
# falsches Passwort — sonst ist der Endpunkt ein Verzeichnis der Teilnehmer.
UNBEKANNT_PW=$(curl -s -X POST "${BASIS}/api/auth/passwort" -H 'Content-Type: application/json' \
  -H "X-Real-Ip: ${IP_VERGLEICH}" -d '{"email":"gibtesnicht@beispiel.de","passwort":"Der Herr ist mein Hirte"}')
OHNE_PW=$(curl -s -X POST "${BASIS}/api/auth/passwort" -H 'Content-Type: application/json' \
  -H "X-Real-Ip: ${IP_VERGLEICH}" -d '{"email":"leiter@beispiel.de","passwort":"Der Herr ist mein Hirte"}')
FALSCH_TEXT=$(curl -s -X POST "${BASIS}/api/auth/passwort" -H 'Content-Type: application/json' \
  -H "X-Real-Ip: ${IP_PETRA}" -d "{\"email\":\"${PETRA_MAIL}\",\"passwort\":\"falsch aber lang genug\"}")
pruefe "unbekannte Adresse antwortet wie ein falsches Passwort" "$(gleich "$UNBEKANNT_PW" "$FALSCH_TEXT")" "$UNBEKANNT_PW"
pruefe "Konto ohne Passwort antwortet genauso" "$(gleich "$OHNE_PW" "$FALSCH_TEXT")" "$OHNE_PW"

# Drosselung je Adresse: Grenze 10, ein Fehlversuch liegt hinter uns (FALSCH_TEXT),
# neun weitere fuellen das Kontingent — der naechste Aufruf muss abgewiesen
# werden, und zwar auch mit RICHTIGEM Passwort.
for i in $(seq 1 9); do
  curl -s -o /dev/null -X POST "${BASIS}/api/auth/passwort" -H 'Content-Type: application/json' \
    -H "X-Real-Ip: ${IP_PETRA}" -d "{\"email\":\"${PETRA_MAIL}\",\"passwort\":\"immer wieder falsch\"}"
done
GEDROSSELT=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/auth/passwort" -H 'Content-Type: application/json' \
  -H "X-Real-Ip: ${IP_PETRA}" -d "{\"email\":\"${PETRA_MAIL}\",\"passwort\":\"Der Herr ist mein Hirte\"}")
pruefe "zu viele Versuche werden gedrosselt (429)" "$(gleich "$GEDROSSELT" "429")" "$GEDROSSELT"

# Entfernen an einem zweiten Konto pruefen, damit die Drossel oben nicht
# hineinspielt.
HTOKEN=$(uuidgen | tr 'A-Z' 'a-z')
HHASH=$(printf %s "$HTOKEN" | shasum -a 256 | cut -d' ' -f1)
$PSQL "insert into magic_links (id, \"personId\", \"tokenHash\", \"laeuftAb\", \"erstelltAm\") values (gen_random_uuid(), '${HOERER_ID}', '${HHASH}', now() + interval '1 hour', now());" > /dev/null
curl -s -D /tmp/gbs-h.txt -o /dev/null -X POST "${BASIS}/api/auth/token" -H 'Content-Type: application/json' -d "{\"token\":\"${HTOKEN}\"}"
KEKS4=$(grep -i '^set-cookie:' /tmp/gbs-h.txt | head -1 | sed 's/^[^:]*: //' | cut -d';' -f1)
# Auch hier das erneuerte Cookie einsammeln: Das Setzen entwertet die Sitzung,
# mit der gesetzt wurde. Mit dem alten Cookie liefe das DELETE unten in einen
# 401 — und zwar nicht immer, sondern je nach Sekundenbruchteil.
curl -s -D /tmp/gbs-h-pw.txt -o /dev/null -X PUT "${BASIS}/api/meine-daten/passwort" -H "Cookie: ${KEKS4}" \
  -H 'Content-Type: application/json' -d '{"passwort":"Sein Stecken und Stab"}'
KEKS4=$(grep -i '^set-cookie:' /tmp/gbs-h-pw.txt | head -1 | sed 's/^[^:]*: //' | cut -d';' -f1)
VORHER_OK=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/auth/passwort" -H 'Content-Type: application/json' \
  -H "X-Real-Ip: ${IP_HANS}" -d '{"email":"hans@beispiel.de","passwort":"Sein Stecken und Stab"}')
pruefe "zweites Konto kann sich mit Passwort anmelden" "$(gleich "$VORHER_OK" "200")" "$VORHER_OK"

# Endzustand: Wer das System verlassen hat, kommt auch mit RICHTIGEM Passwort
# nicht mehr herein. Sonst behielte ein ausgeschlossener Zugang genau den
# zweiten Anmeldeweg, den ihm niemand mehr wegnimmt.
$PSQL "update personen set \"statusCode\"='AUSGESCHLOSSEN' where id='${HOERER_ID}';" > /dev/null
ENDZUSTAND=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/auth/passwort" -H 'Content-Type: application/json' \
  -H "X-Real-Ip: ${IP_HANS}" -d '{"email":"hans@beispiel.de","passwort":"Sein Stecken und Stab"}')
pruefe "ein Konto im Endzustand kommt auch mit richtigem Passwort nicht herein (401)" "$(gleich "$ENDZUSTAND" "401")" "$ENDZUSTAND"
# Und eine schon laufende Sitzung endet mit dem Endzustand — ohne dass jemand
# das Cookie zurueckholen muss (`ladeAngemeldeten` verwirft Endzustaende).
ENDZUSTAND_SEITE=$(curl -s -o /dev/null -w '%{http_code}' "${BASIS}/meine-daten" -H "Cookie: ${KEKS4}")
pruefe "die laufende Sitzung im Endzustand fuehrt von der Akte weg (307)" "$(gleich "$ENDZUSTAND_SEITE" "307")" "$ENDZUSTAND_SEITE"
ENDZUSTAND_PUT=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "${BASIS}/api/meine-daten" -H "Cookie: ${KEKS4}" \
  -H 'Content-Type: application/json' -d '{"ort":"Endzustand"}')
pruefe "und schreibt nichts mehr (401)" "$(gleich "$ENDZUSTAND_PUT" "401")" "$ENDZUSTAND_PUT"
$PSQL "update personen set \"statusCode\"='ANGENOMMEN' where id='${HOERER_ID}';" > /dev/null

curl -s -o /dev/null -X DELETE "${BASIS}/api/meine-daten/passwort" -H "Cookie: ${KEKS4}"
pruefe "nach dem Entfernen ist kein Hash mehr hinterlegt" \
  "$(gleich "$($PSQL "select count(*) from personen where id='${HOERER_ID}' and \"passwortHash\" is null;")" "1")"
NACHHER=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/auth/passwort" -H 'Content-Type: application/json' \
  -H "X-Real-Ip: ${IP_HANS}" -d '{"email":"hans@beispiel.de","passwort":"Sein Stecken und Stab"}')
pruefe "und die Anmeldung damit wird abgewiesen (401)" "$(gleich "$NACHHER" "401")" "$NACHHER"

echo
echo "=== 15. Eingriff der Verwaltung entwertet Passwort und Sitzung ==="
# Der Fall dahinter: Jemand hat ein fremdes Postfach uebernommen und sich dort
# ein Passwort gesetzt. Eine neue Adresse allein wuerde ihn nicht aussperren —
# das Passwort und die laufende Sitzung muessen mit hinaus.
PW_LINK_TOKEN=$(uuidgen | tr 'A-Z' 'a-z')
PW_LINK_HASH=$(printf %s "$PW_LINK_TOKEN" | shasum -a 256 | cut -d' ' -f1)
$PSQL "insert into magic_links (id, \"personId\", \"tokenHash\", \"laeuftAb\", \"erstelltAm\") values (gen_random_uuid(), '${TEILNEHMER_ID}', '${PW_LINK_HASH}', now() + interval '1 hour', now());" > /dev/null

ENTWERTET=$(curl -s -X PUT "${BASIS}/api/personen/${TEILNEHMER_ID}/email" -H "Cookie: ${KEKS}" \
  -H 'Content-Type: application/json' -d '{"email":"petra.endgueltig@beispiel.de"}')
pruefe "die Verwaltung meldet das entfernte Passwort zurueck" \
  "$(echo "$ENTWERTET" | grep -qc '"passwortEntfernt":true' 2>/dev/null && echo 1 || echo 0)" "$ENTWERTET"
pruefe "in der Akte steht kein Passwort mehr" \
  "$(gleich "$($PSQL "select count(*) from personen where id='${TEILNEHMER_ID}' and \"passwortHash\" is null;")" "1")"
pruefe "der offene Anmeldelink ist entwertet" \
  "$(gleich "$($PSQL "select count(*) from magic_links where \"tokenHash\"='${PW_LINK_HASH}' and \"benutztAm\" is not null;")" "1")"
ALT_PW=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/auth/passwort" -H 'Content-Type: application/json' \
  -H 'X-Real-Ip: 203.0.113.24' -d '{"email":"petra.endgueltig@beispiel.de","passwort":"Der Herr ist mein Hirte"}')
pruefe "das alte Passwort oeffnet nichts mehr (401)" "$(gleich "$ALT_PW" "401")" "$ALT_PW"
# Und die Sitzung, die mit diesem Passwort begonnen wurde, ist ebenfalls tot:
# `passwortGeaendertAm` ist juenger als ihr Ausstellungszeitpunkt.
SITZUNG_TOT=$(curl -s -o /dev/null -w '%{http_code}' "${BASIS}/meine-daten" -H "Cookie: ${KEKS3}")
pruefe "die mit Passwort begonnene Sitzung ist beendet (307)" "$(gleich "$SITZUNG_TOT" "307")" "$SITZUNG_TOT"
# Auch Petras aeltere Sitzung KEKS2 ist mit dem Adresswechsel entwertet. Eine
# API-Anfrage damit gilt als „nicht angemeldet" (401), nicht als „keine
# Berechtigung" (403). Die Rechte-Gegenproben der folgenden Abschnitte brauchen
# deshalb eine frische, gueltige Teilnehmer-Sitzung (KEKS_TN) — sonst pruefen
# sie die Sitzung statt des fehlenden Rechts.
ALT_KEKS=$(status_von -X POST "${BASIS}/api/personen/${TEILNEHMER_ID}/auskunft" -H "Cookie: ${KEKS2}")
pruefe "eine entwertete Sitzung gilt als nicht angemeldet (401)" "$(gleich "$ALT_KEKS" "401")" "$ALT_KEKS"
KEKS_TN=$(anmelden_als "$TEILNEHMER_ID")
pruefe "fuer die Rechte-Gegenproben gibt es eine frische Teilnehmer-Sitzung" "$([ -n "$KEKS_TN" ] && echo 1 || echo 0)"

echo
echo "=== 16. Art. 9 durchgaengig: ohne Einwilligung keine Gemeindeangabe ==="
# Gegenprobe ZUERST — sonst bestuende die Pruefung unten auch dann, wenn die
# Gemeinde generell nirgends gespeichert wuerde: Petras Anmeldung aus Abschnitt 5
# hatte die Einwilligung, und bei ihr muss die Angabe sehr wohl in der Akte
# stehen.
pruefe "mit Einwilligung steht die Gemeinde in der Akte" \
  "$(gleich "$($PSQL "select gemeinde from personen where id='${TEILNEHMER_ID}';")" "FeG Minden")"
pruefe "mit Einwilligung steht sie auch im Antwort-JSON" \
  "$(gleich "$($PSQL "select count(*) from anmeldungen where \"personId\"='${TEILNEHMER_ID}' and antworten::text like '%FeG Minden%';")" "1")"

# Die Glaubenseinwilligung ist im Seed eine Pflichteinwilligung. Ohne sie wird
# die Anmeldung gar nicht angenommen — auch das wird geprueft.
OHNE_PFLICHT=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/anmeldung" -H 'Content-Type: application/json' \
  -H 'X-Real-Ip: 203.0.113.30' -d "{
  \"aktion\": \"absenden\", \"versionId\": \"${VERSION_ID}\", \"einwilligungen\": [\"DATENSCHUTZ\"],
  \"antworten\": {
    \"anrede\": \"Herr\",
    \"vorname\": \"Gerd\", \"nachname\": \"Gemeindefrei\", \"geburtsdatum\": \"1985-03-03\",
    \"strasse\": \"Nebenweg 2\", \"plz\": \"32423\", \"ort\": \"Minden\",
    \"email\": \"ohne.einwilligung@beispiel.de\", \"telefon\": \"0571 000111\",
    \"schulabschluss\": \"Realschulabschluss\", \"erlernter_beruf\": \"Maler\", \"derzeitiger_beruf\": \"Maler\",
    \"gemeinde_mitglied\": \"FeG Herford\", \"motivation\": \"Interesse.\",
    \"teilnahmeform\": \"Als Hörer — ohne Prüfungen\",
    \"kontoinhaber\": \"Gerd Gemeindefrei\", \"iban\": \"DE89 3704 0044 0532 0130 00\",
    \"bank_name\": \"Volksbank\", \"einzug_einverstanden\": true, \"zahlweise\": \"Monatlich\"
  }
}")
pruefe "ohne Pflichteinwilligung wird die Anmeldung abgewiesen (400)" "$(gleich "$OHNE_PFLICHT" "400")" "$OHNE_PFLICHT"

# Fuer den eigentlichen Fall wird die Pflicht kurz aufgehoben. Ohne das liefe die
# Pruefung ins Leere: Es gaebe gar keine Anmeldung, also auch keine Gemeinde —
# bestanden aus dem falschen Grund. Danach sofort zurueckgesetzt.
#
# Seit Code-Review 4 (M8) ist eine Fassung eingefroren (Trigger), ein UPDATE auf
# `pflicht` scheitert. Der vorgesehene Weg ist eine neue Fassung (version + 1),
# die danach ueber `aktivBis` ausser Kraft gesetzt wird — das Einzige, was der
# Trigger aendern laesst. Bewusst KEIN DISABLE TRIGGER: Sonst uebte der
# Durchstich genau das Muster, das M8 verbieten soll.
# Der Seed bringt seit der Umstellung auf „Sie“ schon Fassung 2 mit (Fassung 1
# per aktivBis abgeloest) — die Test-Fassung ohne Pflicht ist deshalb Fassung 3.
$PSQL "insert into einwilligungs_texte (id, code, version, titel, text, \"istArt9\", pflicht, \"aktivAb\") select gen_random_uuid()::text, code, version + 1, titel, text, \"istArt9\", false, now() - interval '1 minute' from einwilligungs_texte where code = 'GLAUBENSANGABEN' order by version desc limit 1;" > /dev/null
pruefe "die Pflicht laesst sich nur als neue Fassung aufheben (Fassung 3 ohne Pflicht)" \
  "$(gleich "$($PSQL "select count(*) from einwilligungs_texte where code='GLAUBENSANGABEN' and version=3 and pflicht=false;")" "1")"
OHNE_ART9=$(curl -s -X POST "${BASIS}/api/anmeldung" -H 'Content-Type: application/json' \
  -H 'X-Real-Ip: 203.0.113.31' -d "{
  \"aktion\": \"absenden\", \"versionId\": \"${VERSION_ID}\", \"einwilligungen\": [\"DATENSCHUTZ\"],
  \"antworten\": {
    \"anrede\": \"Herr\",
    \"vorname\": \"Gerd\", \"nachname\": \"Gemeindefrei\", \"geburtsdatum\": \"1985-03-03\",
    \"strasse\": \"Nebenweg 2\", \"plz\": \"32423\", \"ort\": \"Minden\",
    \"email\": \"ohne.einwilligung@beispiel.de\", \"telefon\": \"0571 000111\",
    \"schulabschluss\": \"Realschulabschluss\", \"erlernter_beruf\": \"Maler\", \"derzeitiger_beruf\": \"Maler\",
    \"gemeinde_mitglied\": \"FeG Herford\", \"motivation\": \"Das geht nur mich etwas an.\",
    \"teilnahmeform\": \"Als Hörer — ohne Prüfungen\",
    \"kontoinhaber\": \"Gerd Gemeindefrei\", \"iban\": \"DE89 3704 0044 0532 0130 00\",
    \"bank_name\": \"Volksbank\", \"einzug_einverstanden\": true, \"zahlweise\": \"Monatlich\"
  }
}")
$PSQL "update einwilligungs_texte set \"aktivBis\" = now() - interval '1 second' where code = 'GLAUBENSANGABEN' and pflicht = false and \"aktivBis\" is null;" > /dev/null
# Zugleich die Probe auf den Seed: Fassung 1 ist dort ausser Kraft gesetzt, es
# gilt genau eine Fassung.
pruefe "danach gilt wieder allein Fassung 2 mit Pflicht (Fassung 1 abgeloest, Fassung 3 ausser Kraft)" \
  "$(gleich "$($PSQL "select string_agg(version::text || ':' || pflicht::text, ',') from einwilligungs_texte where code='GLAUBENSANGABEN' and (\"aktivBis\" is null or \"aktivBis\" > now());")" "2:true")"
pruefe "die Anmeldung ohne Glaubensangaben wird angenommen" "$(echo "$OHNE_ART9" | grep -qc 'eingereicht' 2>/dev/null && echo 1 || echo 0)" "$OHNE_ART9"

FREI_ID=$($PSQL "select id from personen where email='ohne.einwilligung@beispiel.de';")
pruefe "die Akte wurde angelegt" "$([ -n "$FREI_ID" ] && echo 1 || echo 0)"
pruefe "die Gemeinde steht NICHT in der Akte" \
  "$(gleich "$($PSQL "select count(*) from personen where id='${FREI_ID}' and gemeinde is null;")" "1")"
pruefe "die Gemeinde steht NICHT im Antwort-JSON" \
  "$(gleich "$($PSQL "select count(*) from anmeldungen where antworten::text like '%FeG Herford%';")" "0")"
pruefe "auch der Freitext zur Motivation wurde verworfen" \
  "$(gleich "$($PSQL "select count(*) from anmeldungen where antworten::text like '%geht nur mich etwas an%';")" "0")"
# Die verweigerte Einwilligung ist selbst ein Nachweis und muss als Zeile mit
# erteilt = false dastehen — sonst laesst sich spaeter nicht belegen, warum die
# Angaben fehlen.
pruefe "die verweigerte Einwilligung ist als solche vermerkt" \
  "$(gleich "$($PSQL "select count(*) from einwilligungen e join einwilligungs_texte t on t.id = e.\"textId\" where e.\"personId\" = '${FREI_ID}' and t.code = 'GLAUBENSANGABEN' and e.erteilt = false;")" "1")"

# Betreffs der Verwaltungsmails ohne Personennamen (Code-Review 4, M6b). Bis
# hierher sind drei Anmeldungen, eine Selbstpflege und eine Hilfemeldung
# eingegangen. Die Verwaltungsmails gehen an die Rolle Verwaltung — die es noch
# nicht gibt; dann steht die Ausfallzeile ohne Vorlage mit demselben Betreff im
# Protokoll. Geprueft wird deshalb am Betreff selbst.
pruefe "kein Betreff traegt noch die alten Praefixe mit Namen" \
  "$(gleich "$($PSQL "select count(*) from email_versand where betreff ~ '^(Neue Anmeldung:|Stammdaten geändert:|Kommt nicht ins Portal:)';")" "0")"
pruefe "die drei festen Verwaltungsbetreffs sind entstanden (Gegenprobe)" \
  "$(gleich "$($PSQL "select count(distinct betreff) from email_versand where betreff in ('Neue Anmeldung eingegangen','Stammdaten geändert','Meldung zum Portalzugang');")" "3")"
pruefe "kein Betreff nennt einen der Anmeldenamen" \
  "$(gleich "$($PSQL "select count(*) from email_versand where betreff ilike any (array['%Petra%','%Beispiel%','%Gemeindefrei%','%Gerd%']);")" "0")"
pruefe "kein Betreff traegt einen Nachnamen der Akten als ganzes Wort" \
  "$(gleich "$($PSQL "select count(*) from email_versand v where exists (select 1 from personen p where v.betreff ~* ('\m' || p.nachname || '\M'));")" "0")"

echo
echo "=== 17. Wettlauf: derselbe Bestaetigungslink zweimal gleichzeitig ==="
# Das bedingte Update in `loeseEmailAenderungEin` ist die einzige Absicherung
# dagegen, dass zwei gleichzeitige Klicks beide gewinnen — und dieser Abschnitt
# ist die einzige Stelle, an der es ueberhaupt geprueft wird. Ein Doppelklick auf
# den Bestaetigungslink genuegt fuer den Fall.
WETTLAUF_ID=$($PSQL "insert into personen (id, vorname, nachname, email, \"statusCode\", \"erstelltAm\", \"aktualisiertAm\") values (gen_random_uuid(), 'Wanda', 'Wettlauf', 'wanda@beispiel.de', 'AKTIV', now(), now()) returning id;")
WTOKEN=$(uuidgen | tr 'A-Z' 'a-z')
WHASH=$(printf %s "$WTOKEN" | shasum -a 256 | cut -d' ' -f1)
$PSQL "insert into email_aenderungen (id, \"personId\", \"neueEmail\", \"tokenHash\", \"laeuftAb\", \"erstelltAm\") values (gen_random_uuid(), '${WETTLAUF_ID}', 'wanda.neu@beispiel.de', '${WHASH}', now() + interval '1 hour', now());" > /dev/null
# Ein offener Auskunftslink liegt im BISHERIGEN Postfach — mit der bestaetigten
# Adressaenderung muss er verfallen (Code-Review 4).
$PSQL "insert into datenauskuenfte (id, \"personId\", \"tokenHash\", \"laeuftAb\", \"erstelltAm\") values (gen_random_uuid(), '${WETTLAUF_ID}', '$(hash_von "$(neuer_token)")', now() + interval '1 day', now());" > /dev/null

curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/meine-daten/email/bestaetigen" \
  -H 'Content-Type: application/json' -d "{\"token\":\"${WTOKEN}\"}" > /tmp/gbs-wettlauf-1.txt &
curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/meine-daten/email/bestaetigen" \
  -H 'Content-Type: application/json' -d "{\"token\":\"${WTOKEN}\"}" > /tmp/gbs-wettlauf-2.txt &
wait
W1=$(cat /tmp/gbs-wettlauf-1.txt)
W2=$(cat /tmp/gbs-wettlauf-2.txt)
TREFFER=$(printf '%s\n%s\n' "$W1" "$W2" | grep -c '^200$')
pruefe "genau einer der beiden gleichzeitigen Aufrufe gewinnt" "$(gleich "$TREFFER" "1")" "${W1} / ${W2}"
pruefe "die neue Adresse steht genau einmal in der Akte" \
  "$(gleich "$($PSQL "select email from personen where id='${WETTLAUF_ID}';")" "wanda.neu@beispiel.de")"
pruefe "der Antrag ist danach entwertet" \
  "$(gleich "$($PSQL "select count(*) from email_aenderungen where \"tokenHash\"='${WHASH}' and \"benutztAm\" is not null;")" "1")"
pruefe "der offene Auskunftslink im alten Postfach ist mit verfallen" \
  "$(gleich "$($PSQL "select count(*) from datenauskuenfte where \"personId\"='${WETTLAUF_ID}' and \"laeuftAb\" > now();")" "0")"
pruefe "das Protokoll nennt die Zahl der entwerteten Auskunftslinks (1)" \
  "$(gleich "$($PSQL "select count(*) from audit_log where aktion='EMAIL_AENDERUNG_BESTAETIGT' and \"objektId\"='${WETTLAUF_ID}' and nachher::text like '%\"entwerteteAuskunftslinks\": 1%';")" "1")"

echo
echo "=== 18. Die Anfrage nach einem Anmeldelink verraet auch zeitlich nichts ==="
# Gleiche Antwort allein genuegt nicht: Bei unbekannter Adresse stiege die
# Funktion frueher aus, bei bekannter erst nach dem Versand. Der Unterschied ist
# ueber das Netz messbar, und die Auskunft „diese Person besucht die
# Bibelschule" ist eine Angabe zur Religionszugehoerigkeit (Art. 9 DSGVO).
# Deshalb die Mindestlaufzeit von 700 ms in `fordereMagicLinkAn`.
#
# Gemessen wird grob und mit reichlich Toleranz — hier geht es um
# Groessenordnungen, nicht um Millisekunden.
BEKANNT=$(curl -s -o /dev/null -w '%{time_total}' -X POST "${BASIS}/api/auth/anmelden" -H 'Content-Type: application/json' \
  -H 'X-Real-Ip: 203.0.113.40' -d '{"email":"petra.endgueltig@beispiel.de"}')
UNBEKANNT=$(curl -s -o /dev/null -w '%{time_total}' -X POST "${BASIS}/api/auth/anmelden" -H 'Content-Type: application/json' \
  -H 'X-Real-Ip: 203.0.113.41' -d '{"email":"gibtesnichtimportal@beispiel.de"}')
# In ganze Millisekunden umrechnen, damit die Shell damit rechnen kann. Das
# Komma statt des Punktes haengt an der Spracheinstellung des Rechners — deshalb
# erst `tr` und dann awk ausdruecklich in der C-Umgebung, sonst liest awk in
# einer deutschen Umgebung „0.712" als 0.
MS_BEKANNT=$(printf '%s' "$BEKANNT" | tr ',' '.' | LC_ALL=C awk '{printf "%d", $1 * 1000}')
MS_UNBEKANNT=$(printf '%s' "$UNBEKANNT" | tr ',' '.' | LC_ALL=C awk '{printf "%d", $1 * 1000}')
ABSTAND=$(( MS_BEKANNT > MS_UNBEKANNT ? MS_BEKANNT - MS_UNBEKANNT : MS_UNBEKANNT - MS_BEKANNT ))
pruefe "beide Anfragen brauchen die Mindestlaufzeit" \
  "$([ "$MS_BEKANNT" -ge 650 ] && [ "$MS_UNBEKANNT" -ge 650 ] && echo 1 || echo 0)" "bekannt ${MS_BEKANNT} ms, unbekannt ${MS_UNBEKANNT} ms"
pruefe "der Laufzeitunterschied bleibt unter 300 ms" \
  "$([ "$ABSTAND" -lt 300 ] && echo 1 || echo 0)" "${ABSTAND} ms"

echo
echo "=== 19. Audit-Log und Versandprotokoll ==="
for aktion in SEMESTER_ANGELEGT ANMELDUNG_EINGEREICHT ANMELDUNG_ANGENOMMEN SEMESTER_TEILNEHMER_UEBERNOMMEN TEILNEHMERLISTE_EXPORTIERT EIGENE_DATEN_GEAENDERT EMAIL_AENDERUNG_BEANTRAGT EMAIL_AENDERUNG_BESTAETIGT ZUGANG_HILFE_GEMELDET EMAIL_GEAENDERT_DURCH_VERWALTUNG ANMELDELINK_DURCH_VERWALTUNG PASSWORT_GESETZT PASSWORT_GEAENDERT ANGEMELDET_MIT_PASSWORT PASSWORT_ANMELDUNG_FEHLGESCHLAGEN PASSWORT_ANMELDUNG_GEDROSSELT PASSWORT_ENTFERNT; do
  pruefe "protokolliert: ${aktion}" "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='${aktion}';")" "t")"
done
pruefe "keine IBAN im Audit-Log" \
  "$(gleich "$($PSQL "select count(*) from audit_log where (coalesce(vorher::text,'') || coalesce(nachher::text,'')) ~ '${IBAN_MUSTER}';")" "0")"
# Seit Code-Review 4 (M6c) nur mit den NAMEN der geaenderten Felder: Das
# Audit-Log ist unloeschbar, eine Anschrift darin ueberlebte jede Anonymisierung.
pruefe "die Adressaenderung ist protokolliert — mit Feldnamen (strasse)" \
  "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='EIGENE_DATEN_GEAENDERT' and nachher->'geaenderteFelder' ? 'strasse';")" "t")"
pruefe "und ohne Werte: keine Anschrift, kein Telefon, keine Adresse im Audit-Log" \
  "$(gleich "$($PSQL "select count(*) from audit_log where (coalesce(vorher::text,'') || coalesce(nachher::text,'')) ilike any (array['%Neue Straße 7%','%Porta Westfalica%','%0571 999888%','%petra.privat@%','%petra@beispiel%','%petra.neu@%']);")" "0")"
pruefe "fehlgeschlagene Passwort-Anmeldungen stehen ohne Adresse im Protokoll" \
  "$(gleich "$($PSQL "select count(*) from audit_log where aktion='PASSWORT_ANMELDUNG_FEHLGESCHLAGEN' and coalesce(nachher::text,'') like '%@%';")" "0")"
pruefe "kein Passwort und kein Hash im Audit-Log" \
  "$(gleich "$($PSQL "select count(*) from audit_log where (coalesce(vorher::text,'') || coalesce(nachher::text,'')) ilike any (array['%Hirte%','%scrypt%','%Stecken%']);")" "0")"

# Dasselbe fuer das Versandprotokoll. Es wird in der Betriebsansicht angezeigt
# und ist damit fuer mehr Augen sichtbar als die Akte selbst — eine IBAN oder gar
# ein Passwort im Betreff waere genau die Weitergabe, gegen die die
# Verschluesselung antritt. Geprueft wird ueber alle Textspalten hinweg, damit
# eine neue Spalte nicht stillschweigend am Waechter vorbeilaeuft.
pruefe "keine IBAN im Versandprotokoll" \
  "$(gleich "$($PSQL "select count(*) from email_versand where (betreff || ' ' || empfaenger || ' ' || coalesce(\"vorlageCode\",'') || ' ' || coalesce(fehler,'')) ~ '${IBAN_MUSTER}';")" "0")"
pruefe "kein Passwort im Versandprotokoll" \
  "$(gleich "$($PSQL "select count(*) from email_versand where (betreff || ' ' || empfaenger || ' ' || coalesce(\"vorlageCode\",'') || ' ' || coalesce(fehler,'')) ilike any (array['%Hirte%','%Stecken%','%scrypt%']);")" "0")"
# Gegenprobe, damit die beiden Zeilen darueber nicht bestehen, weil die Tabelle
# schlicht leer ist.
pruefe "im Versandprotokoll stehen ueberhaupt Zeilen" \
  "$(gleich "$($PSQL "select count(*) > 0 from email_versand;")" "t")"

echo
echo "=== 20. Ehepartner-Ermaessigung bei der Aufnahme ==="
# Eine gemeinsame Anmeldung (ehepartner_gemeinsam=true) muss bei der Aufnahme die
# 50%-Ermaessigung am Konto setzen. Prueft den Weg Formularfeld -> antworten ->
# Aufnahme-Route -> person.ermaessigungCode gegen das grosse Bewerbungsformular.
EHE_EINREICHEN=$(curl -s -X POST "${BASIS}/api/anmeldung" -H 'Content-Type: application/json' -H 'X-Real-Ip: 203.0.113.20' -d "{
  \"aktion\": \"absenden\",
  \"versionId\": \"${VERSION_ID}\",
  \"einwilligungen\": [\"DATENSCHUTZ\", \"GLAUBENSANGABEN\"],
  \"antworten\": {
    \"anrede\": \"Herr\",
    \"vorname\": \"Klaus\", \"nachname\": \"Ehemann\", \"geburtsdatum\": \"1985-02-02\",
    \"strasse\": \"Ringstr. 3\", \"plz\": \"32423\", \"ort\": \"Minden\",
    \"email\": \"klaus@beispiel.de\", \"telefon\": \"0571 222333\",
    \"schulabschluss\": \"Abitur\", \"erlernter_beruf\": \"Tischler\", \"derzeitiger_beruf\": \"Tischler\",
    \"glaube_bekenntnis\": \"Ja.\", \"glaube_werdegang\": \"Seit der Jugend.\",
    \"gemeinde_mitglied\": \"FeG Minden\", \"gemeinde_beteiligung\": \"Woechentlich.\",
    \"dienst_erfahrung\": \"Hauskreis.\",
    \"motivation\": \"Vertiefung.\", \"ziele\": \"Bibelkenntnis.\",
    \"teilnahmeform\": \"Als Schüler — mit Prüfungen\",
    \"kontoinhaber\": \"Klaus Ehemann\", \"iban\": \"DE02 1203 0000 0000 2020 51\",
    \"bank_name\": \"Sparkasse\", \"einzug_einverstanden\": true, \"zahlweise\": \"Monatlich\",
    \"ehepartner_gemeinsam\": true
  }
}")
pruefe "Ehepartner-Anmeldung wird angenommen" "$(echo "$EHE_EINREICHEN" | grep -qc 'eingereicht' 2>/dev/null && echo 1 || echo 0)" "$EHE_EINREICHEN"
EHE_ANMELDUNG_ID=$($PSQL "select a.id from anmeldungen a join personen p on p.id=a.\"personId\" where p.email='klaus@beispiel.de' and a.status='EINGEREICHT' limit 1;")
curl -s -o /dev/null -X POST "${BASIS}/api/anmeldungen/${EHE_ANMELDUNG_ID}/entscheiden" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"entscheidung":"ANNEHMEN"}'
pruefe "Aufnahme setzt die Ehepartner-Ermaessigung am Konto" \
  "$(gleich "$($PSQL "select \"ermaessigungCode\" from personen where email='klaus@beispiel.de';")" "EHEPARTNER")"

echo
echo "=== 21. DSGVO-Auskunft: anstossen und abrufen ==="
# Anstoss durch die Schulleitung (Recht PERSON_EXPORTIEREN).
AUSK_ANSTOSS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/personen/${TEILNEHMER_ID}/auskunft" -H "Cookie: ${KEKS}")
pruefe "Auskunft anstossen ist erlaubt (200)" "$(gleich "$AUSK_ANSTOSS" "200")" "$AUSK_ANSTOSS"
pruefe "ein Auskunfts-Token wurde als 64-stelliger Hash angelegt" \
  "$(gleich "$($PSQL "select count(*) from datenauskuenfte where \"personId\"='${TEILNEHMER_ID}' and \"tokenHash\" ~ '^[0-9a-f]{64}\$';")" "1")"
pruefe "der Anstoss ist protokolliert (AUSKUNFT_ERSTELLT)" \
  "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='AUSKUNFT_ERSTELLT' and \"objektId\"='${TEILNEHMER_ID}';")" "t")"
# Ein Teilnehmer darf NICHT anstossen (kein PERSON_EXPORTIEREN).
AUSK_VERBOTEN=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/personen/${TEILNEHMER_ID}/auskunft" -H "Cookie: ${KEKS_TN}")
pruefe "ein Teilnehmer darf keine Auskunft anstossen (403)" "$(gleich "$AUSK_VERBOTEN" "403")" "$AUSK_VERBOTEN"

# Bekannten Hash auf den angelegten Token setzen (wie bei der E-Mail-Bestaetigung).
AUSK_TOKEN=$(uuidgen | tr 'A-Z' 'a-z')
AUSK_HASH=$(printf %s "$AUSK_TOKEN" | shasum -a 256 | cut -d' ' -f1)
$PSQL "update datenauskuenfte set \"tokenHash\"='${AUSK_HASH}' where \"personId\"='${TEILNEHMER_ID}';" > /dev/null
# Abruf per POST -> PDF; Header und Datei pruefen.
AUSK_KOPF=$(curl -s -D - -o /tmp/gbs-auskunft.pdf -X POST "${BASIS}/api/auskunft/abrufen" -H 'Content-Type: application/json' -d "{\"token\":\"${AUSK_TOKEN}\"}")
pruefe "der Abruf liefert Content-Type application/pdf" "$(echo "$AUSK_KOPF" | grep -qi 'content-type: application/pdf' && echo 1 || echo 0)"
pruefe "der Abruf setzt Cache-Control: no-store" "$(echo "$AUSK_KOPF" | grep -qi 'cache-control: no-store' && echo 1 || echo 0)"
pruefe "die heruntergeladene Datei ist eine PDF" "$(head -c 5 /tmp/gbs-auskunft.pdf | grep -qa '%PDF-' && echo 1 || echo 0)"
pruefe "der Abruf ist protokolliert (AUSKUNFT_ABGERUFEN)" \
  "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='AUSKUNFT_ABGERUFEN';")" "t")"
# Unbekannter Token -> 401.
AUSK_UNGUELTIG=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/auskunft/abrufen" -H 'Content-Type: application/json' -d "{\"token\":\"$(uuidgen | tr 'A-Z' 'a-z')\"}")
pruefe "unbekannter Token wird abgewiesen (401)" "$(gleich "$AUSK_UNGUELTIG" "401")" "$AUSK_UNGUELTIG"
# Verstorbene Person -> 410, auch fuer einen gueltigen Token.
$PSQL "update personen set \"statusCode\"='VERSTORBEN' where id='${TEILNEHMER_ID}';" > /dev/null
VAUSK_TOKEN=$(uuidgen | tr 'A-Z' 'a-z'); VAUSK_HASH=$(printf %s "$VAUSK_TOKEN" | shasum -a 256 | cut -d' ' -f1)
$PSQL "insert into datenauskuenfte (id,\"personId\",\"tokenHash\",\"laeuftAb\",\"erstelltAm\") values (gen_random_uuid(),'${TEILNEHMER_ID}','${VAUSK_HASH}', now()+interval '1 hour', now());" > /dev/null
AUSK_VERSTORBEN=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/auskunft/abrufen" -H 'Content-Type: application/json' -d "{\"token\":\"${VAUSK_TOKEN}\"}")
pruefe "fuer eine verstorbene Person wird der Abruf gesperrt (410)" "$(gleich "$AUSK_VERSTORBEN" "410")" "$AUSK_VERSTORBEN"
$PSQL "update personen set \"statusCode\"='ANGENOMMEN' where id='${TEILNEHMER_ID}';" > /dev/null

echo
echo "=== 22. Kursraster: Seed und Schema ==="
pruefe "sieben Faecher wurden geseedet" \
  "$(gleich "$($PSQL "select count(*) from faecher;")" "7")"
pruefe "dreizehn Kurseinheiten wurden geseedet" \
  "$(gleich "$($PSQL "select count(*) from kurseinheiten;")" "13")"
pruefe "die sechs echten Semester wurden geseedet" \
  "$(gleich "$($PSQL "select count(*) from semester where code in ('2026-H','2027-F','2027-H','2028-F','2028-H','2029-F');")" "6")"
pruefe "Semester traegt lehrjahr/halbjahr (Kopplung ans Kursraster)" \
  "$(gleich "$($PSQL "select count(*) from information_schema.columns where table_name='semester' and column_name in ('lehrjahr','halbjahr');")" "2")"
pruefe "Teilnahme hat den Aufraeum-Index auf dem Bestaetigungslink" \
  "$(gleich "$($PSQL "select count(*) from pg_indexes where tablename='teilnahmen' and indexname='teilnahmen_bestaetigungLaeuftAb_idx';")" "1")"
pruefe "Kurseinheit-Fremdschluessel auf Fach ist RESTRICT" \
  "$(gleich "$($PSQL "select confdeltype from pg_constraint where conname='kurseinheiten_fachCode_fkey';")" "r")"
pruefe "die Ueberleitungs-Migration ist als angewendet eingetragen" \
  "$(gleich "$($PSQL "select count(*) from _prisma_migrations where migration_name='20260729130000_semesterueberleitung_und_faecher' and finished_at is not null;")" "1")"
# Rueckmeldung zur Ueberleitung (Code-Review 4, M10): „bin raus" und „keine
# Rueckmeldung" melden die Teilnahme ab; Grund genau dann, wenn abgemeldet.
pruefe "Teilnahme traegt eingeladenAm, abgemeldetAm und abmeldeGrund" \
  "$(gleich "$($PSQL "select count(*) from information_schema.columns where table_name='teilnahmen' and column_name in ('eingeladenAm','abgemeldetAm','abmeldeGrund');")" "3")"
pruefe "der CHECK teilnahmen_abmeldung_konsistent existiert" \
  "$(gleich "$($PSQL "select count(*) from pg_constraint where conname='teilnahmen_abmeldung_konsistent';")" "1")"
pruefe "abgemeldet ohne Grund weist die Datenbank ab (CHECK)" \
  "$($PSQL "update teilnahmen set \"abgemeldetAm\" = now() where id = (select id from teilnahmen order by \"erstelltAm\" limit 1);" 2>&1 | grep -q 'teilnahmen_abmeldung_konsistent' && echo 1 || echo 0)"

echo
echo "=== 23. Semesterueberleitung: einladen, bestaetigen, erinnern ==="
# Quelle: eine aktive Teilnahme im laufenden Semester (2099-H). Ziel: ein eigenes,
# relativ datiertes Folgesemester im 1. Lehrjahr, Fruehling. Frueher war es das
# Seed-Semester 2027-F — ab dessen Beginn (16.02.2027) weist die Sperre fuer
# begonnene Ziele den Start mit 409 ab, und der Abschnitt wurde rot (M19).
$PSQL "insert into teilnahmen (id,\"personId\",\"semesterId\",teilnahmeform,\"erstelltAm\") values (gen_random_uuid(),'${TEILNEHMER_ID}','${SEMESTER_ID}','SCHUELER',now()) on conflict (\"personId\",\"semesterId\") do nothing;" > /dev/null
ZIEL=$(curl -s -X POST "${BASIS}/api/semester" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d "{\"code\":\"UEB-ZIEL\",\"bezeichnung\":\"Folgesemester Test\",\"start\":\"$(tag 30)\",\"ende\":\"$(tag 120)\",\"lehrjahr\":1,\"halbjahr\":2}")
TARGET_ID=$(echo "$ZIEL" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
pruefe "das Zielsemester wird mit Lehrjahr und Halbjahr angelegt (1/2)" \
  "$(gleich "$($PSQL "select lehrjahr || '/' || halbjahr from semester where id='${TARGET_ID}';")" "1/2")" "$ZIEL"

UEBER=$(curl -s -X POST "${BASIS}/api/semesterueberleitung/start" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${TARGET_ID}\"}")
pruefe "Ueberleitung starten ist erlaubt und meldet Eingeladene" "$(echo "$UEBER" | grep -qc '"eingeladen"' && echo 1 || echo 0)" "$UEBER"
# Der Versand laeuft nach der Antwort (after()) — die Antwort kann ihn nicht kennen.
pruefe "die Antwort behauptet keinen Versand (kein \"gesendet\")" "$(fehlt_in "$UEBER" '"gesendet"')" "$UEBER"
pruefe "neue Teilnahme im Zielsemester mit Bestaetigungslink, noch unbestaetigt" \
  "$(gleich "$($PSQL "select count(*) from teilnahmen where \"personId\"='${TEILNEHMER_ID}' and \"semesterId\"='${TARGET_ID}' and \"bestaetigungTokenHash\" is not null and \"bestaetigtAm\" is null;")" "1")"
pruefe "die Teilnahme ist als eingeladen markiert (eingeladenAm)" \
  "$(gleich "$($PSQL "select count(*) from teilnahmen where \"personId\"='${TEILNEHMER_ID}' and \"semesterId\"='${TARGET_ID}' and \"eingeladenAm\" is not null;")" "1")"
# Beginn in 30 Tagen: Kein Erinnerungsstichtag (T-14/-7/-3) ist erreicht, die
# Einladung erledigt also keine Stufe mit.
pruefe "bei Beginn in 30 Tagen erledigt die Einladung keine Erinnerungsstufe" \
  "$(gleich "$($PSQL "select count(*) from teilnahmen where \"semesterId\"='${TARGET_ID}' and coalesce(\"erinnertStufe1Am\", \"erinnertStufe2Am\", \"erinnertStufe3Am\") is not null;")" "0")"
pruefe "die Ueberleitung ist protokolliert (SEMESTER_UEBERLEITUNG_GESTARTET)" \
  "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='SEMESTER_UEBERLEITUNG_GESTARTET' and \"objektId\"='${TARGET_ID}';")" "t")"
# Den Versandstand traegt der Hintergrundlauf als eigenen Eintrag nach.
for i in $(seq 1 10); do
  VERSENDET=$($PSQL "select count(*) from audit_log where aktion='SEMESTER_UEBERLEITUNG_VERSENDET' and \"objektId\"='${TARGET_ID}';")
  [ "$VERSENDET" != "0" ] && break
  sleep 1
done
pruefe "der Versand der Einladungen ist nachgetragen (SEMESTER_UEBERLEITUNG_VERSENDET)" "$(gleich "$VERSENDET" "1")" "$VERSENDET"

# Idempotenz: ein zweiter Start laedt niemanden doppelt ein.
UEBER2=$(curl -s -X POST "${BASIS}/api/semesterueberleitung/start" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${TARGET_ID}\"}")
pruefe "ein zweiter Start laedt niemanden ein (\"eingeladen\":0)" "$(enthaelt "$UEBER2" '"eingeladen":0')" "$UEBER2"
pruefe "ein zweiter Start legt keine zweite Teilnahme an" \
  "$(gleich "$($PSQL "select count(*) from teilnahmen where \"personId\"='${TEILNEHMER_ID}' and \"semesterId\"='${TARGET_ID}';")" "1")"

# Ein Teilnehmer darf die Ueberleitung nicht anstossen (kein SEMESTER_VERWALTEN).
UEBER_VERBOTEN=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/semesterueberleitung/start" -H "Cookie: ${KEKS_TN}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${TARGET_ID}\"}")
pruefe "ein Teilnehmer darf keine Ueberleitung starten (403)" "$(gleich "$UEBER_VERBOTEN" "403")" "$UEBER_VERBOTEN"

# „Ich bin dabei": bekannten Hash auf den Token der Ziel-Teilnahme setzen und einloesen.
DABEI_TOKEN=$(uuidgen | tr 'A-Z' 'a-z'); DABEI_HASH=$(printf %s "$DABEI_TOKEN" | shasum -a 256 | cut -d' ' -f1)
$PSQL "update teilnahmen set \"bestaetigungTokenHash\"='${DABEI_HASH}', \"bestaetigungLaeuftAb\"=now()+interval '30 days' where \"personId\"='${TEILNEHMER_ID}' and \"semesterId\"='${TARGET_ID}';" > /dev/null
DABEI=$(curl -s -X POST "${BASIS}/api/ueberleitung/bestaetigen" -H 'Content-Type: application/json' -d "{\"token\":\"${DABEI_TOKEN}\"}")
pruefe "bin-dabei setzt bestaetigtAm" \
  "$(gleich "$($PSQL "select count(*) from teilnahmen where \"personId\"='${TEILNEHMER_ID}' and \"semesterId\"='${TARGET_ID}' and \"bestaetigtAm\" is not null;")" "1")"
pruefe "bin-dabei zeigt die Faecher des Zielsemesters (1. Lehrjahr, Fruehling)" \
  "$(enthaelt "$DABEI" "Weisheitsliteratur")" "$DABEI"
pruefe "die Bestaetigung ist protokolliert (TEILNAHME_BESTAETIGT)" \
  "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='TEILNAHME_BESTAETIGT';")" "t")"

# Idempotent: ein zweiter Klick meldet freundlich „schon bestaetigt", kein Fehler.
DABEI2=$(curl -s -X POST "${BASIS}/api/ueberleitung/bestaetigen" -H 'Content-Type: application/json' -d "{\"token\":\"${DABEI_TOKEN}\"}")
pruefe "ein zweiter Klick meldet schon_bestaetigt" "$(enthaelt "$DABEI2" "schon_bestaetigt")" "$DABEI2"

# Unbekannter Token -> 401.
DABEI_UNG=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/ueberleitung/bestaetigen" -H 'Content-Type: application/json' -d "{\"token\":\"$(uuidgen | tr 'A-Z' 'a-z')\"}")
pruefe "ein unbekannter bin-dabei-Token wird abgewiesen (401)" "$(gleich "$DABEI_UNG" "401")" "$DABEI_UNG"

# Der Erinnerungs-Cron ist ohne CRON_SECRET (im Durchstich nicht gesetzt) gesperrt.
CRON=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/cron/erinnerungen")
pruefe "der Erinnerungs-Cron ohne CRON_SECRET antwortet 503" "$(gleich "$CRON" "503")" "$CRON"

echo
echo "=== 23b. Semesterueberleitung: Zusage von Hand (Anruf statt Link) ==="
# Empfehlung Semesterbetrieb (27.09.2026): Wer am Telefon zusagte, fiel am
# Starttag als „keine Rueckmeldung“ heraus. Die Schulleitung traegt die Zusage
# jetzt selbst ein (POST /api/semesterueberleitung/zusage, SEMESTER_VERWALTEN).
# Eigenes Zielsemester in 30 Tagen (keine Erinnerungsstufe faellig) und Personen
# ohne Rolle — sie tauchen in keiner Liste von 2099-H auf.
ZU_SEM=$($PSQL "insert into semester (id, code, bezeichnung, start, ende, \"erstelltAm\") values (gen_random_uuid(), 'UEB-ZUSAGE', 'Zusage von Hand', '$(tag 30)', '$(tag 120)', now()) returning id;")
zusage_einladung() { # $1 personId -> Id einer offenen Einladung in UEB-ZUSAGE
  $PSQL "insert into teilnahmen (id, \"personId\", \"semesterId\", teilnahmeform, \"eingeladenAm\", \"bestaetigungTokenHash\", \"bestaetigungLaeuftAb\", \"erstelltAm\") values (gen_random_uuid(), '$1', '${ZU_SEM}', 'SCHUELER', now(), '$(hash_von "$(neuer_token)")', '$(tag 30)', now()) returning id;"
}
zusage() { rumpf_und_status -X POST "${BASIS}/api/semesterueberleitung/zusage" -H 'Content-Type: application/json' "$@"; }

ZU_T1=$(zusage_einladung "$(person_anlegen Konrad Anruf AKTIV)")
ZU_TN=$(zusage -H "Cookie: ${KEKS_TN}" -d "{\"teilnahmeId\":\"${ZU_T1}\"}")
ZU_OHNE=$(zusage -d "{\"teilnahmeId\":\"${ZU_T1}\"}")
pruefe "Zusage von Hand: Teilnehmer 403, ohne Sitzung 401 — die Einladung bleibt offen" \
  "$([ "$ZU_TN" = "403" ] && [ "$ZU_OHNE" = "401" ] && [ "$($PSQL "select \"bestaetigtAm\" is null from teilnahmen where id='${ZU_T1}';")" = "t" ] && echo 1 || echo 0)" "${ZU_TN}/${ZU_OHNE}"
ZU_OK=$(zusage -H "Cookie: ${KEKS}" -d "{\"teilnahmeId\":\"${ZU_T1}\"}")
pruefe "die Schulleitung traegt die Zusage ein (200, genau {\"data\":{\"bestaetigt\":true}})" \
  "$([ "$ZU_OK" = "200" ] && [ "$(cat /tmp/gbs-rumpf.txt)" = '{"data":{"bestaetigt":true}}' ] && echo 1 || echo 0)" "$ZU_OK $(cat /tmp/gbs-rumpf.txt)"
pruefe "die Teilnahme gilt damit als bestaetigt, nicht als abgemeldet" \
  "$(gleich "$($PSQL "select \"bestaetigtAm\" is not null and \"abgemeldetAm\" is null from teilnahmen where id='${ZU_T1}';")" "t")"
pruefe "das Protokoll haelt die Zusage fest (TEILNAHME_ZUSAGE_EINGETRAGEN: Teilnahme, Akteur, Semesterkuerzel, Zeitpunkt)" \
  "$(gleich "$($PSQL "select count(*) from audit_log where aktion='TEILNAHME_ZUSAGE_EINGETRAGEN' and \"objektTyp\"='Teilnahme' and \"objektId\"='${ZU_T1}' and \"akteurId\"='${SCHULLEITER_ID}' and nachher->>'semester'='UEB-ZUSAGE' and nachher->>'bestaetigtAm' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T';")" "1")"
ZU_2=$(zusage -H "Cookie: ${KEKS}" -d "{\"teilnahmeId\":\"${ZU_T1}\"}")
pruefe "ein zweites Mal: 409 „bereits bestätigt“ — ohne zweiten Protokolleintrag" \
  "$([ "$ZU_2" = "409" ] && grep -q 'bereits bestätigt' /tmp/gbs-rumpf.txt && [ "$($PSQL "select count(*) from audit_log where aktion='TEILNAHME_ZUSAGE_EINGETRAGEN' and \"objektId\"='${ZU_T1}';")" = "1" ] && echo 1 || echo 0)" "$ZU_2 $(cat /tmp/gbs-rumpf.txt)"
# „Ich bin raus“ — per SQL gesetzt, wie es die Antwort ueber den Link tut.
ZU_T2=$(zusage_einladung "$(person_anlegen Rosa Raus AKTIV)")
$PSQL "update teilnahmen set \"abgemeldetAm\" = now(), \"abmeldeGrund\" = 'BIN_RAUS' where id='${ZU_T2}';" > /dev/null
ZU_RAUS=$(zusage -H "Cookie: ${KEKS}" -d "{\"teilnahmeId\":\"${ZU_T2}\"}")
pruefe "nach „Ich bin raus“: 409 mit dem Weg „Wieder aufnehmen“ — keine Zusage" \
  "$([ "$ZU_RAUS" = "409" ] && grep -q 'Wieder aufnehmen' /tmp/gbs-rumpf.txt && [ "$($PSQL "select \"bestaetigtAm\" is null and \"abgemeldetAm\" is not null from teilnahmen where id='${ZU_T2}';")" = "t" ] && echo 1 || echo 0)" "$ZU_RAUS $(cat /tmp/gbs-rumpf.txt)"
ZU_T3=$($PSQL "insert into teilnahmen (id, \"personId\", \"semesterId\", teilnahmeform, \"erstelltAm\") values (gen_random_uuid(), '$(person_anlegen Dirk Direkt AKTIV)', '${ZU_SEM}', 'SCHUELER', now()) returning id;")
ZU_DIREKT=$(zusage -H "Cookie: ${KEKS}" -d "{\"teilnahmeId\":\"${ZU_T3}\"}")
pruefe "eine direkt aufgenommene Teilnahme (ohne Einladung): 409 „keine offene Einladung“" \
  "$([ "$ZU_DIREKT" = "409" ] && grep -q 'keine offene Einladung' /tmp/gbs-rumpf.txt && [ "$($PSQL "select \"bestaetigtAm\" is null from teilnahmen where id='${ZU_T3}';")" = "t" ] && echo 1 || echo 0)" "$ZU_DIREKT $(cat /tmp/gbs-rumpf.txt)"
ZU_T4=$(zusage_einladung "$(person_anlegen Anja Abbruch ABGEBROCHEN)")
ZU_INAKTIV=$(zusage -H "Cookie: ${KEKS}" -d "{\"teilnahmeId\":\"${ZU_T4}\"}")
pruefe "eine nicht aktive Person (abgebrochen): 409 „nicht aktiv“ — die Einladung bleibt offen" \
  "$([ "$ZU_INAKTIV" = "409" ] && grep -q 'nicht aktiv (Status' /tmp/gbs-rumpf.txt && [ "$($PSQL "select \"bestaetigtAm\" is null and \"abgemeldetAm\" is null from teilnahmen where id='${ZU_T4}';")" = "t" ] && echo 1 || echo 0)" "$ZU_INAKTIV $(cat /tmp/gbs-rumpf.txt)"
ZU_404=$(zusage -H "Cookie: ${KEKS}" -d "{\"teilnahmeId\":\"$(neuer_token)\"}")
ZU_404_TEXT=$(cat /tmp/gbs-rumpf.txt)
ZU_400=$(zusage -H "Cookie: ${KEKS}" -d '{"teilnahmeId":"x"}')
pruefe "eine unbekannte Teilnahme: 404, eine ungueltige Id: 400" \
  "$([ "$ZU_404" = "404" ] && echo "$ZU_404_TEXT" | grep -q 'Diese Teilnahme gibt es nicht' && [ "$ZU_400" = "400" ] && grep -q 'Ungültige Anfrage' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "${ZU_404}/${ZU_400}"

echo
echo "=== 24. Stundenplan: Schema und Seed ==="
pruefe "Tabelle unterrichtstermine existiert" \
  "$(gleich "$($PSQL "select count(*) from information_schema.tables where table_name='unterrichtstermine';")" "1")"
pruefe "Tabelle anwesenheiten existiert" \
  "$(gleich "$($PSQL "select count(*) from information_schema.tables where table_name='anwesenheiten';")" "1")"
pruefe "Enum Anwesenheitsstatus existiert" \
  "$(gleich "$($PSQL "select count(*) from pg_type where typname='Anwesenheitsstatus';")" "1")"
pruefe "Anwesenheit ist je Termin+Teilnahme eindeutig (Index)" \
  "$(gleich "$($PSQL "select count(*) from pg_indexes where tablename='anwesenheiten' and indexname='anwesenheiten_terminId_teilnahmeId_key';")" "1")"
pruefe "Einstellung ANWESENHEIT_MINDEST_PROZENT ist geseedet (80)" \
  "$(gleich "$($PSQL "select wert from einstellungen where schluessel='ANWESENHEIT_MINDEST_PROZENT';")" "80")"
pruefe "die Stundenplan-Migration ist als angewendet eingetragen" \
  "$(gleich "$($PSQL "select count(*) from _prisma_migrations where migration_name='20260729140000_stundenplan' and finished_at is not null;")" "1")"

echo
echo "=== 25. Stundenplan: Termine, Fachzuordnung, Anwesenheit ==="
# Die zehn Dienstagabende des laufenden Semesters (2099-H) anlegen.
GEN=$(curl -s -X POST "${BASIS}/api/stundenplan/termine/generieren" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${SEMESTER_ID}\"}")
pruefe "Termine anlegen meldet die angelegten Abende" "$(echo "$GEN" | grep -qc '"angelegt"' && echo 1 || echo 0)" "$GEN"
pruefe "es sind zehn Unterrichtsabende angelegt" \
  "$(gleich "$($PSQL "select count(*) from unterrichtstermine where \"semesterId\"='${SEMESTER_ID}';")" "10")"
# Idempotenz: ein zweiter Aufruf legt nichts doppelt an.
curl -s -o /dev/null -X POST "${BASIS}/api/stundenplan/termine/generieren" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${SEMESTER_ID}\"}"
pruefe "ein zweiter Anlege-Lauf legt keinen elften Abend an" \
  "$(gleich "$($PSQL "select count(*) from unterrichtstermine where \"semesterId\"='${SEMESTER_ID}';")" "10")"
# Ein Teilnehmer darf keine Termine anlegen.
GEN_VERBOTEN=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/stundenplan/termine/generieren" -H "Cookie: ${KEKS_TN}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${SEMESTER_ID}\"}")
pruefe "ein Teilnehmer darf keine Termine anlegen (403)" "$(gleich "$GEN_VERBOTEN" "403")" "$GEN_VERBOTEN"

TERMIN_ID=$($PSQL "select id from unterrichtstermine where \"semesterId\"='${SEMESTER_ID}' order by beginn asc limit 1;")
KURSEINHEIT_ID=$($PSQL "select id from kurseinheiten limit 1;")
# Einem Abend ein Fach zuordnen.
curl -s -o /dev/null -X PUT "${BASIS}/api/stundenplan/termine/${TERMIN_ID}" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"kurseinheitId\":\"${KURSEINHEIT_ID}\"}"
pruefe "einem Termin laesst sich ein Fach zuordnen" \
  "$(gleich "$($PSQL "select \"kurseinheitId\" from unterrichtstermine where id='${TERMIN_ID}';")" "${KURSEINHEIT_ID}")"

# Anwesenheit fuer eine Teilnahme erfassen (die in Abschnitt 23 angelegte).
TEILNAHME_ID=$($PSQL "select id from teilnahmen where \"personId\"='${TEILNEHMER_ID}' and \"semesterId\"='${SEMESTER_ID}';")
curl -s -o /dev/null -X POST "${BASIS}/api/stundenplan/anwesenheit" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"terminId\":\"${TERMIN_ID}\",\"eintraege\":[{\"teilnahmeId\":\"${TEILNAHME_ID}\",\"status\":\"ANWESEND\"}]}"
pruefe "Anwesenheit wird als ANWESEND erfasst" \
  "$(gleich "$($PSQL "select status from anwesenheiten where \"terminId\"='${TERMIN_ID}' and \"teilnahmeId\"='${TEILNAHME_ID}';")" "ANWESEND")"
pruefe "die Erfassung ist protokolliert (ANWESENHEIT_ERFASST)" \
  "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='ANWESENHEIT_ERFASST' and \"objektId\"='${TERMIN_ID}';")" "t")"

# Einen Abend loeschen (der letzte) — Anwesenheiten haengen per Cascade daran.
LETZTER_TERMIN=$($PSQL "select id from unterrichtstermine where \"semesterId\"='${SEMESTER_ID}' order by beginn desc limit 1;")
curl -s -o /dev/null -X DELETE "${BASIS}/api/stundenplan/termine/${LETZTER_TERMIN}" -H "Cookie: ${KEKS}"
pruefe "ein geloeschter Abend verringert die Zahl auf neun" \
  "$(gleich "$($PSQL "select count(*) from unterrichtstermine where \"semesterId\"='${SEMESTER_ID}';")" "9")"

echo
echo "=== 26. Worker: Einzellauf im gebauten Image ==="
# Der Worker liegt als eigenes Bundle im Image und laesst sich mit WORKER_EINMAL=1
# einmal ausfuehren — genau das, was der worker-Container stuendlich tut.
#
# Vor dem Lauf wird angelegt, was er erledigen muss: eine unbeantwortete
# Einladung in ein Semester, das heute beginnt (Abmeldung „keine Rueckmeldung"),
# eine offene Einladung am Erinnerungsstichtag T-14 (ohne SMTP) und je ein
# abgelaufener und ein frischer Datensatz fuer den Aufraeumlauf. So belegt der
# Lauf nicht nur, DASS er lief, sondern WAS er tat. Frueher wurde hier nur
# „ein Audit-Eintrag mehr" gezaehlt — das haelt nur beim ersten Lauf, weil ein
# Lauf ohne Loeschungen hoechstens alle zwoelf Stunden einen Eintrag schreibt.
pruefe "worker.js liegt im Image" "$(docker exec gbs-durchstich test -f worker.js && echo 1 || echo 0)"

# Helfer ohne Rolle und ohne Teilnahme im laufenden Semester — sie tauchen in
# keiner Liste von 2099-H auf.
UEB_P1=$($PSQL "insert into personen (id, vorname, nachname, email, \"statusCode\", \"erstelltAm\", \"aktualisiertAm\") values (gen_random_uuid(), 'Ulf', 'Ueberleitung', 'ulf.ueberleitung@beispiel.de', 'AKTIV', now(), now()) returning id;")
UEB_P2=$($PSQL "insert into personen (id, vorname, nachname, email, \"statusCode\", \"erstelltAm\", \"aktualisiertAm\") values (gen_random_uuid(), 'Ute', 'Ueberleitung', 'ute.ueberleitung@beispiel.de', 'AKTIV', now(), now()) returning id;")
UEB_P3=$($PSQL "insert into personen (id, vorname, nachname, email, \"statusCode\", \"erstelltAm\", \"aktualisiertAm\") values (gen_random_uuid(), 'Uwe', 'Ueberleitung', 'uwe.ueberleitung@beispiel.de', 'AKTIV', now(), now()) returning id;")
UEB_P4=$($PSQL "insert into personen (id, vorname, nachname, email, \"statusCode\", \"erstelltAm\", \"aktualisiertAm\") values (gen_random_uuid(), 'Udo', 'Ueberleitung', 'udo.ueberleitung@beispiel.de', 'AKTIV', now(), now()) returning id;")

# Ein Semester, das HEUTE beginnt: Die Rueckmeldung ist geschlossen. A ist
# eingeladen und hat nicht geantwortet, B direkt aufgenommen (ohne Einladung),
# D hat laengst zugesagt, ihr Link ist seit acht Tagen abgelaufen.
UEB_ALT=$($PSQL "insert into semester (id, code, bezeichnung, start, ende, \"erstelltAm\") values (gen_random_uuid(), 'UEB-ALT', 'Ueberleitung begonnen', '${HEUTE}', '$(tag 60)', now()) returning id;")
T_ALT=$(neuer_token)
UEB_A=$($PSQL "insert into teilnahmen (id, \"personId\", \"semesterId\", teilnahmeform, \"eingeladenAm\", \"bestaetigungTokenHash\", \"bestaetigungLaeuftAb\", \"erstelltAm\") values (gen_random_uuid(), '${UEB_P1}', '${UEB_ALT}', 'SCHUELER', now() - interval '3 days', '$(hash_von "$T_ALT")', now() + interval '1 day', now()) returning id;")
UEB_B=$($PSQL "insert into teilnahmen (id, \"personId\", \"semesterId\", teilnahmeform, \"erstelltAm\") values (gen_random_uuid(), '${UEB_P2}', '${UEB_ALT}', 'SCHUELER', now()) returning id;")
UEB_D=$($PSQL "insert into teilnahmen (id, \"personId\", \"semesterId\", teilnahmeform, \"eingeladenAm\", \"bestaetigtAm\", \"bestaetigungTokenHash\", \"bestaetigungLaeuftAb\", \"erstelltAm\") values (gen_random_uuid(), '${UEB_P4}', '${UEB_ALT}', 'SCHUELER', now() - interval '20 days', now() - interval '10 days', '$(hash_von "$(neuer_token)")', now() - interval '8 days', now()) returning id;")

GESCHLOSSEN=$(status_von -X POST "${BASIS}/api/ueberleitung/bestaetigen" -H 'Content-Type: application/json' -d "{\"token\":\"${T_ALT}\"}")
pruefe "ab Semesterbeginn ist die Rueckmeldung ueber den Link geschlossen (409)" "$(gleich "$GESCHLOSSEN" "409")" "$GESCHLOSSEN"
BEGONNEN=$(status_von -X POST "${BASIS}/api/semesterueberleitung/start" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${UEB_ALT}\"}")
pruefe "in ein begonnenes Semester laedt keine Ueberleitung ein (409)" "$(gleich "$BEGONNEN" "409")" "$BEGONNEN"

# Heute ist der Stichtag T-14: C ist eingeladen und hat nicht geantwortet.
UEB_T14=$($PSQL "insert into semester (id, code, bezeichnung, start, ende, \"erstelltAm\") values (gen_random_uuid(), 'UEB-T14', 'Ueberleitung in zwei Wochen', '$(tag 14)', '$(tag 100)', now()) returning id;")
T14=$(neuer_token)
UEB_C=$($PSQL "insert into teilnahmen (id, \"personId\", \"semesterId\", teilnahmeform, \"eingeladenAm\", \"bestaetigungTokenHash\", \"bestaetigungLaeuftAb\", \"erstelltAm\") values (gen_random_uuid(), '${UEB_P3}', '${UEB_T14}', 'SCHUELER', now(), '$(hash_von "$T14")', '$(tag 14)', now()) returning id;")

# Fuer den Aufraeumlauf: je ein abgelaufener und ein frischer Datensatz.
# Einmal-Token verfallen sieben Tage nach Ablauf, Drosselzeilen nach einem Tag,
# Anmeldeentwuerfe mit ihrem Fortsetzen-Link — entschiedene Anmeldungen nie.
AR_LINK_ALT=$(hash_von "$(neuer_token)"); AR_LINK_NEU=$(hash_von "$(neuer_token)")
$PSQL "insert into magic_links (id, \"personId\", \"tokenHash\", \"laeuftAb\", \"erstelltAm\") values (gen_random_uuid(), '${SCHULLEITER_ID}', '${AR_LINK_ALT}', now() - interval '8 days', now() - interval '8 days'), (gen_random_uuid(), '${SCHULLEITER_ID}', '${AR_LINK_NEU}', now() + interval '1 hour', now());" > /dev/null
AR_EW_ALT=$(hash_von "$(neuer_token)"); AR_EW_NEU=$(hash_von "$(neuer_token)"); AR_EW_FEST=$(hash_von "$(neuer_token)")
$PSQL "insert into anmeldungen (id, status, antworten, \"formularVersionId\", \"fortsetzenTokenHash\", \"fortsetzenLaeuftAb\", \"erstelltAm\", \"aktualisiertAm\") values (gen_random_uuid(), 'ENTWURF', '{}', '${VERSION_ID}', '${AR_EW_ALT}', now() - interval '1 hour', now(), now()), (gen_random_uuid(), 'ENTWURF', '{}', '${VERSION_ID}', '${AR_EW_NEU}', now() + interval '1 day', now(), now()), (gen_random_uuid(), 'ABGELEHNT', '{}', '${VERSION_ID}', '${AR_EW_FEST}', now() - interval '1 hour', now(), now());" > /dev/null
AR_AUSK_ALT=$(hash_von "$(neuer_token)"); AR_AUSK_NEU=$(hash_von "$(neuer_token)"); AR_EMAIL_ALT=$(hash_von "$(neuer_token)")
$PSQL "insert into datenauskuenfte (id, \"personId\", \"tokenHash\", \"laeuftAb\", \"erstelltAm\") values (gen_random_uuid(), '${SCHULLEITER_ID}', '${AR_AUSK_ALT}', now() - interval '8 days', now() - interval '9 days'), (gen_random_uuid(), '${SCHULLEITER_ID}', '${AR_AUSK_NEU}', now() + interval '1 day', now());" > /dev/null
$PSQL "insert into email_aenderungen (id, \"personId\", \"neueEmail\", \"tokenHash\", \"laeuftAb\", \"erstelltAm\") values (gen_random_uuid(), '${SCHULLEITER_ID}', 'aufraeum.alt@beispiel.de', '${AR_EMAIL_ALT}', now() - interval '8 days', now() - interval '9 days');" > /dev/null
$PSQL "insert into rate_limit (id, schluessel, zeitpunkt) values (gen_random_uuid(), 'AUFRAEUM-TEST:alt', now() - interval '2 days'), (gen_random_uuid(), 'AUFRAEUM-TEST:neu', now());" > /dev/null

# Rueckmeldung durch Teilnahme (Empfehlung Semesterbetrieb, 27.09.2026): Wer zum
# Semesterstart ohne Antwort schon am Unterricht teilnimmt, gilt als
# zurueckgemeldet, statt als „keine Rueckmeldung“ abgemeldet zu werden — sonst
# fiele er nach einem laengeren Worker-Ausfall mitten im Semester aus allen
# Listen. Eigenes Semester, das heute beginnt, damit die Zahlen von UEB-ALT
# bleiben: Tim war an einem Abend anwesend, Tom hat gefehlt, und fuer Tina traegt
# die Schulleitung am ersten Tag die telefonische Zusage ein.
UEB_RT=$($PSQL "insert into semester (id, code, bezeichnung, start, ende, \"erstelltAm\") values (gen_random_uuid(), 'UEB-TEILNAHME', 'Rueckmeldung durch Teilnahme', '${HEUTE}', '$(tag 60)', now()) returning id;")
rt_einladung() { # $1 personId -> Id einer offenen Einladung in UEB-TEILNAHME
  $PSQL "insert into teilnahmen (id, \"personId\", \"semesterId\", teilnahmeform, \"eingeladenAm\", \"bestaetigungTokenHash\", \"bestaetigungLaeuftAb\", \"erstelltAm\") values (gen_random_uuid(), '$1', '${UEB_RT}', 'SCHUELER', now() - interval '3 days', '$(hash_von "$(neuer_token)")', now() + interval '1 day', now()) returning id;"
}
RT_TIM=$(rt_einladung "$(person_anlegen Tim Teilnahme AKTIV)")
RT_TOM=$(rt_einladung "$(person_anlegen Tom Teilnahme AKTIV)")
RT_TINA=$(rt_einladung "$(person_anlegen Tina Telefon AKTIV)")
RT_ABEND=$($PSQL "insert into unterrichtstermine (id, \"semesterId\", beginn, reihenfolge, \"erstelltAm\") values (gen_random_uuid(), '${UEB_RT}', now(), 1, now()) returning id;")
$PSQL "insert into anwesenheiten (id, \"terminId\", \"teilnahmeId\", status, \"erfasstAm\") values (gen_random_uuid(), '${RT_ABEND}', '${RT_TIM}', 'ANWESEND', now()), (gen_random_uuid(), '${RT_ABEND}', '${RT_TOM}', 'GEFEHLT', now());" > /dev/null
RT_ZUSAGE=$(status_von -X POST "${BASIS}/api/semesterueberleitung/zusage" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"teilnahmeId\":\"${RT_TINA}\"}")
pruefe "am ersten Tag nimmt die Schulleitung noch eine Zusage von Hand an (200)" "$(gleich "$RT_ZUSAGE" "200")" "$RT_ZUSAGE"

docker exec -e WORKER_EINMAL=1 gbs-durchstich node worker.js > /tmp/gbs-worker.log 2>&1
WEXIT=$?
pruefe "der Worker-Einzellauf laeuft ohne Fehler durch (exit 0)" "$(gleich "$WEXIT" "0")" "$(tail -3 /tmp/gbs-worker.log)"
pruefe "der Worker schreibt sein Lebenszeichen (Datei fuer den Healthcheck)" \
  "$(docker exec gbs-durchstich test -f /tmp/gbs-worker-lebenszeichen && echo 1 || echo 0)"
pruefe "sein Aufraeumlauf steht mit Herkunft WORKER im Protokoll" \
  "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='AUFRAEUMEN_GELAUFEN' and \"objektTyp\"='System' and \"objektId\"='WORKER';")" "t")"
pruefe "kein Teillauf ist gescheitert (kein WORKER_LAUF_FEHLGESCHLAGEN)" \
  "$(gleich "$($PSQL "select count(*) from audit_log where aktion='WORKER_LAUF_FEHLGESCHLAGEN' and \"objektId\"='WORKER';")" "0")"

# Abmeldung ohne Rueckmeldung (Fachentscheidung 27.09.2026): Die Teilnahme
# faellt aus den Listen, der Personenstatus bleibt.
pruefe "die unbeantwortete Einladung ist abgemeldet (KEINE_RUECKMELDUNG)" \
  "$(gleich "$($PSQL "select \"abmeldeGrund\" from teilnahmen where id='${UEB_A}' and \"abgemeldetAm\" is not null;")" "KEINE_RUECKMELDUNG")"
pruefe "der Personenstatus bleibt dabei unveraendert (AKTIV)" \
  "$(gleich "$($PSQL "select \"statusCode\" from personen where id='${UEB_P1}';")" "AKTIV")"
pruefe "eine direkt aufgenommene Teilnahme (ohne Einladung) bleibt unberuehrt" \
  "$(gleich "$($PSQL "select count(*) from teilnahmen where id='${UEB_B}' and \"abgemeldetAm\" is null;")" "1")"
pruefe "die Abmeldung steht als Systemlauf im Protokoll" \
  "$(gleich "$($PSQL "select count(*) from audit_log where aktion='TEILNAHME_OHNE_RUECKMELDUNG_ABGEMELDET' and \"objektId\"='${UEB_ALT}' and quelle='SYSTEM';")" "1")"

# Erinnerung ohne SMTP: Die Stufe gilt als versucht (keine stuendliche
# Wiederholung), der Link der Einladung bleibt gueltig (kein Tausch ohne Zustellung).
pruefe "die Erinnerung T-14 ist versucht (Stufe 1 markiert)" \
  "$(gleich "$($PSQL "select \"erinnertStufe1Am\" is not null from teilnahmen where id='${UEB_C}';")" "t")"
pruefe "der Link der Einladung gilt weiter (Token nicht getauscht)" \
  "$(gleich "$($PSQL "select \"bestaetigungTokenHash\" from teilnahmen where id='${UEB_C}';")" "$(hash_von "$T14")")"
pruefe "ohne Zustellung kein Eintrag SEMESTER_ERINNERUNG_GELAUFEN" \
  "$(gleich "$($PSQL "select count(*) from audit_log where aktion='SEMESTER_ERINNERUNG_GELAUFEN' and \"objektId\"='${UEB_T14}';")" "0")"
pruefe "der Fehlversand steht einmal im Versandprotokoll" \
  "$(gleich "$($PSQL "select count(*) from email_versand where \"personId\"='${UEB_P3}' and \"vorlageCode\"='UEBERLEITUNG_ERINNERUNG' and status='FEHLER';")" "1")"

# Aufraeumlauf: nur Abgelaufenes ist weg.
pruefe "abgelaufener Anmeldelink geloescht, frischer bleibt" \
  "$(gleich "$($PSQL "select (select count(*) from magic_links where \"tokenHash\"='${AR_LINK_ALT}') || '/' || (select count(*) from magic_links where \"tokenHash\"='${AR_LINK_NEU}');")" "0/1")"
pruefe "abgelaufener Anmeldeentwurf geloescht, frischer Entwurf und entschiedene Anmeldung bleiben" \
  "$(gleich "$($PSQL "select (select count(*) from anmeldungen where \"fortsetzenTokenHash\"='${AR_EW_ALT}') || '/' || (select count(*) from anmeldungen where \"fortsetzenTokenHash\" in ('${AR_EW_NEU}','${AR_EW_FEST}'));")" "0/2")"
pruefe "abgelaufene Auskunfts- und Aenderungstoken geloescht, frische bleiben" \
  "$(gleich "$($PSQL "select (select count(*) from datenauskuenfte where \"tokenHash\"='${AR_AUSK_ALT}') + (select count(*) from email_aenderungen where \"tokenHash\"='${AR_EMAIL_ALT}') || '/' || (select count(*) from datenauskuenfte where \"tokenHash\"='${AR_AUSK_NEU}');")" "0/1")"
pruefe "alte Drosselzeilen geloescht, frische bleiben" \
  "$(gleich "$($PSQL "select (select count(*) from rate_limit where schluessel='AUFRAEUM-TEST:alt') || '/' || (select count(*) from rate_limit where schluessel='AUFRAEUM-TEST:neu');")" "0/1")"
pruefe "abgelaufener Ueberleitungs-Link entwertet — Einladung und Zusage bleiben stehen" \
  "$(gleich "$($PSQL "select \"bestaetigungTokenHash\" is null and \"eingeladenAm\" is not null and \"bestaetigtAm\" is not null from teilnahmen where id='${UEB_D}';")" "t")"

# Rueckmeldung durch Teilnahme (UEB-TEILNAHME, siehe oben).
pruefe "wer schon am Unterricht teilnahm, gilt als zurueckgemeldet (bestaetigt, nicht abgemeldet)" \
  "$(gleich "$($PSQL "select \"bestaetigtAm\" is not null and \"abgemeldetAm\" is null from teilnahmen where id='${RT_TIM}';")" "t")"
pruefe "wer nur gefehlt hat, wird abgemeldet (KEINE_RUECKMELDUNG, als Einziger dieses Semesters)" \
  "$([ "$($PSQL "select \"abmeldeGrund\" from teilnahmen where id='${RT_TOM}' and \"abgemeldetAm\" is not null;")" = "KEINE_RUECKMELDUNG" ] && [ "$($PSQL "select nachher->>'anzahl' from audit_log where aktion='TEILNAHME_OHNE_RUECKMELDUNG_ABGEMELDET' and \"objektId\"='${UEB_RT}';")" = "1" ] && echo 1 || echo 0)"
pruefe "das Protokoll nennt die Rueckmeldung durch Teilnahme als Systemlauf (Anzahl 1, Tims Teilnahme)" \
  "$(gleich "$($PSQL "select count(*) from audit_log where aktion='TEILNAHME_RUECKMELDUNG_DURCH_TEILNAHME' and \"objektId\"='${UEB_RT}' and quelle='SYSTEM' and nachher->>'anzahl'='1' and nachher->'teilnahmeIds' ? '${RT_TIM}';")" "1")"
pruefe "die von Hand eingetragene Zusage uebersteht den Lauf zum Semesterstart (nicht abgemeldet)" \
  "$(gleich "$($PSQL "select \"bestaetigtAm\" is not null and \"abgemeldetAm\" is null from teilnahmen where id='${RT_TINA}';")" "t")"

# Zweiter Lauf: idempotent — keine zweite Abmeldung, kein zweiter Zustellversuch.
docker exec -e WORKER_EINMAL=1 gbs-durchstich node worker.js > /tmp/gbs-worker-2.log 2>&1
pruefe "ein zweiter Lauf meldet niemanden ein zweites Mal ab" \
  "$(gleich "$($PSQL "select count(*) from audit_log where aktion='TEILNAHME_OHNE_RUECKMELDUNG_ABGEMELDET' and \"objektId\"='${UEB_ALT}';")" "1")"
pruefe "und wiederholt die gescheiterte Erinnerung nicht" \
  "$(gleich "$($PSQL "select count(*) from email_versand where \"personId\"='${UEB_P3}' and \"vorlageCode\"='UEBERLEITUNG_ERINNERUNG';")" "1")"
pruefe "und wertet niemanden ein zweites Mal als zurueckgemeldet (ein Eintrag, Tim weiter dabei)" \
  "$(gleich "$($PSQL "select (select count(*) from audit_log where aktion='TEILNAHME_RUECKMELDUNG_DURCH_TEILNAHME' and \"objektId\"='${UEB_RT}') || '/' || (select (\"abgemeldetAm\" is null)::text from teilnahmen where id='${RT_TIM}');")" "1/true")"
DABEI_T14=$(curl -s -X POST "${BASIS}/api/ueberleitung/bestaetigen" -H 'Content-Type: application/json' -d "{\"token\":\"${T14}\"}")
pruefe "mit dem Link der Einladung laesst sich weiter zusagen (ok)" "$(enthaelt "$DABEI_T14" '"status":"ok"')" "$DABEI_T14"

echo
echo "=== 26b. Semesterueberleitung: nie zugestellte Einladungen erneut senden ==="
# Empfehlung Semesterbetrieb (27.09.2026): Kam eine Einladung nie an (keine
# GESENDET-Zeile fuer Einladung oder Erinnerung seit der Einladung), bekommt sie
# auf Knopfdruck einen frischen Link und geht noch einmal raus — nur vor
# Semesterbeginn, nie automatisch. Nina hat ihre Einladung nie bekommen, Nils
# schon. Beide ohne Rolle und ohne Teilnahme in 2099-H.
nachversand_kaesten() { # wie viele Kaesten „Einladung nicht zugestellt: N“ die Ueberleitungsseite zeigt
  curl -s "${BASIS}/verwaltung/semesterueberleitung" -H "Cookie: ${KEKS}" | grep -o 'Einladung nicht zugestellt: [0-9][0-9]*' | wc -l | tr -d ' '
}
nachversand() { rumpf_und_status -X POST "${BASIS}/api/semesterueberleitung/erneut-senden" -H 'Content-Type: application/json' "$@"; }
NV_KAESTEN_VORHER=$(nachversand_kaesten)
NV=$(curl -s -X POST "${BASIS}/api/semester" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d "{\"code\":\"UEB-NACHVERSAND\",\"bezeichnung\":\"Nachversand Test\",\"start\":\"$(tag 45)\",\"ende\":\"$(tag 135)\"}")
NV_ID=$(echo "$NV" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
NV_NINA=$(person_anlegen Nina Nachversand AKTIV)
NV_NILS=$(person_anlegen Nils Nachversand AKTIV)
NV_TOKEN_NINA=$(neuer_token); NV_TOKEN_NILS=$(neuer_token)
# Ninas Link galt nur zehn Tage (etwa vor einer Verschiebung) — der neue muss bis
# zum Semesterbeginn gelten. Nils' Einladung ist zugestellt (GESENDET danach).
NV_T_NINA=$($PSQL "insert into teilnahmen (id, \"personId\", \"semesterId\", teilnahmeform, \"eingeladenAm\", \"bestaetigungTokenHash\", \"bestaetigungLaeuftAb\", \"erstelltAm\") values (gen_random_uuid(), '${NV_NINA}', '${NV_ID}', 'SCHUELER', now() - interval '1 hour', '$(hash_von "$NV_TOKEN_NINA")', now() + interval '10 days', now()) returning id;")
NV_T_NILS=$($PSQL "insert into teilnahmen (id, \"personId\", \"semesterId\", teilnahmeform, \"eingeladenAm\", \"bestaetigungTokenHash\", \"bestaetigungLaeuftAb\", \"erstelltAm\") values (gen_random_uuid(), '${NV_NILS}', '${NV_ID}', 'SCHUELER', now() - interval '1 hour', '$(hash_von "$NV_TOKEN_NILS")', '$(tag 45)', now()) returning id;")
$PSQL "insert into email_versand (id, \"personId\", empfaenger, betreff, \"vorlageCode\", status, \"erstelltAm\") values (gen_random_uuid(), '${NV_NILS}', 'nils.nachversand@beispiel.de', 'Einladung zum Folgesemester', 'UEBERLEITUNG_EINLADUNG', 'GESENDET', now());" > /dev/null
NV_EINGELADEN=$($PSQL "select \"eingeladenAm\" from teilnahmen where id='${NV_T_NINA}';")
NV_SEITE=$(curl -s "${BASIS}/verwaltung/semesterueberleitung" -H "Cookie: ${KEKS}")
NV_KAESTEN=$(echo "$NV_SEITE" | grep -o 'Einladung nicht zugestellt: [0-9][0-9]*' | wc -l | tr -d ' ')
pruefe "die Ueberleitungsseite meldet die nie zugestellte Einladung (ein Kasten mehr) mit „Erneut senden“ und „Zusage eintragen“" \
  "$([ -n "$NV_ID" ] && [ "$NV_KAESTEN" -eq $((NV_KAESTEN_VORHER + 1)) ] && [ "$(enthaelt "$NV_SEITE" 'Erneut senden')" = "1" ] && [ "$(enthaelt "$NV_SEITE" 'Zusage eintragen')" = "1" ] && echo 1 || echo 0)" "Kaesten ${NV_KAESTEN_VORHER} -> ${NV_KAESTEN}, ${NV}"
NV_LINKS="select string_agg(\"bestaetigungTokenHash\", ',' order by id) from teilnahmen where \"semesterId\"='${NV_ID}';"
NV_LINKS_VORHER=$($PSQL "$NV_LINKS")
NV_TN=$(nachversand -H "Cookie: ${KEKS_TN}" -d "{\"semesterId\":\"${NV_ID}\"}")
NV_LEER=$(nachversand -H "Cookie: ${KEKS}" -d '{}')
pruefe "Erneut senden: Teilnehmer 403, ohne Semester 400 — dabei wird kein Link getauscht" \
  "$([ "$NV_TN" = "403" ] && [ "$NV_LEER" = "400" ] && [ -n "$NV_LINKS_VORHER" ] && [ "$($PSQL "$NV_LINKS")" = "$NV_LINKS_VORHER" ] && echo 1 || echo 0)" "${NV_TN}/${NV_LEER}"
NV_404=$(nachversand -H "Cookie: ${KEKS}" -d "{\"semesterId\":\"$(neuer_token)\"}")
NV_404_TEXT=$(cat /tmp/gbs-rumpf.txt)
NV_BEGONNEN=$(nachversand -H "Cookie: ${KEKS}" -d "{\"semesterId\":\"${UEB_ALT}\"}")
pruefe "ein unbekanntes Semester 404, ein schon begonnenes 409 („bereits begonnen“)" \
  "$([ "$NV_404" = "404" ] && echo "$NV_404_TEXT" | grep -q 'Dieses Semester gibt es nicht' && [ "$NV_BEGONNEN" = "409" ] && grep -q 'bereits begonnen' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "${NV_404}/${NV_BEGONNEN} $(cat /tmp/gbs-rumpf.txt)"
NV_OK=$(nachversand -H "Cookie: ${KEKS}" -d "{\"semesterId\":\"${NV_ID}\"}")
pruefe "die Schulleitung sendet erneut (200, genau {\"data\":{\"erneutEingeladen\":1}})" \
  "$([ "$NV_OK" = "200" ] && [ "$(cat /tmp/gbs-rumpf.txt)" = '{"data":{"erneutEingeladen":1}}' ] && echo 1 || echo 0)" "$NV_OK $(cat /tmp/gbs-rumpf.txt)"
pruefe "Nina hat einen neuen Link bis Semesterbeginn, ihre Einladung bleibt datiert — Nils' Link bleibt" \
  "$(gleich "$($PSQL "select (select t.\"bestaetigungTokenHash\" <> '$(hash_von "$NV_TOKEN_NINA")' and t.\"bestaetigungTokenHash\" ~ '^[0-9a-f]{64}\$' and t.\"bestaetigungLaeuftAb\" = s.start and t.\"eingeladenAm\" = '${NV_EINGELADEN}'::timestamp from teilnahmen t join semester s on s.id = t.\"semesterId\" where t.id='${NV_T_NINA}') and (select \"bestaetigungTokenHash\" = '$(hash_von "$NV_TOKEN_NILS")' from teilnahmen where id='${NV_T_NILS}');")" "t")"
NV_ALT=$(status_von -X POST "${BASIS}/api/ueberleitung/bestaetigen" -H 'Content-Type: application/json' -d "{\"token\":\"${NV_TOKEN_NINA}\"}")
pruefe "Ninas alter Link ist damit ungueltig (401)" "$(gleich "$NV_ALT" "401")" "$NV_ALT"
pruefe "das Protokoll nennt Anzahl und Teilnahme (SEMESTER_EINLADUNG_ERNEUT_GESENDET) — ohne Adresse" \
  "$(gleich "$($PSQL "select count(*) from audit_log where aktion='SEMESTER_EINLADUNG_ERNEUT_GESENDET' and \"objektId\"='${NV_ID}' and nachher->>'code'='UEB-NACHVERSAND' and nachher->>'anzahl'='1' and nachher->'teilnahmeIds' ? '${NV_T_NINA}' and not (nachher->'teilnahmeIds' ? '${NV_T_NILS}') and nachher::text not like '%@%';")" "1")"
# Der Versand laeuft nach der Antwort (after()) und traegt seinen Stand nach.
for i in $(seq 1 10); do
  NV_VERSENDET=$($PSQL "select count(*) from audit_log where aktion='SEMESTER_UEBERLEITUNG_VERSENDET' and \"objektId\"='${NV_ID}' and nachher->>'erneut'='true' and nachher->>'eingeladen'='1';")
  [ "$NV_VERSENDET" != "0" ] && break
  sleep 1
done
pruefe "der Versandstand ist nachgetragen (SEMESTER_UEBERLEITUNG_VERSENDET, erneut, 1 Einladung)" "$(gleich "$NV_VERSENDET" "1")" "$NV_VERSENDET"
pruefe "ohne SMTP steht Ninas neue Einladung als FEHLER im Versandprotokoll — Nils bekam nichts Neues" \
  "$(gleich "$($PSQL "select (select count(*) from email_versand where \"personId\"='${NV_NINA}' and \"vorlageCode\"='UEBERLEITUNG_EINLADUNG' and status='FEHLER') || '/' || (select count(*) from email_versand where \"personId\"='${NV_NILS}');")" "1/1")"

echo
echo "=== 27. Anonymisierung nach Art. 17 DSGVO ==="
# Klaus Ehemann (Abschnitt 20) wird anonymisiert — er hat eine Anmeldung mit
# echten Antworten und eine Ehepartner-Ermaessigung, also PII in mehreren Tabellen.
KLAUS_ID=$($PSQL "select id from personen where email='klaus@beispiel.de';")
pruefe "Klaus hat vor der Anonymisierung echte Anmelde-Antworten" \
  "$(enthaelt "$($PSQL "select antworten::text from anmeldungen where \"personId\"='${KLAUS_ID}';")" "Klaus")"
# Ein Teilnehmer darf nicht anonymisieren.
ANON_VERBOTEN=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/personen/${KLAUS_ID}/anonymisieren" -H "Cookie: ${KEKS_TN}")
pruefe "ein Teilnehmer darf niemanden anonymisieren (403)" "$(gleich "$ANON_VERBOTEN" "403")" "$ANON_VERBOTEN"
# Anonymisierung durch die Schulleitung.
ANON=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/personen/${KLAUS_ID}/anonymisieren" -H "Cookie: ${KEKS}")
pruefe "Anonymisieren ist der Schulleitung erlaubt (200)" "$(gleich "$ANON" "200")" "$ANON"
pruefe "der Status ist ANONYMISIERT" \
  "$(gleich "$($PSQL "select \"statusCode\" from personen where id='${KLAUS_ID}';")" "ANONYMISIERT")"
pruefe "der Name ist ueberschrieben" \
  "$(gleich "$($PSQL "select vorname from personen where id='${KLAUS_ID}';")" "Anonymisiert")"
pruefe "die E-Mail ist eine Platzhalter-Adresse" \
  "$(enthaelt "$($PSQL "select email from personen where id='${KLAUS_ID}';")" "@anonymisiert.invalid")"
pruefe "die IBAN ist geleert" \
  "$(gleich "$($PSQL "select case when \"ibanVerschluesselt\" is null then 'null' else 'gesetzt' end from personen where id='${KLAUS_ID}';")" "null")"
pruefe "die Anmelde-Antworten sind gescrubbt (kein Name mehr)" \
  "$(fehlt_in "$($PSQL "select antworten::text from anmeldungen where \"personId\"='${KLAUS_ID}';")" "Klaus")"
pruefe "die Einwilligungen bleiben als Nachweis erhalten" \
  "$([ "$($PSQL "select count(*) from einwilligungen where \"personId\"='${KLAUS_ID}';")" -gt 0 ] && echo 1 || echo 0)"
pruefe "die Anonymisierung ist protokolliert (PERSON_ANONYMISIERT)" \
  "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='PERSON_ANONYMISIERT' and \"objektId\"='${KLAUS_ID}';")" "t")"
pruefe "das Audit-Log enthaelt KEINE alten personenbezogenen Daten" \
  "$(fehlt_in "$($PSQL "select coalesce(nachher::text,'') from audit_log where aktion='PERSON_ANONYMISIERT' and \"objektId\"='${KLAUS_ID}';")" "Klaus")"
# Idempotenz: ein zweiter Aufruf wird abgewiesen.
ANON2=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/personen/${KLAUS_ID}/anonymisieren" -H "Cookie: ${KEKS}")
pruefe "eine bereits anonymisierte Person wird abgewiesen (409)" "$(gleich "$ANON2" "409")" "$ANON2"
# Keine (Neu-)Ausstellung mehr: Sie schriebe den Platzhalternamen in ein neues,
# gueltiges Dokument. Klaus hat seit der Aufnahme eine Teilnahme in 2099-H.
ANON_Z=$(rumpf_und_status -X POST "${BASIS}/api/zeugnisse/ausstellen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d "{\"semesterId\":\"${SEMESTER_ID}\",\"typ\":\"SEMESTER\",\"personId\":\"${KLAUS_ID}\"}")
pruefe "fuer eine anonymisierte Person wird kein Zeugnis ausgestellt (409, „anonymisiert“)" \
  "$([ "$ANON_Z" = "409" ] && grep -q 'anonymisiert' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$ANON_Z $(cat /tmp/gbs-rumpf.txt)"

echo
echo "=== 28. Selbstbestaetigung der eigenen Anwesenheit ==="
# Petras urspruengliche Sitzung (KEKS2) wurde entwertet, als die Verwaltung in
# Abschnitt 13 ihre E-Mail-Adresse aenderte: `/api/personen/[id]/email` setzt
# `passwortGeaendertAm`, und `ladeAngemeldeten` verwirft jede aeltere Sitzung —
# ein Adresswechsel ist ein Zugangswechsel. Fuer die Selbstbestaetigung meldet
# sie sich deshalb frisch an (neuer Anmeldelink, wie im echten Ablauf).
SBTOKEN=$(uuidgen | tr 'A-Z' 'a-z'); SBHASH=$(printf %s "$SBTOKEN" | shasum -a 256 | cut -d' ' -f1)
$PSQL "insert into magic_links (id,\"personId\",\"tokenHash\",\"laeuftAb\",\"erstelltAm\") values (gen_random_uuid(),'${TEILNEHMER_ID}','${SBHASH}',now()+interval '1 hour',now());" > /dev/null
curl -s -D /tmp/gbs-kopf-sb.txt -o /dev/null -X POST "${BASIS}/api/auth/token" -H 'Content-Type: application/json' -d "{\"token\":\"${SBTOKEN}\"}"
KEKS2=$(grep -i '^set-cookie:' /tmp/gbs-kopf-sb.txt | head -1 | sed 's/^[^:]*: //' | cut -d';' -f1)
pruefe "Teilnehmer meldet sich nach dem Adresswechsel neu an" "$([ -n "$KEKS2" ] && echo 1 || echo 0)"
# Die generierten 2099-H-Abende liegen ab dem Semesterbeginn in zwei Wochen und
# sind damit Zukunft — fuer die Selbstbestaetigung braucht es einen Abend in der
# Vergangenheit, deshalb hier per SQL angelegt (relativ zu now()).
SB_PAST=$($PSQL "insert into unterrichtstermine (id,\"semesterId\",beginn,reihenfolge,\"erstelltAm\") values (gen_random_uuid(),'${SEMESTER_ID}',now()-interval '2 days',90,now()) returning id;")
# Der Teilnehmer (petra, KEKS2) bestaetigt sich selbst als anwesend.
SB1=$(curl -s -X POST "${BASIS}/api/meine-daten/anwesenheit" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' -d "{\"terminId\":\"${SB_PAST}\",\"status\":\"ANWESEND\"}")
pruefe "Teilnehmer bestaetigt sich selbst als anwesend" "$(echo "$SB1" | grep -qc '"status":"ANWESEND"' && echo 1 || echo 0)" "$SB1"
pruefe "der eigene Eintrag traegt den Teilnehmer als Erfasser" \
  "$(gleich "$($PSQL "select \"erfasstVonId\" from anwesenheiten where \"terminId\"='${SB_PAST}';")" "${TEILNEHMER_ID}")"
# Den eigenen Eintrag darf er aendern (anwesend -> nachgearbeitet).
curl -s -o /dev/null -X POST "${BASIS}/api/meine-daten/anwesenheit" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' -d "{\"terminId\":\"${SB_PAST}\",\"status\":\"NACHGEARBEITET\"}"
pruefe "der eigene Eintrag laesst sich auf nachgearbeitet aendern" \
  "$(gleich "$($PSQL "select status from anwesenheiten where \"terminId\"='${SB_PAST}';")" "NACHGEARBEITET")"
# Entschuldigt/gefehlt sind fuer die Selbstbestaetigung nicht erlaubt (400).
SB_ENT=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/meine-daten/anwesenheit" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' -d "{\"terminId\":\"${SB_PAST}\",\"status\":\"ENTSCHULDIGT\"}")
pruefe "entschuldigt/gefehlt wird als Selbstbestaetigung abgewiesen (400)" "$(gleich "$SB_ENT" "400")" "$SB_ENT"
# Ein zukuenftiger Abend laesst sich nicht im Voraus bestaetigen (409).
SB_FUT=$($PSQL "select id from unterrichtstermine where \"semesterId\"='${SEMESTER_ID}' and beginn > now() order by beginn asc limit 1;")
SB_FUTC=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/meine-daten/anwesenheit" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' -d "{\"terminId\":\"${SB_FUT}\",\"status\":\"ANWESEND\"}")
pruefe "ein zukuenftiger Abend wird abgewiesen (409)" "$(gleich "$SB_FUTC" "409")" "$SB_FUTC"
# Was die Schule erfasst hat, darf der Teilnehmer nicht ueberschreiben.
SB_ADMIN=$($PSQL "insert into unterrichtstermine (id,\"semesterId\",beginn,reihenfolge,\"erstelltAm\") values (gen_random_uuid(),'${SEMESTER_ID}',now()-interval '3 days',91,now()) returning id;")
curl -s -o /dev/null -X POST "${BASIS}/api/stundenplan/anwesenheit" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"terminId\":\"${SB_ADMIN}\",\"eintraege\":[{\"teilnahmeId\":\"${TEILNAHME_ID}\",\"status\":\"GEFEHLT\"}]}"
SB_UEBER=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/meine-daten/anwesenheit" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' -d "{\"terminId\":\"${SB_ADMIN}\",\"status\":\"ANWESEND\"}")
pruefe "ein von der Schule erfasster Abend ist fuer den Teilnehmer gesperrt (409)" "$(gleich "$SB_UEBER" "409")" "$SB_UEBER"
pruefe "der von der Schule erfasste Status bleibt GEFEHLT" \
  "$(gleich "$($PSQL "select status from anwesenheiten where \"terminId\"='${SB_ADMIN}' and \"teilnahmeId\"='${TEILNAHME_ID}';")" "GEFEHLT")"

# Die eigene Quote (Modell A: alle Abende des Semesters) erscheint jetzt in der
# Akte. Petra hat in diesem Semester elf Abende: einen nachgearbeiteten (SB_PAST),
# einen von der Schule als GEFEHLT erfassten (SB_ADMIN) und neun noch offene —
# ihre Quote steht damit auf "noch offen" (nicht erfuellt, nicht verloren). Nur
# statische Textstuecke pruefen: React-SSR trennt dynamische Werte mit Kommentar-
# Markern, "1 von 11" waere deshalb kein verlaesslicher Treffer.
# Seit dem Oberflächenplan (09/2026) stehen Ampel und Abende unter „Abende“.
AKTE=$(curl -s "${BASIS}/meine-daten/abende" -H "Cookie: ${KEKS2}")
pruefe "die eigene Akte zeigt den Anwesenheits-Abschnitt" "$(enthaelt "$AKTE" "Meine Anwesenheit")"
pruefe "die eigene Quote nennt teilgenommen/gesamt" "$(enthaelt "$AKTE" "Teilgenommen:")"
pruefe "die eigene Quote steht auf 'Noch offen'" "$(enthaelt "$AKTE" "Noch offen")"
# Der Klartext heisst seit dem UI-Redesign (0.4) „Es dürfen noch … fehlen."
# (quoteHinweis in lib/stundenplan.ts, eine Zeichenkette) — vorher „Du darfst noch".
pruefe "die Quote nennt das verbleibende Fehl-Budget" "$(enthaelt "$AKTE" "Es dürfen noch")"
# Ein Abend eines Semesters, in dem der Teilnehmer nicht eingeschrieben ist (404).
FREMD_SEM=$($PSQL "select id from semester where code='2027-H';")
SB_FREMD_T=$($PSQL "insert into unterrichtstermine (id,\"semesterId\",beginn,reihenfolge,\"erstelltAm\") values (gen_random_uuid(),'${FREMD_SEM}',now()-interval '1 day',0,now()) returning id;")
SB_FREMD=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/meine-daten/anwesenheit" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' -d "{\"terminId\":\"${SB_FREMD_T}\",\"status\":\"ANWESEND\"}")
pruefe "ein Abend aus einem fremden Semester wird abgewiesen (404)" "$(gleich "$SB_FREMD" "404")" "$SB_FREMD"
# Ohne Anmeldung keine Selbstbestaetigung (401 — nicht angemeldet).
SB_ANON=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/meine-daten/anwesenheit" -H 'Content-Type: application/json' -d "{\"terminId\":\"${SB_PAST}\",\"status\":\"ANWESEND\"}")
pruefe "ohne Anmeldung keine Selbstbestaetigung (401)" "$(gleich "$SB_ANON" "401")" "$SB_ANON"
# Die Selbstbestaetigung ist protokolliert.
pruefe "die Selbstbestaetigung ist protokolliert (ANWESENHEIT_SELBST_BESTAETIGT)" \
  "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='ANWESENHEIT_SELBST_BESTAETIGT' and \"objektId\"='${SB_PAST}';")" "t")"
# Die eigene Akte zeigt jetzt den Abschnitt „Meine Anwesenheit".
SB_SEITE=$(curl -s "${BASIS}/meine-daten/abende" -H "Cookie: ${KEKS2}")
pruefe "die eigene Akte zeigt den Abschnitt Meine Anwesenheit" "$(enthaelt "$SB_SEITE" "Meine Anwesenheit")"

echo
echo "=== 29. Dozentenhonorar ==="
pruefe "Recht HONORAR_LESEN existiert" \
  "$(gleich "$($PSQL "select count(*) from rechte where code='HONORAR_LESEN';")" "1")"
pruefe "Schulleitung und Verwaltung haben HONORAR_LESEN" \
  "$(gleich "$($PSQL "select count(*) from rolle_recht where \"rechtCode\"='HONORAR_LESEN';")" "2")"
pruefe "Teilnehmer hat HONORAR_LESEN NICHT" \
  "$(gleich "$($PSQL "select count(*) from rolle_recht where \"rechtCode\"='HONORAR_LESEN' and \"rolleCode\"='TEILNEHMER';")" "0")"
pruefe "die Rolle Dozent ist ab Release 0.2 scharfgeschaltet" \
  "$(gleich "$($PSQL "select \"aktivAbRelease\" from rollen where code='DOZENT';")" "0.2")"
# --- Satz-Historie mit Gueltig-ab statt Einzel-Regler (Release 0.3) ---
pruefe "Recht HONORAR_SATZ_GENEHMIGEN existiert" \
  "$(gleich "$($PSQL "select count(*) from rechte where code='HONORAR_SATZ_GENEHMIGEN';")" "1")"
pruefe "Schulleitung und Verwaltung duerfen Saetze genehmigen" \
  "$(gleich "$($PSQL "select count(*) from rolle_recht where \"rechtCode\"='HONORAR_SATZ_GENEHMIGEN';")" "2")"
pruefe "Teilnehmer darf Saetze NICHT genehmigen" \
  "$(gleich "$($PSQL "select count(*) from rolle_recht where \"rechtCode\"='HONORAR_SATZ_GENEHMIGEN' and \"rolleCode\"='TEILNEHMER';")" "0")"
pruefe "der abgeloeste Einzel-Regler HONORAR_SATZ_PRO_ABEND ist entfernt" \
  "$(gleich "$($PSQL "select count(*) from einstellungen where schluessel='HONORAR_SATZ_PRO_ABEND';")" "0")"
pruefe "die Satz-Historie hat eine Startzeile aus dem Altwert (60)" \
  "$(gleich "$($PSQL "select betrag from honorar_saetze order by \"gueltigAb\" asc limit 1;")" "60")"
pruefe "die Honorarsatz-Historie-Migration ist als angewendet eingetragen" \
  "$(gleich "$($PSQL "select count(*) from _prisma_migrations where migration_name='20260730120000_honorarsatz_historie' and finished_at is not null;")" "1")"
pruefe "Spalte unterrichtstermine.dozentId existiert" \
  "$(gleich "$($PSQL "select data_type from information_schema.columns where table_name='unterrichtstermine' and column_name='dozentId';")" "text")"
pruefe "der Dozent-Fremdschluessel loescht nicht mit (SET NULL)" \
  "$(gleich "$($PSQL "select confdeltype from pg_constraint where conname='unterrichtstermine_dozentId_fkey';")" "n")"
pruefe "die Dozent-Honorar-Migration ist als angewendet eingetragen" \
  "$(gleich "$($PSQL "select count(*) from _prisma_migrations where migration_name='20260729150000_dozent_honorar' and finished_at is not null;")" "1")"

# Einen Dozenten anlegen und ihm die Rolle geben.
DOZENT_ID=$($PSQL "insert into personen (id,vorname,nachname,email,\"statusCode\",\"erstelltAm\",\"aktualisiertAm\") values (gen_random_uuid(),'Dora','Dozento','dozento@beispiel.de','AKTIV',now(),now()) returning id;")
$PSQL "insert into person_rolle (\"personId\",\"rolleCode\") values ('${DOZENT_ID}','DOZENT');" > /dev/null

# Einen neuen Satz (95 EUR) ueber die Genehmigungs-API festschreiben — gueltig ab
# vor allen Abenden, damit die gehaltenen Abende zu 95 zaehlen. Das Eintragen ist
# die Genehmigung; danach entsteht ein DMS-Beleg (Beleg-Nr gesetzt, Versand
# unterbleibt mangels DMS_EMAIL und bleibt sichtbar offen).
GEN=$(rumpf_und_status -X POST "${BASIS}/api/honorar/saetze" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"betrag":95,"gueltigAb":"2000-01-02","notiz":"Durchstich"}')
GEN_RUMPF=$(cat /tmp/gbs-rumpf.txt)
pruefe "die Schulleitung genehmigt einen Satz (200)" "$(gleich "$GEN" "200")" "$GEN"
# Ehrliche Rueckmeldung zum Belegversand statt pauschalem „E-Mail fehlt" (M12).
pruefe "die Genehmigung meldet den Belegversand: keine DMS-Adresse" "$(enthaelt "$GEN_RUMPF" '"dmsVersand":"KEINE_ADRESSE"')" "$GEN_RUMPF"
pruefe "der genehmigte Satz (95) steht in der Historie" \
  "$(gleich "$($PSQL "select count(*) from honorar_saetze where betrag=95;")" "1")"
pruefe "die Genehmigung haelt den Genehmiger fest" \
  "$(gleich "$($PSQL "select count(*) > 0 from honorar_saetze where betrag=95 and \"genehmigtVonId\" is not null;")" "t")"
pruefe "nach der Genehmigung ist eine DMS-Beleg-Nr vergeben (HON-...)" \
  "$(enthaelt "$($PSQL "select \"dmsBelegNr\" from honorar_saetze where betrag=95;")" "HON-")"
pruefe "die Genehmigung steht im Audit-Log" \
  "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='HONORAR_SATZ_GENEHMIGT';")" "t")"
# Ein Teilnehmer darf keinen Satz genehmigen (403).
GEN_T=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/honorar/saetze" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' -d "{\"betrag\":50,\"gueltigAb\":\"$(tag 100)\"}")
pruefe "ein Teilnehmer darf keinen Satz genehmigen (403)" "$(gleich "$GEN_T" "403")" "$GEN_T"
# Ein unmoegliches Datum rollte mit `new Date()` still auf den naechsten Monat —
# ein Satz mit falschem Gueltig-ab waere lohnwirksam angelegt worden.
N_SAETZE_VORHER=$($PSQL "select count(*) from honorar_saetze;")
GEN_BAD=$(rumpf_und_status -X POST "${BASIS}/api/honorar/saetze" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"betrag":96,"gueltigAb":"2026-02-30"}')
pruefe "ein unmoegliches Gueltig-ab-Datum wird abgewiesen (400)" \
  "$([ "$GEN_BAD" = "400" ] && grep -q 'Gültig-ab-Datum ist ungültig' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$GEN_BAD $(cat /tmp/gbs-rumpf.txt)"
pruefe "und es entsteht kein Satz" \
  "$(gleich "$($PSQL "select count(*) || '/' || (select count(*) from honorar_saetze where betrag=96) from honorar_saetze;")" "${N_SAETZE_VORHER}/0")"

# Nachsenden des Satz-Belegs (M12). Ohne DMS-Adresse ist das ein Betriebsfehler
# (500 mit Hinweis), kein Eingabefehler.
SATZ_ID=$($PSQL "select id from honorar_saetze where betrag=95;")
SATZ_NACH=$(rumpf_und_status -X POST "${BASIS}/api/honorar/saetze/${SATZ_ID}/beleg-senden" -H "Cookie: ${KEKS}")
pruefe "Satz-Beleg nachsenden ohne DMS-Adresse: 500 mit Hinweis auf DMS_EMAIL" \
  "$([ "$SATZ_NACH" = "500" ] && grep -q 'DMS_EMAIL' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$SATZ_NACH $(cat /tmp/gbs-rumpf.txt)"
SATZ_NACH_T=$(status_von -X POST "${BASIS}/api/honorar/saetze/${SATZ_ID}/beleg-senden" -H "Cookie: ${KEKS2}")
pruefe "ein Teilnehmer darf keinen Satz-Beleg nachsenden (403)" "$(gleich "$SATZ_NACH_T" "403")" "$SATZ_NACH_T"
SATZ_NACH_404=$(status_von -X POST "${BASIS}/api/honorar/saetze/$(neuer_token)/beleg-senden" -H "Cookie: ${KEKS}")
pruefe "ein unbekannter Satz ist 404" "$(gleich "$SATZ_NACH_404" "404")" "$SATZ_NACH_404"
# Der Startsatz aus dem Seed hat nie einen Beleg bekommen — nichts nachzusenden.
SATZ_ALT_ID=$($PSQL "select id from honorar_saetze where \"dmsBelegNr\" is null order by \"gueltigAb\" limit 1;")
SATZ_NACH_409=$(status_von -X POST "${BASIS}/api/honorar/saetze/${SATZ_ALT_ID}/beleg-senden" -H "Cookie: ${KEKS}")
pruefe "ein Satz ohne Beleg-Nr (Seed-Startsatz) ist 409" "$(gleich "$SATZ_NACH_409" "409")" "$SATZ_NACH_409"

# Dem Dozenten Abende zuordnen (ueber die Termin-PUT der Schulleitung): zwei
# vergangene und einen zukuenftigen. Der zukuenftige darf im Honorar NICHT als
# gehalten zaehlen (nur bereits stattgefundene Abende ergeben Honorar).
#
# Seit Code-Review 4 (M19) per Id statt ueber `beginn <= now() order by beginn`:
# DT1 ist der Abend von Abschnitt 28, den die Schule als GEFEHLT erfasst hat,
# DT2 der mit Petras Selbstbestaetigung (Abschnitt 34 braucht genau ihn), DT_FUT
# ein eigener kuenftiger Abend. Die Sortierung haengt am Kalender — sobald
# generierte Abende vergangen sind, waehlte sie andere.
DT1="$SB_ADMIN"
DT2="$SB_PAST"
DT_FUT=$($PSQL "insert into unterrichtstermine (id,\"semesterId\",beginn,reihenfolge,\"erstelltAm\") values (gen_random_uuid(),'${SEMESTER_ID}',now()+interval '10 days',92,now()) returning id;")
pruefe "Vorbedingung: DT1 und DT2 liegen zurueck, DT_FUT liegt vor uns" \
  "$(gleich "$($PSQL "select count(*) from unterrichtstermine where (id in ('${DT1}','${DT2}') and beginn < now()) or (id='${DT_FUT}' and beginn > now());")" "3")"
for T in "$DT1" "$DT2" "$DT_FUT"; do
  curl -s -o /dev/null -X PUT "${BASIS}/api/stundenplan/termine/${T}" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"dozentId\":\"${DOZENT_ID}\"}"
done
pruefe "drei Abende sind dem Dozenten zugeordnet (zwei vergangen, einer kuenftig)" \
  "$(gleich "$($PSQL "select count(*) from unterrichtstermine where \"dozentId\"='${DOZENT_ID}';")" "3")"

# Eine Person ohne Dozentenrolle laesst sich nicht zuordnen (400).
BAD_DOZ=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "${BASIS}/api/stundenplan/termine/${DT1}" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"dozentId\":\"${TEILNEHMER_ID}\"}")
pruefe "eine Person ohne Dozentenrolle wird abgewiesen (400)" "$(gleich "$BAD_DOZ" "400")" "$BAD_DOZ"
# Ein Teilnehmer darf keinen Dozenten zuordnen (403).
DOZ_VERBOTEN=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "${BASIS}/api/stundenplan/termine/${DT1}" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' -d "{\"dozentId\":\"${DOZENT_ID}\"}")
pruefe "ein Teilnehmer darf keinen Dozenten zuordnen (403)" "$(gleich "$DOZ_VERBOTEN" "403")" "$DOZ_VERBOTEN"

# Die Honorar-Uebersicht: Schulleitung 200, Teilnehmer wird weggeleitet (307).
HON_S=$(curl -s -o /dev/null -w '%{http_code}' "${BASIS}/verwaltung/honorar?semester=${SEMESTER_ID}" -H "Cookie: ${KEKS}")
pruefe "die Schulleitung sieht die Honorar-Uebersicht (200)" "$(gleich "$HON_S" "200")" "$HON_S"
HON_T=$(curl -s -o /dev/null -w '%{http_code}' "${BASIS}/verwaltung/honorar" -H "Cookie: ${KEKS2}")
pruefe "ein Teilnehmer wird von der Honorar-Uebersicht weggeleitet (307)" "$(gleich "$HON_T" "307")" "$HON_T"
# Die Satz-Verwaltung /saetze: Schulleitung 200, Teilnehmer wird weggeleitet (307).
SAETZE_S=$(curl -s -o /dev/null -w '%{http_code}' "${BASIS}/verwaltung/honorar/saetze" -H "Cookie: ${KEKS}")
pruefe "die Schulleitung sieht die Satz-Verwaltung (200)" "$(gleich "$SAETZE_S" "200")" "$SAETZE_S"
SAETZE_T=$(curl -s -o /dev/null -w '%{http_code}' "${BASIS}/verwaltung/honorar/saetze" -H "Cookie: ${KEKS2}")
pruefe "ein Teilnehmer wird von der Satz-Verwaltung weggeleitet (307)" "$(gleich "$SAETZE_T" "307")" "$SAETZE_T"

# Inhalt: der Dozent und der Betrag der GEHALTENEN Abende (2 x 95 = 190 EUR)
# stehen drin — der dritte, zukuenftige Abend zaehlt NICHT mit (sonst 3 x 95 = 285).
HON=$(curl -s "${BASIS}/verwaltung/honorar?semester=${SEMESTER_ID}" -H "Cookie: ${KEKS}")
pruefe "der Dozent steht in der Honorar-Uebersicht" "$(enthaelt "$HON" "Dozento")" "$HON"
pruefe "nur die gehaltenen Abende zaehlen (2 x 95 = 190 €)" "$(enthaelt "$HON" "190 €")"
pruefe "ein kuenftig zugeordneter Abend zaehlt NICHT als gehalten (kein 285 €)" "$(fehlt_in "$HON" "285 €")"

echo
echo "=== 29b. Honorar-Abrechnung / Auszahlung ==="
pruefe "Recht HONORAR_ABRECHNEN existiert" \
  "$(gleich "$($PSQL "select count(*) from rechte where code='HONORAR_ABRECHNEN';")" "1")"
pruefe "Schulleitung und Verwaltung duerfen abrechnen" \
  "$(gleich "$($PSQL "select count(*) from rolle_recht where \"rechtCode\"='HONORAR_ABRECHNEN';")" "2")"
pruefe "die Honorar-Abrechnung-Migration ist als angewendet eingetragen" \
  "$(gleich "$($PSQL "select count(*) from _prisma_migrations where migration_name='20260730130000_honorar_abrechnung' and finished_at is not null;")" "1")"
pruefe "Tabelle honorar_abrechnungen existiert" \
  "$(gleich "$($PSQL "select count(*) from information_schema.tables where table_name='honorar_abrechnungen';")" "1")"
pruefe "Posten.terminId ist UNIQUE (kein Doppel-Honorar)" \
  "$(gleich "$($PSQL "select count(*) from pg_indexes where indexname='honorar_abrechnung_posten_terminId_key';")" "1")"

# Die Rueckfrage der Oberflaeche nennt Abende und Summe vom Seitenaufruf, der
# Knopf schickt beide mit. Weicht der Stand beim Klick ab (hier: 1 statt 2
# Abende), legt der Server nichts an (409) — festgeschrieben wird nur Bestaetigtes.
ABR_ALT=$(status_von -X POST "${BASIS}/api/honorar/abrechnungen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d "{\"dozentId\":\"${DOZENT_ID}\",\"semesterId\":\"${SEMESTER_ID}\",\"erwarteteAbende\":1,\"erwarteteSumme\":95}")
pruefe "weichen Abende und Summe von der bestaetigten Rueckfrage ab, entsteht keine Abrechnung (409)" \
  "$([ "$ABR_ALT" = "409" ] && [ "$($PSQL "select count(*) from honorar_abrechnungen where \"dozentId\"='${DOZENT_ID}';")" = "0" ] && echo 1 || echo 0)" "$ABR_ALT"

# Abrechnung erstellen: der Dozent hat aus Abschnitt 29 zwei gehaltene Abende (je 95 EUR).
ABR=$(curl -s -X POST "${BASIS}/api/honorar/abrechnungen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"dozentId\":\"${DOZENT_ID}\",\"semesterId\":\"${SEMESTER_ID}\",\"erwarteteAbende\":2,\"erwarteteSumme\":190}")
ABR_ID=$($PSQL "select id from honorar_abrechnungen where \"dozentId\"='${DOZENT_ID}' order by \"erstelltAm\" desc limit 1;")
pruefe "die Schulleitung erstellt eine Abrechnung" "$(enthaelt "$ABR" "$ABR_ID")" "$ABR"
pruefe "die Abrechnung hat 2 Posten (die gehaltenen Abende)" \
  "$(gleich "$($PSQL "select count(*) from honorar_abrechnung_posten where \"abrechnungId\"='${ABR_ID}';")" "2")"
pruefe "die eingefrorene Summe ist 190 (2 x 95)" \
  "$(gleich "$($PSQL "select summe from honorar_abrechnungen where id='${ABR_ID}';")" "190")"
pruefe "die Abrechnung ist OFFEN" \
  "$(gleich "$($PSQL "select status from honorar_abrechnungen where id='${ABR_ID}';")" "OFFEN")"
pruefe "der eingefrorene Posten-Betrag ist 95" \
  "$(gleich "$($PSQL "select distinct betrag from honorar_abrechnung_posten where \"abrechnungId\"='${ABR_ID}';")" "95")"
pruefe "das Erstellen steht im Audit-Log" \
  "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='HONORAR_ABRECHNUNG_ERSTELLT';")" "t")"

# Eingefroren heisst: Ein spaeter genehmigter, rueckwirkend gueltiger Satz aendert
# eine bestehende Abrechnung nicht. Der 120er gilt ab 03.01.2000 — nach dem 95er,
# vor allen Abenden. Ab hier rechnen NEUE Abrechnungen mit 120.
SATZ_120=$(status_von -X POST "${BASIS}/api/honorar/saetze" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d '{"betrag":120,"gueltigAb":"2000-01-03","notiz":"Durchstich rueckdatiert"}')
pruefe "ein rueckdatierter Satz (120) wird genehmigt (200)" "$(gleich "$SATZ_120" "200")" "$SATZ_120"
pruefe "die bestehende Abrechnung behaelt Summe 190 und Postenbetrag 95" \
  "$(gleich "$($PSQL "select a.summe || '/' || (select string_agg(distinct p.betrag::text, ',') from honorar_abrechnung_posten p where p.\"abrechnungId\" = a.id) from honorar_abrechnungen a where a.id='${ABR_ID}';")" "190/95")"
# Und das nicht nur per Konvention: Die Datenbank sperrt Summe und Posten auch
# fuer den Eigentuemer (Migration 20260927160000, Trigger).
pruefe "die eingefrorene Summe laesst sich per SQL nicht aendern" \
  "$(abgewiesen "update honorar_abrechnungen set summe = summe + 1 where id='${ABR_ID}';")"
pruefe "ein Posten laesst sich per SQL weder aendern noch einzeln loeschen" \
  "$([ "$(abgewiesen "update honorar_abrechnung_posten set betrag = 1 where \"abrechnungId\"='${ABR_ID}';")" = "1" ] && [ "$(abgewiesen "delete from honorar_abrechnung_posten where \"abrechnungId\"='${ABR_ID}';")" = "1" ] && echo 1 || echo 0)"
pruefe "Summe und Posten sind danach unveraendert (190, 2 Posten)" \
  "$(gleich "$($PSQL "select a.summe || '/' || (select count(*) from honorar_abrechnung_posten p where p.\"abrechnungId\" = a.id) from honorar_abrechnungen a where a.id='${ABR_ID}';")" "190/2")"

# Kein Doppel-Honorar: erneutes Abrechnen findet keine offenen Abende mehr (400).
ABR2=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/honorar/abrechnungen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"dozentId\":\"${DOZENT_ID}\",\"semesterId\":\"${SEMESTER_ID}\"}")
pruefe "kein zweites Abrechnen derselben Abende (400)" "$(gleich "$ABR2" "400")" "$ABR2"
pruefe "es bleiben genau 2 Posten fuer den Dozenten (kein Doppel)" \
  "$(gleich "$($PSQL "select count(*) from honorar_abrechnung_posten p join honorar_abrechnungen a on a.id=p.\"abrechnungId\" where a.\"dozentId\"='${DOZENT_ID}';")" "2")"

# Ein Teilnehmer darf nicht abrechnen (403).
ABR_T=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/honorar/abrechnungen" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' -d "{\"dozentId\":\"${DOZENT_ID}\",\"semesterId\":\"${SEMESTER_ID}\"}")
pruefe "ein Teilnehmer darf nicht abrechnen (403)" "$(gleich "$ABR_T" "403")" "$ABR_T"

# IBAN-Schutz: die reine Schulleitung hat HONORAR_ABRECHNEN, aber NICHT
# BANKVERBINDUNG_LESEN -> die Freigabe (Beleg mit IBAN ans DMS) ist verboten (403).
FREI_S=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/honorar/abrechnungen/${ABR_ID}/freigeben" -H "Cookie: ${KEKS}")
pruefe "Freigabe ohne IBAN-Recht ist verboten (403)" "$(gleich "$FREI_S" "403")" "$FREI_S"
pruefe "die Abrechnung ist dadurch weiterhin OFFEN" \
  "$(gleich "$($PSQL "select status from honorar_abrechnungen where id='${ABR_ID}';")" "OFFEN")"

# Statusmaschine: eine OFFENE Abrechnung laesst sich nicht auszahlen. Das ist
# ein Konflikt mit dem Stand, kein Eingabefehler (409, seit Code-Review 4).
AUS_OFFEN=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/honorar/abrechnungen/${ABR_ID}/auszahlen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"ausgezahltAm\":\"${HEUTE}\"}")
pruefe "Auszahlen einer OFFENEN Abrechnung ist verboten (409)" "$(gleich "$AUS_OFFEN" "409")" "$AUS_OFFEN"

# --- Echte Freigabe ueber die API mit einer Verwaltungs-Session (hat
# HONORAR_ABRECHNEN UND BANKVERBINDUNG_LESEN) und einer verschluesselten IBAN. ---
VERWALTUNG_ID=$($PSQL "insert into personen (id, vorname, nachname, email, \"statusCode\", \"erstelltAm\", \"aktualisiertAm\") values (gen_random_uuid(), 'Vera', 'Verwalta', 'verwalta@beispiel.de', 'AKTIV', now(), now()) returning id;")
$PSQL "insert into person_rolle (\"personId\", \"rolleCode\") values ('${VERWALTUNG_ID}', 'VERWALTUNG');" > /dev/null
TOKEN_V=$(uuidgen | tr 'A-Z' 'a-z')
HASH_V=$(printf %s "$TOKEN_V" | shasum -a 256 | cut -d' ' -f1)
$PSQL "insert into magic_links (id, \"personId\", \"tokenHash\", \"laeuftAb\", \"erstelltAm\") values (gen_random_uuid(), '${VERWALTUNG_ID}', '${HASH_V}', now() + interval '1 hour', now());" > /dev/null
curl -s -D /tmp/gbs-kopf-v.txt -o /dev/null -X POST "${BASIS}/api/auth/token" -H 'Content-Type: application/json' -d "{\"token\":\"${TOKEN_V}\"}"
KEKS_V=$(grep -i '^set-cookie:' /tmp/gbs-kopf-v.txt | head -1 | sed 's/^[^:]*: //' | cut -d';' -f1)
pruefe "Verwaltungs-Session eingeloest" "$([ -n "$KEKS_V" ] && echo 1 || echo 0)"

# Noch hat die Dozentin keine Bankverbindung: Ohne IBAN keine Freigabe (409),
# und die Detailseite sagt das, statt einen klickbaren Knopf anzubieten.
FREI_OHNE_IBAN=$(rumpf_und_status -X POST "${BASIS}/api/honorar/abrechnungen/${ABR_ID}/freigeben" -H "Cookie: ${KEKS_V}")
pruefe "Freigabe ohne hinterlegte IBAN wird abgewiesen (409, „keine Bankverbindung“)" \
  "$([ "$FREI_OHNE_IBAN" = "409" ] && grep -q 'keine Bankverbindung' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$FREI_OHNE_IBAN $(cat /tmp/gbs-rumpf.txt)"
pruefe "die Abrechnung bleibt dabei OFFEN" \
  "$(gleich "$($PSQL "select status from honorar_abrechnungen where id='${ABR_ID}';")" "OFFEN")"
DET_OHNE_IBAN=$(curl -s "${BASIS}/verwaltung/honorar/abrechnungen/${ABR_ID}" -H "Cookie: ${KEKS_V}")
pruefe "die Detailseite sperrt die Freigabe und nennt den Weg („Meine Daten“)" \
  "$([ "$(enthaelt "$DET_OHNE_IBAN" 'Gesperrt: keine Bankverbindung hinterlegt.')" = "1" ] && [ "$(enthaelt "$DET_OHNE_IBAN" 'Meine Daten')" = "1" ] && echo 1 || echo 0)"

# Dem Dozenten eine gueltige (verschluesselte) IBAN geben — die eines beliebigen
# vorhandenen Kontos uebernehmen (die Anmeldung hat welche verschluesselt angelegt).
$PSQL "update personen set \"ibanVerschluesselt\" = (select \"ibanVerschluesselt\" from personen where \"ibanVerschluesselt\" is not null limit 1), kontoinhaber='Dora Dozento' where id='${DOZENT_ID}';" > /dev/null
pruefe "der Dozent hat jetzt eine Bankverbindung" \
  "$(gleich "$($PSQL "select \"ibanVerschluesselt\" is not null from personen where id='${DOZENT_ID}';")" "t")"

# Freigabe durch die Verwaltung (200): Beleg-Nr gesetzt, Status FREIGEGEBEN, Audit.
FREI_V=$(rumpf_und_status -X POST "${BASIS}/api/honorar/abrechnungen/${ABR_ID}/freigeben" -H "Cookie: ${KEKS_V}")
FREI_V_RUMPF=$(cat /tmp/gbs-rumpf.txt)
pruefe "die Verwaltung gibt die Abrechnung frei (200)" "$(gleich "$FREI_V" "200")" "$FREI_V"
# Die Freigabe ist die fachliche Tatsache; der Beleg geht best-effort ans DMS.
# Ohne DMS_EMAIL sagt die Antwort genau das (statt „E-Mail noch nicht eingerichtet").
pruefe "die Freigabe meldet den Belegversand ehrlich: keine DMS-Adresse" "$(enthaelt "$FREI_V_RUMPF" '"dmsVersand":"KEINE_ADRESSE"')" "$FREI_V_RUMPF"
pruefe "und der Beleg gilt als nicht zugestellt (dmsGesendetAm leer)" \
  "$(gleich "$($PSQL "select \"dmsGesendetAm\" is null from honorar_abrechnungen where id='${ABR_ID}';")" "t")"
pruefe "die Abrechnung ist danach FREIGEGEBEN" \
  "$(gleich "$($PSQL "select status from honorar_abrechnungen where id='${ABR_ID}';")" "FREIGEGEBEN")"
pruefe "eine DMS-Beleg-Nr ist vergeben (HONA-...)" \
  "$(enthaelt "$($PSQL "select \"belegNr\" from honorar_abrechnungen where id='${ABR_ID}';")" "HONA-")"
pruefe "die Freigabe steht im Audit-Log" \
  "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='HONORAR_ABRECHNUNG_FREIGEGEBEN';")" "t")"

# Doppelfreigabe ist ausgeschlossen (atomarer Statuswechsel). Konflikt mit dem
# Stand -> 409 (seit Code-Review 4, vorher 400).
FREI_2=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/honorar/abrechnungen/${ABR_ID}/freigeben" -H "Cookie: ${KEKS_V}")
pruefe "eine zweite Freigabe wird abgewiesen (409)" "$(gleich "$FREI_2" "409")" "$FREI_2"

# Die Rueckmeldung nach der Freigabe traegt die Seite ueber ?freigabe= — aber nur
# einen Ausgang, der zum gespeicherten Stand passt, und nur bekannte Werte.
FREI_SEITE=$(curl -s "${BASIS}/verwaltung/honorar/abrechnungen/${ABR_ID}?freigabe=KEINE_ADRESSE" -H "Cookie: ${KEKS_V}")
pruefe "die Seite nach der Freigabe nennt den Ausgang (Beleg erzeugt, nicht ans DMS)" \
  "$(enthaelt "$FREI_SEITE" 'erzeugt, aber nicht an das DMS gesendet')"
FREI_SEITE_X=$(curl -s "${BASIS}/verwaltung/honorar/abrechnungen/${ABR_ID}?freigabe=%3Cscript%3E" -H "Cookie: ${KEKS_V}")
pruefe "ein unbekannter Ausgang in der Adresse erzeugt keinen Freigabetext" \
  "$(fehlt_in "$FREI_SEITE_X" 'erzeugt, aber nicht an das DMS gesendet')"

# Ungueltiges Auszahlungsdatum wird abgewiesen (400) — geprueft, SOLANGE die
# Abrechnung freigegeben ist. Nach der Auszahlung bestuende die Pruefung auch ohne
# die Datumsregel, weil eine ausgezahlte Abrechnung ohnehin abgelehnt wird.
AUS_BAD=$(rumpf_und_status -X POST "${BASIS}/api/honorar/abrechnungen/${ABR_ID}/auszahlen" -H "Cookie: ${KEKS_V}" -H 'Content-Type: application/json' -d '{"ausgezahltAm":"2026-02-30"}')
pruefe "ein unmoegliches Auszahlungsdatum wird abgewiesen (400)" \
  "$([ "$AUS_BAD" = "400" ] && grep -q 'Auszahlungsdatum ist ungültig' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$AUS_BAD $(cat /tmp/gbs-rumpf.txt)"
pruefe "die Abrechnung bleibt dabei FREIGEGEBEN, ohne Auszahlungsdatum" \
  "$(gleich "$($PSQL "select status || '/' || (\"ausgezahltAm\" is null) from honorar_abrechnungen where id='${ABR_ID}';")" "FREIGEGEBEN/true")"

# Auszahlen (200) durch die Verwaltung.
AUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/honorar/abrechnungen/${ABR_ID}/auszahlen" -H "Cookie: ${KEKS_V}" -H 'Content-Type: application/json' -d "{\"ausgezahltAm\":\"${HEUTE}\"}")
pruefe "eine freigegebene Abrechnung laesst sich auszahlen (200)" "$(gleich "$AUS" "200")" "$AUS"
pruefe "die Abrechnung ist danach AUSGEZAHLT" \
  "$(gleich "$($PSQL "select status from honorar_abrechnungen where id='${ABR_ID}';")" "AUSGEZAHLT")"
pruefe "das Auszahlungsdatum ist gesetzt (heute)" \
  "$(gleich "$($PSQL "select \"ausgezahltAm\"::date from honorar_abrechnungen where id='${ABR_ID}';")" "$HEUTE")"
pruefe "das Auszahlen steht im Audit-Log" \
  "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='HONORAR_ABRECHNUNG_AUSGEZAHLT';")" "t")"

# Zahlungsbeleg nachsenden (M12): dieselben Rechte wie die Freigabe (der Beleg
# traegt die IBAN). Ohne DMS-Adresse ein Betriebsfehler (500) mit Hinweis —
# und kein Protokolleintrag, weil nichts versucht wurde.
NACH_S=$(status_von -X POST "${BASIS}/api/honorar/abrechnungen/${ABR_ID}/beleg-senden" -H "Cookie: ${KEKS}")
NACH_T=$(status_von -X POST "${BASIS}/api/honorar/abrechnungen/${ABR_ID}/beleg-senden" -H "Cookie: ${KEKS2}")
pruefe "Nachsenden: Schulleitung ohne IBAN-Recht und Teilnehmer abgewiesen (403/403)" \
  "$([ "$NACH_S" = "403" ] && [ "$NACH_T" = "403" ] && echo 1 || echo 0)" "${NACH_S}/${NACH_T}"
NACH_V=$(rumpf_und_status -X POST "${BASIS}/api/honorar/abrechnungen/${ABR_ID}/beleg-senden" -H "Cookie: ${KEKS_V}")
pruefe "Nachsenden ohne DMS-Adresse: 500 mit Hinweis auf DMS_EMAIL" \
  "$([ "$NACH_V" = "500" ] && grep -q 'DMS_EMAIL' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$NACH_V $(cat /tmp/gbs-rumpf.txt)"
pruefe "dabei bleibt der Beleg offen und ohne Nachversand-Eintrag" \
  "$(gleich "$($PSQL "select (select \"dmsGesendetAm\" is null from honorar_abrechnungen where id='${ABR_ID}') || '/' || (select count(*) from audit_log where aktion='HONORAR_ABRECHNUNG_BELEG_NACHVERSAND');")" "true/0")"
NACH_404=$(status_von -X POST "${BASIS}/api/honorar/abrechnungen/$(neuer_token)/beleg-senden" -H "Cookie: ${KEKS_V}")
pruefe "Nachsenden einer unbekannten Abrechnung ist 404" "$(gleich "$NACH_404" "404")" "$NACH_404"

# Seiten: Uebersicht + Detail (Schulleitung 200, Teilnehmer weggeleitet 307).
UEB_S=$(curl -s -o /dev/null -w '%{http_code}' "${BASIS}/verwaltung/honorar/abrechnungen?semester=${SEMESTER_ID}" -H "Cookie: ${KEKS}")
pruefe "die Schulleitung sieht die Abrechnungs-Uebersicht (200)" "$(gleich "$UEB_S" "200")" "$UEB_S"
UEB_T=$(curl -s -o /dev/null -w '%{http_code}' "${BASIS}/verwaltung/honorar/abrechnungen" -H "Cookie: ${KEKS2}")
pruefe "ein Teilnehmer wird von der Abrechnungs-Uebersicht weggeleitet (307)" "$(gleich "$UEB_T" "307")" "$UEB_T"
DET_S=$(curl -s -o /dev/null -w '%{http_code}' "${BASIS}/verwaltung/honorar/abrechnungen/${ABR_ID}" -H "Cookie: ${KEKS}")
pruefe "die Schulleitung sieht die Abrechnungs-Detailseite (200)" "$(gleich "$DET_S" "200")" "$DET_S"
# Ohne DMS-Adresse endete „Beleg erneut senden" sicher in einer 500 — die Seiten
# zeigen dann den Grund statt des Knopfs, fuer jede Rolle.
DET_V=$(curl -s "${BASIS}/verwaltung/honorar/abrechnungen/${ABR_ID}" -H "Cookie: ${KEKS_V}")
pruefe "Detailseite (Verwaltung): Hinweis auf DMS_EMAIL statt „Beleg erneut senden“" \
  "$([ "$(enthaelt "$DET_V" 'DMS_EMAIL')" = "1" ] && [ "$(fehlt_in "$DET_V" 'Beleg erneut senden')" = "1" ] && echo 1 || echo 0)"
DET_S_HTML=$(curl -s "${BASIS}/verwaltung/honorar/abrechnungen/${ABR_ID}" -H "Cookie: ${KEKS}")
pruefe "Detailseite (Schulleitung): derselbe Hinweis hat Vorrang vor dem Rechtehinweis" \
  "$([ "$(enthaelt "$DET_S_HTML" 'DMS_EMAIL')" = "1" ] && [ "$(fehlt_in "$DET_S_HTML" 'Nachsenden erfordert das Recht')" = "1" ] && echo 1 || echo 0)"
SAETZE_HTML=$(curl -s "${BASIS}/verwaltung/honorar/saetze" -H "Cookie: ${KEKS}")
pruefe "Satz-Verwaltung: Hinweis auf DMS_EMAIL statt „Beleg erneut senden“" \
  "$([ "$(enthaelt "$SAETZE_HTML" 'DMS_EMAIL')" = "1" ] && [ "$(fehlt_in "$SAETZE_HTML" 'Beleg erneut senden')" = "1" ] && echo 1 || echo 0)"

# Eine ausgezahlte Abrechnung und ein genehmigter Satz sind auch fuer den
# Eigentuemer eingefroren: kein Loeschen, kein Zurueck in der Statuskette, kein
# geaenderter Betrag.
pruefe "eine ausgezahlte Abrechnung laesst sich per SQL weder loeschen noch zuruecksetzen" \
  "$([ "$(abgewiesen "delete from honorar_abrechnungen where id='${ABR_ID}';")" = "1" ] && [ "$(abgewiesen "update honorar_abrechnungen set status='OFFEN' where id='${ABR_ID}';")" = "1" ] && echo 1 || echo 0)"
pruefe "ein genehmigter Satz laesst sich per SQL weder aendern noch loeschen" \
  "$([ "$(abgewiesen "update honorar_saetze set betrag = 1 where betrag=95;")" = "1" ] && [ "$(abgewiesen "delete from honorar_saetze where betrag=95;")" = "1" ] && echo 1 || echo 0)"
# Auch nichts anhaengen: Ein neuer Posten zu einer ausgezahlten Abrechnung
# scheitert schon am INSERT-Trigger (er feuert vor Unique und Fremdschluessel).
pruefe "einer ausgezahlten Abrechnung laesst sich per SQL kein Posten anhaengen" \
  "$(abgewiesen "insert into honorar_abrechnung_posten (id, \"abrechnungId\", \"terminId\", datum, fach, betrag) values (gen_random_uuid(), '${ABR_ID}', gen_random_uuid()::text, now(), null, 1);")"
# summe ist eine Kopie der Posten-Summe — beim Commit muss sie passen
# (verzoegerter Constraint-Trigger). Ein Kopf ohne Posten mit Summe 5 scheitert.
pruefe "eine Abrechnung, deren Summe nicht zu ihren Posten passt, scheitert beim Commit" \
  "$($PSQL "insert into honorar_abrechnungen (id, \"dozentId\", \"semesterId\", summe) values (gen_random_uuid(), '${DOZENT_ID}', '${SEMESTER_ID}', 5);" 2>&1 | grep -q 'passt nicht zur Summe ihrer Posten' && [ "$($PSQL "select count(*) from honorar_abrechnungen where summe = 5;")" = "0" ] && echo 1 || echo 0)"
pruefe "Abrechnung und Satz stehen danach unveraendert (AUSGEZAHLT, ein 95er)" \
  "$(gleich "$($PSQL "select (select status::text from honorar_abrechnungen where id='${ABR_ID}') || '/' || (select count(*) from honorar_saetze where betrag=95);")" "AUSGEZAHLT/1")"

echo
echo "=== 29c. Honorar-Korrekturwege: Dozentenwechsel, Storno, Neuabrechnung (M11) ==="
# Ein abgerechneter Abend darf keinem anderen Dozenten zugeordnet werden — sonst
# bliebe der eingefrorene Posten beim bisherigen, und beim neuen liesse sich der
# Abend nie abrechnen. Korrekturweg: OFFENE Abrechnung stornieren, umhaengen, neu
# abrechnen. Eine freigegebene hat ihren Zahlungsbeleg schon herausgegeben.
DOZENT_B_ID=$($PSQL "insert into personen (id,vorname,nachname,email,\"statusCode\",\"erstelltAm\",\"aktualisiertAm\") values (gen_random_uuid(),'Benno','Beidozent','beidozent@beispiel.de','AKTIV',now(),now()) returning id;")
$PSQL "insert into person_rolle (\"personId\",\"rolleCode\") values ('${DOZENT_B_ID}','DOZENT');" > /dev/null

WECHSEL_FREI=$(rumpf_und_status -X PUT "${BASIS}/api/stundenplan/termine/${DT1}" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"dozentId\":\"${DOZENT_B_ID}\"}")
pruefe "Dozentenwechsel an einem freigegebenen Abend wird abgewiesen (409)" \
  "$([ "$WECHSEL_FREI" = "409" ] && grep -q 'freigegebenen Abrechnung' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$WECHSEL_FREI $(cat /tmp/gbs-rumpf.txt)"
pruefe "der Abend bleibt bei der bisherigen Dozentin" \
  "$(gleich "$($PSQL "select \"dozentId\" from unterrichtstermine where id='${DT1}';")" "$DOZENT_ID")"
# Die Stundenplanseite schickt Fach und Dozent immer gemeinsam — eine reine
# Fachkorrektur (derselbe Dozent) bleibt erlaubt, das Entfernen nicht.
WECHSEL_GLEICH=$(status_von -X PUT "${BASIS}/api/stundenplan/termine/${DT1}" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"dozentId\":\"${DOZENT_ID}\",\"kurseinheitId\":\"${KURSEINHEIT_ID}\"}")
pruefe "derselbe Dozent mit geaendertem Fach bleibt erlaubt (200)" "$(gleich "$WECHSEL_GLEICH" "200")" "$WECHSEL_GLEICH"
WECHSEL_NULL=$(status_von -X PUT "${BASIS}/api/stundenplan/termine/${DT1}" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"dozentId":null}')
pruefe "den Dozenten eines freigegebenen Abends entfernen ist ebenfalls gesperrt (409)" "$(gleich "$WECHSEL_NULL" "409")" "$WECHSEL_NULL"

# Ein weiterer gehaltener Abend der Dozentin, abgerechnet -> OFFENE Abrechnung.
DT3=$($PSQL "insert into unterrichtstermine (id,\"semesterId\",beginn,reihenfolge,\"dozentId\",\"erstelltAm\") values (gen_random_uuid(),'${SEMESTER_ID}',now()-interval '1 day',93,'${DOZENT_ID}',now()) returning id;")
ABR2_ANTWORT=$(rumpf_und_status -X POST "${BASIS}/api/honorar/abrechnungen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"dozentId\":\"${DOZENT_ID}\",\"semesterId\":\"${SEMESTER_ID}\"}")
ABR2_ID=$(sed -n 's/.*"abrechnungId":"\([^"]*\)".*/\1/p' /tmp/gbs-rumpf.txt)
pruefe "eine zweite Abrechnung entsteht fuer den neuen Abend (201, 1 Abend zu 120)" \
  "$([ "$ABR2_ANTWORT" = "201" ] && [ "$($PSQL "select count(*) || '/' || sum(betrag) from honorar_abrechnung_posten where \"abrechnungId\"='${ABR2_ID}';")" = "1/120" ] && echo 1 || echo 0)" "$ABR2_ANTWORT $(cat /tmp/gbs-rumpf.txt)"
WECHSEL_OFFEN=$(rumpf_und_status -X PUT "${BASIS}/api/stundenplan/termine/${DT3}" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"dozentId\":\"${DOZENT_B_ID}\"}")
pruefe "Dozentenwechsel an einem OFFEN abgerechneten Abend: 409 mit Weg (erst stornieren)" \
  "$([ "$WECHSEL_OFFEN" = "409" ] && grep -q 'erst die Abrechnung stornieren' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$WECHSEL_OFFEN $(cat /tmp/gbs-rumpf.txt)"
NACH_OFFEN=$(status_von -X POST "${BASIS}/api/honorar/abrechnungen/${ABR2_ID}/beleg-senden" -H "Cookie: ${KEKS_V}")
pruefe "eine OFFENE Abrechnung hat noch keinen Beleg zum Nachsenden (409)" "$(gleich "$NACH_OFFEN" "409")" "$NACH_OFFEN"
pruefe "ihre Detailseite bietet den Storno an" \
  "$(enthaelt "$(curl -s "${BASIS}/verwaltung/honorar/abrechnungen/${ABR2_ID}" -H "Cookie: ${KEKS}")" 'Abrechnung stornieren')"

STORNO_T=$(status_von -X DELETE "${BASIS}/api/honorar/abrechnungen/${ABR2_ID}" -H "Cookie: ${KEKS2}")
pruefe "ein Teilnehmer darf nicht stornieren (403)" "$(gleich "$STORNO_T" "403")" "$STORNO_T"
# Der Server verbindet sich als gbs_app, und gbs_app hat KEIN DELETE auf den
# Posten (eingefroren). Der Storno loescht nur die Abrechnung; die Posten gehen
# per Fremdschluessel-Cascade mit — und der Trigger laesst genau das zu.
STORNO=$(status_von -X DELETE "${BASIS}/api/honorar/abrechnungen/${ABR2_ID}" -H "Cookie: ${KEKS}")
pruefe "die Schulleitung storniert die OFFENE Abrechnung (200)" "$(gleich "$STORNO" "200")" "$STORNO"
pruefe "Abrechnung und Posten sind weg (Cascade trotz entzogenem DELETE auf Posten)" \
  "$(gleich "$($PSQL "select (select count(*) from honorar_abrechnungen where id='${ABR2_ID}') + (select count(*) from honorar_abrechnung_posten where \"abrechnungId\"='${ABR2_ID}');")" "0")"
pruefe "der Storno steht mit den geloeschten Posten im Protokoll" \
  "$(gleich "$($PSQL "select jsonb_array_length(vorher->'posten') from audit_log where aktion='HONORAR_ABRECHNUNG_STORNIERT' and \"objektId\"='${ABR2_ID}';")" "1")"
FREI_STORNIERT=$(rumpf_und_status -X POST "${BASIS}/api/honorar/abrechnungen/${ABR2_ID}/freigeben" -H "Cookie: ${KEKS_V}")
pruefe "eine stornierte Abrechnung gibt es nicht mehr (Freigabe: 404)" \
  "$([ "$FREI_STORNIERT" = "404" ] && grep -q 'gibt es nicht' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$FREI_STORNIERT $(cat /tmp/gbs-rumpf.txt)"
# Jetzt ist der Abend wieder frei: umhaengen und fuer den neuen Dozenten abrechnen.
WECHSEL_NACH=$(status_von -X PUT "${BASIS}/api/stundenplan/termine/${DT3}" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"dozentId\":\"${DOZENT_B_ID}\"}")
pruefe "nach dem Storno laesst sich der Abend umhaengen (200)" "$(gleich "$WECHSEL_NACH" "200")" "$WECHSEL_NACH"
ABR_B=$(rumpf_und_status -X POST "${BASIS}/api/honorar/abrechnungen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"dozentId\":\"${DOZENT_B_ID}\",\"semesterId\":\"${SEMESTER_ID}\"}")
pruefe "und fuer den neuen Dozenten abrechnen (201, 1 Abend)" \
  "$([ "$ABR_B" = "201" ] && grep -q '"abende":1' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$ABR_B $(cat /tmp/gbs-rumpf.txt)"
STORNO_AUS=$(status_von -X DELETE "${BASIS}/api/honorar/abrechnungen/${ABR_ID}" -H "Cookie: ${KEKS}")
pruefe "eine ausgezahlte Abrechnung ist nicht stornierbar (409, bleibt AUSGEZAHLT)" \
  "$([ "$STORNO_AUS" = "409" ] && [ "$($PSQL "select status from honorar_abrechnungen where id='${ABR_ID}';")" = "AUSGEZAHLT" ] && echo 1 || echo 0)" "$STORNO_AUS"
STORNO_404=$(status_von -X DELETE "${BASIS}/api/honorar/abrechnungen/$(neuer_token)" -H "Cookie: ${KEKS}")
pruefe "eine unbekannte Abrechnung zu stornieren ist 404" "$(gleich "$STORNO_404" "404")" "$STORNO_404"

# Die Stundenplanseite kennzeichnet abgerechnete Abende und fuehrt zur Abrechnung;
# die Semesterwahl ist seit dem Oberflächenplan (09/2026) ein Menü aus Links (ohne „Anzeigen“).
PLAN=$(curl -s "${BASIS}/verwaltung/stundenplan?semester=${SEMESTER_ID}" -H "Cookie: ${KEKS}")
pruefe "Stundenplan: abgerechnete Abende sind markiert und verlinken die Abrechnung" \
  "$([ "$(enthaelt "$PLAN" 'abgerechnet')" = "1" ] && [ "$(enthaelt "$PLAN" 'Zur Abrechnung')" = "1" ] && echo 1 || echo 0)"
pruefe "Stundenplan: Semesterwahl als Links (wirkt sofort, kein „Anzeigen“)" \
  "$([ "$(enthaelt "$PLAN" '/verwaltung/stundenplan?semester=')" = "1" ] && [ "$(fehlt_in "$PLAN" 'Anzeigen')" = "1" ] && echo 1 || echo 0)"

echo
echo "=== 30. Sicherheits-Header: Content-Security-Policy am App-Container ==="
# Die CSP steht in next.config.ts (nicht nur in Traefik) und liegt deshalb schon
# direkt auf den Antworten des App-Containers — hier gegen die Login-Seite geprueft.
CSPHDR=$(curl -s -D - -o /dev/null "${BASIS}/anmelden")
pruefe "die App setzt eine Content-Security-Policy (default-src self)" "$(enthaelt "$CSPHDR" "default-src 'self'")" "$CSPHDR"
pruefe "die CSP verbietet Framing (frame-ancestors none)" "$(enthaelt "$CSPHDR" "frame-ancestors 'none'")"
pruefe "die CSP erlaubt keine fremden Skript-Hosts (object-src none)" "$(enthaelt "$CSPHDR" "object-src 'none'")"

echo
echo "=== 31. Getrennter, rechtebeschraenkter Anwendungs-Datenbanknutzer (gbs_app) ==="
pruefe "Rolle gbs_app existiert und darf sich anmelden" \
  "$(gleich "$($PSQL "select rolcanlogin from pg_roles where rolname='gbs_app';")" "t")"
# Der ganze Durchstich lief bereits gegen die App als gbs_app — hier zusaetzlich
# der direkte Nachweis, dass gerade eine solche Verbindung offen ist.
curl -s -o /dev/null "${BASIS}/api/health"
pruefe "der laufende Server verbindet sich als gbs_app (nicht als Eigentuemer)" \
  "$([ "$($PSQL "select count(*) from pg_stat_activity where datname='${DBNAME}' and usename='gbs_app';")" -gt 0 ] && echo 1 || echo 0)"
pruefe "gbs_app darf Personen lesen und schreiben (SELECT/INSERT/UPDATE/DELETE)" \
  "$(gleich "$($PSQL "select has_table_privilege('gbs_app','personen','SELECT') and has_table_privilege('gbs_app','personen','INSERT') and has_table_privilege('gbs_app','personen','UPDATE') and has_table_privilege('gbs_app','personen','DELETE');")" "t")"
pruefe "gbs_app darf das Audit-Log ergaenzen (INSERT)" \
  "$(gleich "$($PSQL "select has_table_privilege('gbs_app','audit_log','INSERT');")" "t")"
pruefe "gbs_app darf das Audit-Log NICHT aendern (kein UPDATE-Recht)" \
  "$(gleich "$($PSQL "select has_table_privilege('gbs_app','audit_log','UPDATE');")" "f")"
pruefe "gbs_app darf das Audit-Log NICHT loeschen (kein DELETE-Recht)" \
  "$(gleich "$($PSQL "select has_table_privilege('gbs_app','audit_log','DELETE');")" "f")"
pruefe "gbs_app darf Einwilligungen NICHT aendern oder loeschen" \
  "$(gleich "$($PSQL "select has_table_privilege('gbs_app','einwilligungen','UPDATE') or has_table_privilege('gbs_app','einwilligungen','DELETE');")" "f")"
# Code-Review 4, M8: Einwilligungstexte nur lesen und ergaenzen (neue Fassung).
pruefe "gbs_app darf Einwilligungstexte NICHT aendern, loeschen oder leeren" \
  "$(gleich "$($PSQL "select has_table_privilege('gbs_app','einwilligungs_texte','UPDATE') or has_table_privilege('gbs_app','einwilligungs_texte','DELETE') or has_table_privilege('gbs_app','einwilligungs_texte','TRUNCATE');")" "f")"
pruefe "gbs_app darf Einwilligungstexte lesen und ergaenzen" \
  "$(gleich "$($PSQL "select has_table_privilege('gbs_app','einwilligungs_texte','SELECT') and has_table_privilege('gbs_app','einwilligungs_texte','INSERT');")" "t")"
# Eingefrorene Belege (Migration 20260927160000): Posten nie aendern oder einzeln
# loeschen, Saetze und Zeugnisse nie loeschen. Was die Anwendung braucht, bleibt:
# Storno einer OFFENEN Abrechnung, Status/DMS/Scrub an Zeugnis und Satz.
pruefe "gbs_app darf eingefrorene Belege NICHT loeschen (Posten auch nicht aendern)" \
  "$(gleich "$($PSQL "select has_table_privilege('gbs_app','honorar_abrechnung_posten','UPDATE') or has_table_privilege('gbs_app','honorar_abrechnung_posten','DELETE') or has_table_privilege('gbs_app','honorar_saetze','DELETE') or has_table_privilege('gbs_app','zeugnisse','DELETE');")" "f")"
pruefe "gbs_app behaelt, was die Anwendung braucht (Storno, Zeugnis- und Satz-Nachtraege)" \
  "$(gleich "$($PSQL "select has_table_privilege('gbs_app','honorar_abrechnungen','DELETE') and has_table_privilege('gbs_app','zeugnisse','UPDATE') and has_table_privilege('gbs_app','honorar_saetze','UPDATE');")" "t")"
# 12 Unveraenderlichkeits-Trigger plus 2 verzoegerte Summen-Trigger (Kopf, Posten).
pruefe "die vierzehn Unveraenderlichkeits- und Summen-Trigger der Belege sind angelegt" \
  "$(gleich "$($PSQL "select count(*) from pg_trigger where not tgisinternal and tgrelid in ('honorar_saetze'::regclass,'honorar_abrechnungen'::regclass,'honorar_abrechnung_posten'::regclass,'zeugnisse'::regclass);")" "14")"
pruefe "die drei Trigger der Einwilligungstexte sind angelegt" \
  "$(gleich "$($PSQL "select count(*) from pg_trigger where not tgisinternal and tgrelid = 'einwilligungs_texte'::regclass;")" "3")"

echo
echo "=== 32. Rollenverwaltung (Recht BENUTZER_VERWALTEN, nur Administrator) ==="
# BENUTZER_VERWALTEN hat nur die Rolle ADMIN. Der einzige Administrator ist Anna
# (admin@beispiel.de, in Abschnitt 13 angelegt) — bewusst wiederverwendet: So gibt
# es genau EINEN Administrator, was der Letzter-Admin-Test unten braucht. Die Id
# wird frisch aus der DB geholt (unabhaengig davon, ob die Variable noch gesetzt ist).
ADMIN_ID=$($PSQL "select id from personen where email='admin@beispiel.de';")
AD_TOK=$(uuidgen | tr 'A-Z' 'a-z'); AD_HASH=$(printf %s "$AD_TOK" | shasum -a 256 | cut -d' ' -f1)
$PSQL "insert into magic_links (id,\"personId\",\"tokenHash\",\"laeuftAb\",\"erstelltAm\") values (gen_random_uuid(),'${ADMIN_ID}','${AD_HASH}',now()+interval '1 hour',now());" > /dev/null
curl -s -D /tmp/gbs-kopf-admin.txt -o /dev/null -X POST "${BASIS}/api/auth/token" -H 'Content-Type: application/json' -d "{\"token\":\"${AD_TOK}\"}"
KEKS_ADMIN=$(grep -i '^set-cookie:' /tmp/gbs-kopf-admin.txt | head -1 | sed 's/^[^:]*: //' | cut -d';' -f1)
pruefe "Administrator-Konto meldet sich an" "$([ -n "$KEKS_ADMIN" ] && echo 1 || echo 0)"

# Der Administrator gibt einer Person die Rolle Dozent.
curl -s -o /dev/null -X PUT "${BASIS}/api/personen/${TEILNEHMER_ID}/rollen" -H "Cookie: ${KEKS_ADMIN}" -H 'Content-Type: application/json' -d '{"rollen":["TEILNEHMER","DOZENT"]}'
pruefe "der Administrator fuegt die Rolle Dozent hinzu" \
  "$(gleich "$($PSQL "select count(*) from person_rolle where \"personId\"='${TEILNEHMER_ID}' and \"rolleCode\"='DOZENT';")" "1")"
# und entzieht sie wieder.
curl -s -o /dev/null -X PUT "${BASIS}/api/personen/${TEILNEHMER_ID}/rollen" -H "Cookie: ${KEKS_ADMIN}" -H 'Content-Type: application/json' -d '{"rollen":["TEILNEHMER"]}'
pruefe "der Administrator entzieht die Rolle wieder" \
  "$(gleich "$($PSQL "select count(*) from person_rolle where \"personId\"='${TEILNEHMER_ID}' and \"rolleCode\"='DOZENT';")" "0")"

# Ein Teilnehmer darf keine Rollen verwalten (403).
RV_TEILN=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "${BASIS}/api/personen/${TEILNEHMER_ID}/rollen" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' -d '{"rollen":["TEILNEHMER","DOZENT"]}')
pruefe "ein Teilnehmer darf keine Rollen verwalten (403)" "$(gleich "$RV_TEILN" "403")" "$RV_TEILN"
# Die Schulleitung ebenfalls nicht (kein BENUTZER_VERWALTEN) — bewusst nur der Administrator.
RV_SCHUL=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "${BASIS}/api/personen/${TEILNEHMER_ID}/rollen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"rollen":["TEILNEHMER"]}')
pruefe "die Schulleitung darf keine Rollen verwalten (403)" "$(gleich "$RV_SCHUL" "403")" "$RV_SCHUL"
# Eine unbekannte Rolle wird abgewiesen (400).
RV_UNBEK=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "${BASIS}/api/personen/${TEILNEHMER_ID}/rollen" -H "Cookie: ${KEKS_ADMIN}" -H 'Content-Type: application/json' -d '{"rollen":["HACKER"]}')
pruefe "eine unbekannte Rolle wird abgewiesen (400)" "$(gleich "$RV_UNBEK" "400")" "$RV_UNBEK"

# Der letzte Administrator laesst sich nicht entziehen (409) — sonst kaeme niemand mehr an die Rollen.
RV_LETZT=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "${BASIS}/api/personen/${ADMIN_ID}/rollen" -H "Cookie: ${KEKS_ADMIN}" -H 'Content-Type: application/json' -d '{"rollen":[]}')
pruefe "der letzte Administrator laesst sich nicht entziehen (409)" "$(gleich "$RV_LETZT" "409")" "$RV_LETZT"
pruefe "der Administrator hat seine Rolle behalten" \
  "$(gleich "$($PSQL "select count(*) from person_rolle where \"personId\"='${ADMIN_ID}' and \"rolleCode\"='ADMIN';")" "1")"
pruefe "die Rollenaenderung ist protokolliert (ROLLEN_GEAENDERT)" \
  "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='ROLLEN_GEAENDERT' and \"objektId\"='${TEILNEHMER_ID}';")" "t")"

echo
echo "=== 33. Personen anlegen und fremde Stammdaten aendern ==="
# Anlegen (Recht BENUTZER_VERWALTEN, Administrator) — KEKS_ADMIN aus Abschnitt 32.
NEU=$(curl -s -X POST "${BASIS}/api/personen" -H "Cookie: ${KEKS_ADMIN}" -H 'Content-Type: application/json' -d '{"vorname":"Neu","nachname":"Konto","email":"neu@beispiel.de","telefon":"0571 111"}')
NEU_ID=$(echo "$NEU" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
pruefe "der Administrator legt eine Person an" "$([ -n "$NEU_ID" ] && echo 1 || echo 0)" "$NEU"
pruefe "die neue Person ist aktiv" \
  "$(gleich "$($PSQL "select \"statusCode\" from personen where id='${NEU_ID}';")" "AKTIV")"
pruefe "die neue Person hat die Rolle Teilnehmer" \
  "$(gleich "$($PSQL "select count(*) from person_rolle where \"personId\"='${NEU_ID}' and \"rolleCode\"='TEILNEHMER';")" "1")"
pruefe "der erste Status ist protokolliert (StatusWechsel)" \
  "$(gleich "$($PSQL "select count(*) from status_wechsel where \"personId\"='${NEU_ID}' and \"nachCode\"='AKTIV';")" "1")"
# Doppelte E-Mail wird abgewiesen (409).
NEU_DOPP=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/personen" -H "Cookie: ${KEKS_ADMIN}" -H 'Content-Type: application/json' -d '{"vorname":"Noch","nachname":"Einer","email":"neu@beispiel.de"}')
pruefe "eine doppelte E-Mail-Adresse wird abgewiesen (409)" "$(gleich "$NEU_DOPP" "409")" "$NEU_DOPP"
# Die Schulleitung darf keine Person anlegen (kein BENUTZER_VERWALTEN) — 403.
NEU_SCHUL=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/personen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"vorname":"X","nachname":"Y","email":"xy@beispiel.de"}')
pruefe "die Schulleitung darf keine Person anlegen (403)" "$(gleich "$NEU_SCHUL" "403")" "$NEU_SCHUL"
# Unsinnige Eingabe (kaputte E-Mail) -> 400.
NEU_BAD=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/personen" -H "Cookie: ${KEKS_ADMIN}" -H 'Content-Type: application/json' -d '{"vorname":"A","nachname":"B","email":"keine-mail"}')
pruefe "eine kaputte E-Mail beim Anlegen wird abgewiesen (400)" "$(gleich "$NEU_BAD" "400")" "$NEU_BAD"

# Fremde Stammdaten aendern (Recht PERSON_BEARBEITEN_ALLE, Schulleitung/Verwaltung).
curl -s -o /dev/null -X PUT "${BASIS}/api/personen/${NEU_ID}/stammdaten" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"vorname":"Neu","nachname":"Konto","telefon":"0571 555","strasse":"Musterweg 3","plz":"32423","ort":"Minden"}'
pruefe "die Schulleitung aendert fremde Stammdaten (Strasse)" \
  "$(gleich "$($PSQL "select strasse from personen where id='${NEU_ID}';")" "Musterweg 3")"
# Ein Teilnehmer darf keine fremden Stammdaten aendern (403).
ST_TEILN=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "${BASIS}/api/personen/${NEU_ID}/stammdaten" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' -d '{"vorname":"Hack","nachname":"Er"}')
pruefe "ein Teilnehmer darf keine fremden Stammdaten aendern (403)" "$(gleich "$ST_TEILN" "403")" "$ST_TEILN"
# Der Administrator ebenfalls nicht (kein PERSON_BEARBEITEN_ALLE — bewusste Trennung).
ST_ADMIN=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "${BASIS}/api/personen/${NEU_ID}/stammdaten" -H "Cookie: ${KEKS_ADMIN}" -H 'Content-Type: application/json' -d '{"vorname":"Neu","nachname":"Konto"}')
pruefe "der Administrator darf keine fremden Stammdaten aendern (403)" "$(gleich "$ST_ADMIN" "403")" "$ST_ADMIN"
# Beides ist protokolliert.
pruefe "das Anlegen ist protokolliert (PERSON_ANGELEGT)" \
  "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='PERSON_ANGELEGT' and \"objektId\"='${NEU_ID}';")" "t")"
pruefe "die Stammdatenaenderung ist protokolliert (PERSON_STAMMDATEN_GEAENDERT)" \
  "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='PERSON_STAMMDATEN_GEAENDERT' and \"objektId\"='${NEU_ID}';")" "t")"

# Soll-Anzahl, wie in den vier Fachlogik-Skripten. Ohne sie meldet ein Lauf, der
# unterwegs einen ganzen Block ueberspringt, weiterhin "0 fehlgeschlagen" — ein
# nicht gelaufener Test schlaegt nicht fehl, er fehlt nur. Beim Ergaenzen einer
# Pruefung gehoert diese Zahl mit angehoben.
echo
echo "=== 34. Dozenten-Self-Service (eigener Bereich + Anwesenheit an der Quelle) ==="
# Die neuen Rechte sind Daten (Seed, keine Migration) und der Rolle DOZENT zugeordnet.
pruefe "Recht EIGENE_TERMINE_LESEN ist geseedet" \
  "$(gleich "$($PSQL "select count(*) from rechte where code='EIGENE_TERMINE_LESEN';")" "1")"
pruefe "Recht ANWESENHEIT_ERFASSEN_EIGENE ist geseedet" \
  "$(gleich "$($PSQL "select count(*) from rechte where code='ANWESENHEIT_ERFASSEN_EIGENE';")" "1")"
pruefe "DOZENT hat EIGENE_TERMINE_LESEN" \
  "$(gleich "$($PSQL "select count(*) from rolle_recht where \"rolleCode\"='DOZENT' and \"rechtCode\"='EIGENE_TERMINE_LESEN';")" "1")"
pruefe "GASTDOZENT hat das Dozentenrecht NICHT (Token-Flow ohne Login)" \
  "$(gleich "$($PSQL "select count(*) from rolle_recht where \"rolleCode\"='GASTDOZENT' and \"rechtCode\"='EIGENE_TERMINE_LESEN';")" "0")"

# Zwei dedizierte vergangene Abende: einer der Dozentin (DOZENT_ID aus Abschnitt 29),
# einer ohne Dozent — fuer den Scope-Guard.
DZ_TERMIN=$($PSQL "insert into unterrichtstermine (id,\"semesterId\",beginn,reihenfolge,\"dozentId\",\"erstelltAm\") values (gen_random_uuid(),'${SEMESTER_ID}',now()-interval '7 days',97,'${DOZENT_ID}',now()) returning id;")
FREMD_TERMIN=$($PSQL "insert into unterrichtstermine (id,\"semesterId\",beginn,reihenfolge,\"erstelltAm\") values (gen_random_uuid(),'${SEMESTER_ID}',now()-interval '6 days',96,now()) returning id;")

# Die Dozentin meldet sich an (frischer Magic-Link, wie im echten Ablauf).
DZTOKEN=$(uuidgen | tr 'A-Z' 'a-z'); DZHASH=$(printf %s "$DZTOKEN" | shasum -a 256 | cut -d' ' -f1)
$PSQL "insert into magic_links (id,\"personId\",\"tokenHash\",\"laeuftAb\",\"erstelltAm\") values (gen_random_uuid(),'${DOZENT_ID}','${DZHASH}',now()+interval '1 hour',now());" > /dev/null
curl -s -D /tmp/gbs-kopf-doz.txt -o /dev/null -X POST "${BASIS}/api/auth/token" -H 'Content-Type: application/json' -d "{\"token\":\"${DZTOKEN}\"}"
KEKS_DOZ=$(grep -i '^set-cookie:' /tmp/gbs-kopf-doz.txt | head -1 | sed 's/^[^:]*: //' | cut -d';' -f1)
pruefe "die Dozentin meldet sich an" "$([ -n "$KEKS_DOZ" ] && echo 1 || echo 0)"

# Login-Routing: der Verwaltungsbereich leitet die reine Dozentin auf /dozent.
DZ_LOC=$(curl -s -o /dev/null -w '%{redirect_url}' "${BASIS}/verwaltung" -H "Cookie: ${KEKS_DOZ}")
pruefe "die Dozentin wird vom Verwaltungsbereich auf /dozent geleitet" "$(enthaelt "$DZ_LOC" '/dozent')"

# Ein Teilnehmer (ohne Dozentenrecht) wird NICHT nach /dozent, sondern in die Akte geleitet.
TN_LOC=$(curl -s -o /dev/null -w '%{redirect_url}' "${BASIS}/verwaltung" -H "Cookie: ${KEKS2}")
pruefe "ein Teilnehmer wird auf /meine-daten geleitet (nicht /dozent)" "$(enthaelt "$TN_LOC" '/meine-daten')"
# Ohne Dozentenrecht fuehrt /dozent selbst weg (Seiten-Guard, 307).
DZ_GUARD=$(curl -s -o /dev/null -w '%{http_code}' "${BASIS}/dozent" -H "Cookie: ${KEKS2}")
pruefe "ohne Dozentenrecht fuehrt /dozent weg (307)" "$(gleich "$DZ_GUARD" "307")" "$DZ_GUARD"

# Die Dozentenseite rendert und zeigt den eigenen Unterricht — wertpruefend, nicht nur die Ueberschrift.
DZ_SEITE=$(curl -s "${BASIS}/dozent" -H "Cookie: ${KEKS_DOZ}")
pruefe "die Dozentenseite rendert (Mein Unterricht)" "$(enthaelt "$DZ_SEITE" 'Mein Unterricht')"
pruefe "die Seite zeigt die eigenen Abende (nicht den Leerzustand)" "$(fehlt_in "$DZ_SEITE" 'noch keine Unterrichtsabende zugeordnet')"
pruefe "ein vergangener eigener Abend bietet die Erfassung an" "$(enthaelt "$DZ_SEITE" 'data-erfassbar="ja"')"
pruefe "ein kuenftiger eigener Abend ist markiert (geplant)" "$(enthaelt "$DZ_SEITE" 'geplant')"
# „Offene Aufgaben" springt per Anker zum Abend im Stundenplan: DZ_TERMIN liegt
# zurueck und ist noch fuer niemanden erfasst.
pruefe "offene Erfassung verlinkt den Abend per Anker (#termin-…), das Ziel existiert" \
  "$([ "$(enthaelt "$DZ_SEITE" "href=\"#termin-${DZ_TERMIN}\"")" = "1" ] && [ "$(enthaelt "$DZ_SEITE" "id=\"termin-${DZ_TERMIN}\"")" = "1" ] && echo 1 || echo 0)"
# Rueckwege: Wer von „Mein Unterricht" in die eigene Akte geht, kommt dorthin zurueck.
pruefe "die Übersicht leitet eine Dozentin ohne eigene Teilnahme zu „Ich“ (307)" "$(gleich "$(status_von "${BASIS}/meine-daten" -H "Cookie: ${KEKS_DOZ}")" "307")"
DZ_AKTE=$(curl -s "${BASIS}/meine-daten/ich" -H "Cookie: ${KEKS_DOZ}")
pruefe "die eigenen Daten der Dozentin fuehren ueber die Leiste zurueck zu „Unterricht“ (/dozent)" \
  "$([ "$(enthaelt "$DZ_AKTE" 'href="/dozent"')" = "1" ] && [ "$(enthaelt "$DZ_AKTE" '>Unterricht<')" = "1" ] && echo 1 || echo 0)"
pruefe "ein Teilnehmer sieht dort weiter seine Übersicht („Hallo Petra“)" "$(enthaelt "$(curl -s "${BASIS}/meine-daten" -H "Cookie: ${KEKS2}")" 'Hallo Petra')"

# Anwesenheit fuer den EIGENEN vergangenen Abend erfassen (200) + Provenienz.
DZ_OK=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/dozent/anwesenheit" -H "Cookie: ${KEKS_DOZ}" -H 'Content-Type: application/json' -d "{\"terminId\":\"${DZ_TERMIN}\",\"eintraege\":[{\"teilnahmeId\":\"${TEILNAHME_ID}\",\"status\":\"ANWESEND\"}]}")
pruefe "die Dozentin erfasst Anwesenheit ihres eigenen Abends (200)" "$(gleich "$DZ_OK" "200")" "$DZ_OK"
pruefe "der Eintrag traegt die Dozentin als Erfasser" \
  "$(gleich "$($PSQL "select \"erfasstVonId\" from anwesenheiten where \"terminId\"='${DZ_TERMIN}' and \"teilnahmeId\"='${TEILNAHME_ID}';")" "${DOZENT_ID}")"

# Ueberschreib-Pfad (Autoritaet des Dozenten): DT2 traegt eine SELBSTBESTAETIGUNG der
# Teilnehmerin (NACHGEARBEITET, erfasstVonId = sie selbst, aus Abschnitt 28). Der Dozent
# DARF sie ueberschreiben — der Teilnehmer-Pfad darf einen fremden Eintrag gerade NICHT.
# Vorbedingung explizit sichern, damit der Test wirklich den UPDATE-Zweig prueft und
# nicht lautlos zum Insert-Zweig degradiert (DT2 ist seit M19 per Id der Abend SB_PAST).
pruefe "DT2 traegt vorher eine Selbstbestaetigung (NACHGEARBEITET)" \
  "$(gleich "$($PSQL "select status from anwesenheiten where \"terminId\"='${DT2}' and \"teilnahmeId\"='${TEILNAHME_ID}';")" "NACHGEARBEITET")"
pruefe "und diese stammt von der Teilnehmerin selbst" \
  "$(gleich "$($PSQL "select \"erfasstVonId\" from anwesenheiten where \"terminId\"='${DT2}' and \"teilnahmeId\"='${TEILNAHME_ID}';")" "${TEILNEHMER_ID}")"
DZ_OW=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/dozent/anwesenheit" -H "Cookie: ${KEKS_DOZ}" -H 'Content-Type: application/json' -d "{\"terminId\":\"${DT2}\",\"eintraege\":[{\"teilnahmeId\":\"${TEILNAHME_ID}\",\"status\":\"GEFEHLT\"}]}")
pruefe "der Dozent ueberschreibt eine Selbstbestaetigung (200)" "$(gleich "$DZ_OW" "200")" "$DZ_OW"
pruefe "der Status ist danach GEFEHLT (ueberschrieben)" \
  "$(gleich "$($PSQL "select status from anwesenheiten where \"terminId\"='${DT2}' and \"teilnahmeId\"='${TEILNAHME_ID}';")" "GEFEHLT")"
pruefe "die Provenienz springt auf den Dozenten um" \
  "$(gleich "$($PSQL "select \"erfasstVonId\" from anwesenheiten where \"terminId\"='${DT2}' and \"teilnahmeId\"='${TEILNAHME_ID}';")" "${DOZENT_ID}")"

# Scope-Guard: ein FREMDER Abend (nicht ihr dozentId) wird abgewiesen (403).
DZ_FREMD=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/dozent/anwesenheit" -H "Cookie: ${KEKS_DOZ}" -H 'Content-Type: application/json' -d "{\"terminId\":\"${FREMD_TERMIN}\",\"eintraege\":[{\"teilnahmeId\":\"${TEILNAHME_ID}\",\"status\":\"ANWESEND\"}]}")
pruefe "ein fremder Abend wird abgewiesen (403, Scope-Guard)" "$(gleich "$DZ_FREMD" "403")" "$DZ_FREMD"

# Scope-Guard auch gegen den Abend eines ANDEREN Dozenten (nicht nur unassigniert).
FREMD_DOZ_TERMIN=$($PSQL "insert into unterrichtstermine (id,\"semesterId\",beginn,reihenfolge,\"dozentId\",\"erstelltAm\") values (gen_random_uuid(),'${SEMESTER_ID}',now()-interval '8 days',98,'${SCHULLEITER_ID}',now()) returning id;")
DZ_FREMD2=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/dozent/anwesenheit" -H "Cookie: ${KEKS_DOZ}" -H 'Content-Type: application/json' -d "{\"terminId\":\"${FREMD_DOZ_TERMIN}\",\"eintraege\":[{\"teilnahmeId\":\"${TEILNAHME_ID}\",\"status\":\"ANWESEND\"}]}")
pruefe "der Abend eines ANDEREN Dozenten wird abgewiesen (403)" "$(gleich "$DZ_FREMD2" "403")" "$DZ_FREMD2"

# Vergangenheits-Gate: ein EIGENER, aber kuenftiger Abend (DT_FUT) wird abgewiesen (409).
DZ_FUT=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/dozent/anwesenheit" -H "Cookie: ${KEKS_DOZ}" -H 'Content-Type: application/json' -d "{\"terminId\":\"${DT_FUT}\",\"eintraege\":[{\"teilnahmeId\":\"${TEILNAHME_ID}\",\"status\":\"ANWESEND\"}]}")
pruefe "ein eigener kuenftiger Abend wird abgewiesen (409)" "$(gleich "$DZ_FUT" "409")" "$DZ_FUT"

# ENTSCHULDIGT ist fuer den Dozenten nicht erlaubt (400) — Schulentscheidung.
DZ_ENT=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/dozent/anwesenheit" -H "Cookie: ${KEKS_DOZ}" -H 'Content-Type: application/json' -d "{\"terminId\":\"${DZ_TERMIN}\",\"eintraege\":[{\"teilnahmeId\":\"${TEILNAHME_ID}\",\"status\":\"ENTSCHULDIGT\"}]}")
pruefe "entschuldigt wird fuer den Dozenten abgewiesen (400)" "$(gleich "$DZ_ENT" "400")" "$DZ_ENT"

# Ein nicht existierender Termin ist 404 (nicht 500) — prueft das termin_fehlt-Mapping.
DZ_404=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/dozent/anwesenheit" -H "Cookie: ${KEKS_DOZ}" -H 'Content-Type: application/json' -d "{\"terminId\":\"$(uuidgen | tr 'A-Z' 'a-z')\",\"eintraege\":[{\"teilnahmeId\":\"${TEILNAHME_ID}\",\"status\":\"ANWESEND\"}]}")
pruefe "ein nicht existierender Abend ist 404" "$(gleich "$DZ_404" "404")" "$DZ_404"

# Ein Teilnehmer ohne Dozentenrecht darf die Route gar nicht nutzen (403).
DZ_TEILN=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/dozent/anwesenheit" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' -d "{\"terminId\":\"${DZ_TERMIN}\",\"eintraege\":[{\"teilnahmeId\":\"${TEILNAHME_ID}\",\"status\":\"ANWESEND\"}]}")
pruefe "ein Teilnehmer ohne Dozentenrecht darf nicht erfassen (403)" "$(gleich "$DZ_TEILN" "403")" "$DZ_TEILN"

# Ein unterrichtender Schulleiter (Dozent + Verwaltungsrecht) bleibt in der Verwaltung —
# die !PERSON_LESEN_ALLE-Klausel der Weiche haelt ihn dort.
$PSQL "insert into person_rolle (\"personId\",\"rolleCode\") values ('${SCHULLEITER_ID}','DOZENT') on conflict do nothing;" > /dev/null
SL_VERW=$(curl -s -o /dev/null -w '%{http_code}' "${BASIS}/verwaltung" -H "Cookie: ${KEKS}")
pruefe "ein unterrichtender Schulleiter bleibt in der Verwaltung (200, nicht /dozent)" "$(gleich "$SL_VERW" "200")" "$SL_VERW"

echo
echo "=== 35. Noten Stufe 1 (Erfassung durch Dozent/Schulleitung, Schueler-Sicht) ==="
# Schema: Tabelle, Unique-Index (je Teilnahme x Kurseinheit), Enum, RESTRICT.
pruefe "Tabelle leistungen existiert" \
  "$(gleich "$($PSQL "select count(*) from information_schema.tables where table_name='leistungen';")" "1")"
pruefe "Unique-Index (teilnahmeId, kurseinheitId) existiert" \
  "$(gleich "$($PSQL "select count(*) from pg_indexes where tablename='leistungen' and indexname='leistungen_teilnahmeId_kurseinheitId_key';")" "1")"
pruefe "Enum Leistungsergebnis existiert" \
  "$(gleich "$($PSQL "select count(*) from pg_type where typname='Leistungsergebnis';")" "1")"
# Seit Code-Review 4 RESTRICT statt CASCADE (Migration 20260927160500): Noten
# sind Nachweisdaten — eine geloeschte Kurseinheit nahm sonst still die Noten
# aller Jahrgaenge mit. Die Probe dazu steht in Abschnitt 47.
pruefe "FK auf kurseinheiten schuetzt die Noten (RESTRICT)" \
  "$(gleich "$($PSQL "select confdeltype from pg_constraint where conname='leistungen_kurseinheitId_fkey';")" "r")"

# Seed: die neuen Rechte sind Daten (kein Migration). Noten sind paedagogisch —
# bewusst bei Dozent/Schulleitung, NICHT bei der Verwaltung.
pruefe "Recht NOTEN_ERFASSEN_EIGENE ist geseedet" \
  "$(gleich "$($PSQL "select count(*) from rechte where code='NOTEN_ERFASSEN_EIGENE';")" "1")"
pruefe "Recht NOTEN_VERWALTEN ist geseedet" \
  "$(gleich "$($PSQL "select count(*) from rechte where code='NOTEN_VERWALTEN';")" "1")"
pruefe "DOZENT hat NOTEN_ERFASSEN_EIGENE" \
  "$(gleich "$($PSQL "select count(*) from rolle_recht where \"rolleCode\"='DOZENT' and \"rechtCode\"='NOTEN_ERFASSEN_EIGENE';")" "1")"
pruefe "SCHULLEITER hat NOTEN_VERWALTEN" \
  "$(gleich "$($PSQL "select count(*) from rolle_recht where \"rolleCode\"='SCHULLEITER' and \"rechtCode\"='NOTEN_VERWALTEN';")" "1")"
pruefe "VERWALTUNG hat NOTEN_VERWALTEN NICHT (paedagogische Entscheidung)" \
  "$(gleich "$($PSQL "select count(*) from rolle_recht where \"rolleCode\"='VERWALTUNG' and \"rechtCode\"='NOTEN_VERWALTEN';")" "0")"
pruefe "DOZENT hat NOTEN_VERWALTEN NICHT (nur das eigene Fach)" \
  "$(gleich "$($PSQL "select count(*) from rolle_recht where \"rolleCode\"='DOZENT' and \"rechtCode\"='NOTEN_VERWALTEN';")" "0")"

# Ein eigener, vergangener Abend der Dozentin MIT Kurseinheit — Grundlage der Note
# (die implizite Dozent->Fach-Zuordnung: es existiert ein eigener Abend zu Kurseinheit+Semester).
NT_TERMIN=$($PSQL "insert into unterrichtstermine (id,\"semesterId\",beginn,reihenfolge,\"dozentId\",\"kurseinheitId\",\"erstelltAm\") values (gen_random_uuid(),'${SEMESTER_ID}',now()-interval '5 days',95,'${DOZENT_ID}','${KURSEINHEIT_ID}',now()) returning id;")
# Eine Kurseinheit eines ANDEREN Dozenten (Schulleiter) im selben Semester — Scope-Guard.
FREMD_KURS=$($PSQL "select id from kurseinheiten where id <> '${KURSEINHEIT_ID}' order by sortierung limit 1;")
$PSQL "insert into unterrichtstermine (id,\"semesterId\",beginn,reihenfolge,\"dozentId\",\"kurseinheitId\",\"erstelltAm\") values (gen_random_uuid(),'${SEMESTER_ID}',now()-interval '4 days',94,'${SCHULLEITER_ID}','${FREMD_KURS}',now());" > /dev/null
# Eine Kurseinheit OHNE Abend in diesem Semester — fuer kontext_fehlt.
KONTEXT_KURS=$($PSQL "select id from kurseinheiten where id not in ('${KURSEINHEIT_ID}','${FREMD_KURS}') order by sortierung limit 1;")

# Die Dozentin benotet ihre eigene Kurseinheit (200) — mit Ergebnis, Punkten und Note.
NT_OK=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/dozent/note" -H "Cookie: ${KEKS_DOZ}" -H 'Content-Type: application/json' -d "{\"kurseinheitId\":\"${KURSEINHEIT_ID}\",\"semesterId\":\"${SEMESTER_ID}\",\"eintraege\":[{\"teilnahmeId\":\"${TEILNAHME_ID}\",\"ergebnis\":\"BESTANDEN\",\"punkte\":87,\"note\":\"1,7\"}]}")
pruefe "die Dozentin benotet ihre eigene Kurseinheit (200)" "$(gleich "$NT_OK" "200")" "$NT_OK"
pruefe "das Ergebnis ist gespeichert (BESTANDEN)" \
  "$(gleich "$($PSQL "select ergebnis from leistungen where \"teilnahmeId\"='${TEILNAHME_ID}' and \"kurseinheitId\"='${KURSEINHEIT_ID}';")" "BESTANDEN")"
pruefe "die optionalen Punkte sind gespeichert (87)" \
  "$(gleich "$($PSQL "select punkte from leistungen where \"teilnahmeId\"='${TEILNAHME_ID}' and \"kurseinheitId\"='${KURSEINHEIT_ID}';")" "87")"
pruefe "die optionale Note ist gespeichert (1,7)" \
  "$(gleich "$($PSQL "select note from leistungen where \"teilnahmeId\"='${TEILNAHME_ID}' and \"kurseinheitId\"='${KURSEINHEIT_ID}';")" "1,7")"
pruefe "der Eintrag traegt die Dozentin als Erfasser (Provenienz)" \
  "$(gleich "$($PSQL "select \"erfasstVonId\" from leistungen where \"teilnahmeId\"='${TEILNAHME_ID}' and \"kurseinheitId\"='${KURSEINHEIT_ID}';")" "${DOZENT_ID}")"
pruefe "ein Audit-Eintrag LEISTUNG_ERFASST entsteht (auf die Kurseinheit bezogen)" \
  "$(gleich "$($PSQL "select (count(*) > 0) from audit_log where aktion='LEISTUNG_ERFASST' and \"objektId\"='${KURSEINHEIT_ID}';")" "t")"

# Scope-Guard: die Kurseinheit eines ANDEREN Dozenten wird der Dozentin abgewiesen (403).
NT_FREMD=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/dozent/note" -H "Cookie: ${KEKS_DOZ}" -H 'Content-Type: application/json' -d "{\"kurseinheitId\":\"${FREMD_KURS}\",\"semesterId\":\"${SEMESTER_ID}\",\"eintraege\":[{\"teilnahmeId\":\"${TEILNAHME_ID}\",\"ergebnis\":\"BESTANDEN\"}]}")
pruefe "ein fremdes Fach wird der Dozentin abgewiesen (403, Scope-Guard)" "$(gleich "$NT_FREMD" "403")" "$NT_FREMD"

# Strukturpruefung (Zod): ungueltiges Ergebnis und Punkte ausserhalb der Grenze sind 400.
NT_BADERG=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/dozent/note" -H "Cookie: ${KEKS_DOZ}" -H 'Content-Type: application/json' -d "{\"kurseinheitId\":\"${KURSEINHEIT_ID}\",\"semesterId\":\"${SEMESTER_ID}\",\"eintraege\":[{\"teilnahmeId\":\"${TEILNAHME_ID}\",\"ergebnis\":\"TANZEN\"}]}")
pruefe "ein ungueltiges Ergebnis wird abgewiesen (400)" "$(gleich "$NT_BADERG" "400")" "$NT_BADERG"
NT_BADPKT=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/dozent/note" -H "Cookie: ${KEKS_DOZ}" -H 'Content-Type: application/json' -d "{\"kurseinheitId\":\"${KURSEINHEIT_ID}\",\"semesterId\":\"${SEMESTER_ID}\",\"eintraege\":[{\"teilnahmeId\":\"${TEILNAHME_ID}\",\"ergebnis\":\"BESTANDEN\",\"punkte\":200}]}")
pruefe "Punkte ausserhalb der Grenze werden abgewiesen (400)" "$(gleich "$NT_BADPKT" "400")" "$NT_BADPKT"
# Eine Bewertung laesst sich nicht leeren (M18) — auch nicht ueber die API. Die
# gesperrte Leeroption in der Oberflaeche ist nur das Gegenstueck dazu.
NT_LEER=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/noten" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"kurseinheitId\":\"${KURSEINHEIT_ID}\",\"semesterId\":\"${SEMESTER_ID}\",\"eintraege\":[{\"teilnahmeId\":\"${TEILNAHME_ID}\",\"ergebnis\":\"\"}]}")
pruefe "ein leeres Ergebnis wird abgewiesen (400)" "$(gleich "$NT_LEER" "400")" "$NT_LEER"

# Ein Teilnehmer ohne Notenrecht darf die Dozentenroute nicht nutzen (403).
NT_TEILN=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/dozent/note" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' -d "{\"kurseinheitId\":\"${KURSEINHEIT_ID}\",\"semesterId\":\"${SEMESTER_ID}\",\"eintraege\":[{\"teilnahmeId\":\"${TEILNAHME_ID}\",\"ergebnis\":\"BESTANDEN\"}]}")
pruefe "ein Teilnehmer darf die Dozenten-Notenroute nicht nutzen (403)" "$(gleich "$NT_TEILN" "403")" "$NT_TEILN"

# Die Schulleitung benotet dieselbe Kurseinheit (200) und ueberschreibt — Provenienz springt um.
SL_NOTE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/noten" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"kurseinheitId\":\"${KURSEINHEIT_ID}\",\"semesterId\":\"${SEMESTER_ID}\",\"eintraege\":[{\"teilnahmeId\":\"${TEILNAHME_ID}\",\"ergebnis\":\"ERFOLGREICH_TEILGENOMMEN\"}]}")
pruefe "die Schulleitung benotet die Kurseinheit (200)" "$(gleich "$SL_NOTE" "200")" "$SL_NOTE"
pruefe "das Ergebnis ist ueberschrieben (ERFOLGREICH_TEILGENOMMEN)" \
  "$(gleich "$($PSQL "select ergebnis from leistungen where \"teilnahmeId\"='${TEILNAHME_ID}' and \"kurseinheitId\"='${KURSEINHEIT_ID}';")" "ERFOLGREICH_TEILGENOMMEN")"
pruefe "die Provenienz springt auf die Schulleitung um" \
  "$(gleich "$($PSQL "select \"erfasstVonId\" from leistungen where \"teilnahmeId\"='${TEILNAHME_ID}' and \"kurseinheitId\"='${KURSEINHEIT_ID}';")" "${SCHULLEITER_ID}")"
# Das Ueberschreiben ohne Punkte/Note leert diese Felder (voller Upsert, kein Teil-Update).
pruefe "beim Ueberschreiben ohne Punkte werden die Punkte geleert (NULL)" \
  "$(gleich "$($PSQL "select count(*) from leistungen where \"teilnahmeId\"='${TEILNAHME_ID}' and \"kurseinheitId\"='${KURSEINHEIT_ID}' and punkte is null;")" "1")"
pruefe "beim Ueberschreiben ohne Note wird die Note geleert (NULL)" \
  "$(gleich "$($PSQL "select count(*) from leistungen where \"teilnahmeId\"='${TEILNAHME_ID}' and \"kurseinheitId\"='${KURSEINHEIT_ID}' and note is null;")" "1")"

# Schulleitung: eine Kurseinheit ohne Abend in diesem Semester ist kontext_fehlt (404).
SL_KTX=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/noten" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"kurseinheitId\":\"${KONTEXT_KURS}\",\"semesterId\":\"${SEMESTER_ID}\",\"eintraege\":[{\"teilnahmeId\":\"${TEILNAHME_ID}\",\"ergebnis\":\"BESTANDEN\"}]}")
pruefe "eine Kurseinheit ohne Abend im Semester ist 404 (kontext_fehlt)" "$(gleich "$SL_KTX" "404")" "$SL_KTX"

# Ein Teilnehmer darf die Schulleitungs-Notenroute nicht nutzen (403).
NT_VERW=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/noten" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' -d "{\"kurseinheitId\":\"${KURSEINHEIT_ID}\",\"semesterId\":\"${SEMESTER_ID}\",\"eintraege\":[{\"teilnahmeId\":\"${TEILNAHME_ID}\",\"ergebnis\":\"BESTANDEN\"}]}")
pruefe "ein Teilnehmer darf die Schulleitungs-Notenroute nicht nutzen (403)" "$(gleich "$NT_VERW" "403")" "$NT_VERW"

# Hoerer werden nicht benotet (Bauregel: Hoerer fallen aus jeder Pruefungs-
# automatik, sie bekommen eine Teilnahmebescheinigung). Hans ist Hoerer in 2099-H.
HOERER_TEILNAHME=$($PSQL "select id from teilnahmen where \"personId\"='${HOERER_ID}' and \"semesterId\"='${SEMESTER_ID}';")
NT_HOERER=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/noten" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"kurseinheitId\":\"${KURSEINHEIT_ID}\",\"semesterId\":\"${SEMESTER_ID}\",\"eintraege\":[{\"teilnahmeId\":\"${HOERER_TEILNAHME}\",\"ergebnis\":\"TEILGENOMMEN\"}]}")
pruefe "ein Hoerer laesst sich nicht benoten (400), es entsteht keine Leistung" \
  "$([ "$NT_HOERER" = "400" ] && [ "$($PSQL "select count(*) from leistungen where \"teilnahmeId\"='${HOERER_TEILNAHME}';")" = "0" ] && echo 1 || echo 0)" "$NT_HOERER"
# Alles oder nichts: Ein Hoerer im Stapel lehnt die ganze Erfassung ab — auch
# Petras Eintrag wird nicht geschrieben.
NT_GEMISCHT=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/noten" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"kurseinheitId\":\"${KURSEINHEIT_ID}\",\"semesterId\":\"${SEMESTER_ID}\",\"eintraege\":[{\"teilnahmeId\":\"${TEILNAHME_ID}\",\"ergebnis\":\"BESTANDEN\"},{\"teilnahmeId\":\"${HOERER_TEILNAHME}\",\"ergebnis\":\"TEILGENOMMEN\"}]}")
pruefe "ein Stapel mit Hoerer wird ganz abgewiesen (400, Petras Ergebnis unveraendert)" \
  "$([ "$NT_GEMISCHT" = "400" ] && [ "$($PSQL "select ergebnis from leistungen where \"teilnahmeId\"='${TEILNAHME_ID}' and \"kurseinheitId\"='${KURSEINHEIT_ID}';")" = "ERFOLGREICH_TEILGENOMMEN" ] && echo 1 || echo 0)" "$NT_GEMISCHT"
NOTEN_SEITE=$(curl -s "${BASIS}/verwaltung/noten" -H "Cookie: ${KEKS}")
pruefe "die Notenseite fuehrt Schueler, aber keine Hoerer (Beispiel, Petra / nicht Hoerer, Hans)" \
  "$([ "$(enthaelt "$NOTEN_SEITE" 'Beispiel, Petra')" = "1" ] && [ "$(fehlt_in "$NOTEN_SEITE" 'Hoerer, Hans')" = "1" ] && echo 1 || echo 0)"

# Schueler-Selbstansicht: die eigene Note erscheint in /meine-daten (Klartext).
TN_NOTEN=$(curl -s "${BASIS}/meine-daten" -H "Cookie: ${KEKS2}")
pruefe "der Schueler sieht den Abschnitt Meine Noten" "$(enthaelt "$TN_NOTEN" 'Meine Noten')"
pruefe "der Schueler sieht sein Ergebnis im Klartext (erfolgreich teilgenommen)" "$(enthaelt "$TN_NOTEN" 'erfolgreich teilgenommen')"

# Schulleitungs-Notenseite rendert die Kurseinheit-Matrix (nicht nur die Ueberschrift).
SL_SEITE=$(curl -s "${BASIS}/verwaltung/noten" -H "Cookie: ${KEKS}")
pruefe "die Notenseite der Schulleitung bietet die Erfassung je Kurseinheit an" "$(enthaelt "$SL_SEITE" 'Noten eintragen')"

# Die Dozentenseite zeigt den Noten-Abschnitt.
DZ_NOTEN=$(curl -s "${BASIS}/dozent" -H "Cookie: ${KEKS_DOZ}")
pruefe "die Dozentenseite zeigt den Abschnitt Meine Noten" "$(enthaelt "$DZ_NOTEN" 'Meine Noten')"

# Whitelist (bewusst am Ende, da TEILNAHME_ID neu geschrieben wird): ein Batch mit
# einem gueltigen + einem SEMESTERFREMDEN Eintrag schreibt nur den gueltigen. Dazu
# eine Teilnahme derselben Person in einem zweiten Semester.
SEM2=$($PSQL "insert into semester (id,code,bezeichnung,start,ende,\"erstelltAm\") values (gen_random_uuid(),'2099-X','Testsemester 2099','2099-01-01','2099-06-30',now()) returning id;")
FREMD_TEILNAHME=$($PSQL "insert into teilnahmen (id,\"personId\",\"semesterId\",teilnahmeform,\"erstelltAm\") values (gen_random_uuid(),'${TEILNEHMER_ID}','${SEM2}','SCHUELER',now()) returning id;")
WL=$(curl -s -X POST "${BASIS}/api/dozent/note" -H "Cookie: ${KEKS_DOZ}" -H 'Content-Type: application/json' -d "{\"kurseinheitId\":\"${KURSEINHEIT_ID}\",\"semesterId\":\"${SEMESTER_ID}\",\"eintraege\":[{\"teilnahmeId\":\"${TEILNAHME_ID}\",\"ergebnis\":\"BESTANDEN\"},{\"teilnahmeId\":\"${FREMD_TEILNAHME}\",\"ergebnis\":\"BESTANDEN\"}]}")
pruefe "Batch mit gueltigem + semesterfremdem Eintrag: nur der gueltige zaehlt (gesetzt=1)" "$(enthaelt "$WL" '"gesetzt":1')"
pruefe "die semesterfremde Teilnahme bekommt KEINE Note (Whitelist greift)" \
  "$(gleich "$($PSQL "select count(*) from leistungen where \"teilnahmeId\"='${FREMD_TEILNAHME}';")" "0")"
# Der Scope-Guard haengt an Kurseinheit UND Semester: Die Dozentin unterrichtet
# KURSEINHEIT_ID in 2099-H, im zweiten Semester aber keinen Abend. Alle Aufrufe
# oben nutzten SEMESTER_ID — ohne diese Zeile fiele ein Guard ohne Semester nicht auf.
NT_SEM2=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/dozent/note" -H "Cookie: ${KEKS_DOZ}" -H 'Content-Type: application/json' -d "{\"kurseinheitId\":\"${KURSEINHEIT_ID}\",\"semesterId\":\"${SEM2}\",\"eintraege\":[{\"teilnahmeId\":\"${FREMD_TEILNAHME}\",\"ergebnis\":\"BESTANDEN\"}]}")
pruefe "dieselbe Kurseinheit in einem Semester ohne eigenen Abend: 403, keine Note" \
  "$([ "$NT_SEM2" = "403" ] && [ "$($PSQL "select count(*) from leistungen where \"teilnahmeId\"='${FREMD_TEILNAHME}';")" = "0" ] && echo 1 || echo 0)" "$NT_SEM2"

echo
echo "=== 36. Zeugnisse & Bescheinigungen (Stufe 2: ausstellen, einfrieren, Storno, Seriendruck) ==="
# Schema: Tabelle, Enums, partieller Unique-Index (ein gueltiges je Person/Semester/Typ), FK.
pruefe "Tabelle zeugnisse existiert" \
  "$(gleich "$($PSQL "select count(*) from information_schema.tables where table_name='zeugnisse';")" "1")"
pruefe "Enum Zeugnistyp existiert" \
  "$(gleich "$($PSQL "select count(*) from pg_type where typname='Zeugnistyp';")" "1")"
pruefe "partieller Unique-Index zeugnis_ein_gueltiges existiert" \
  "$(gleich "$($PSQL "select count(*) from pg_indexes where tablename='zeugnisse' and indexname='zeugnis_ein_gueltiges';")" "1")"
pruefe "FK auf semester ist RESTRICT" \
  "$(gleich "$($PSQL "select confdeltype from pg_constraint where conname='zeugnisse_semesterId_fkey';")" "r")"

# Rechte: Zeugnisse laufen ueber NOTEN_VERWALTEN (kein neues Recht). Seite + Route-Gate.
ZS_SEITE=$(curl -s "${BASIS}/verwaltung/zeugnisse" -H "Cookie: ${KEKS}")
pruefe "die Zeugnisseite der Schulleitung rendert" "$(enthaelt "$ZS_SEITE" 'Zeugnisse')"
ZS_TEILN=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/zeugnisse/ausstellen" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${SEMESTER_ID}\",\"typ\":\"SEMESTER\"}")
pruefe "ein Teilnehmer darf keine Zeugnisse ausstellen (403)" "$(gleich "$ZS_TEILN" "403")" "$ZS_TEILN"

# Ausgangslage sicherstellen: die Teilnahme ist SCHUELER (bekommt ein Zeugnis, keine Bescheinigung).
# Der Schueler hat aus Abschnitt 35 eine BESTANDEN-Note in KURSEINHEIT_ID.
$PSQL "update teilnahmen set teilnahmeform='SCHUELER' where id='${TEILNAHME_ID}';" > /dev/null

# Einzel-Ausstellung (200) + eingefrorener Snapshot.
ZAUS=$(curl -s -X POST "${BASIS}/api/zeugnisse/ausstellen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${SEMESTER_ID}\",\"typ\":\"SEMESTER\",\"personId\":\"${TEILNEHMER_ID}\"}")
pruefe "die Schulleitung stellt ein Semester-Zeugnis aus (Beleg-Nr ZEU-)" "$(enthaelt "$ZAUS" '"belegNr":"ZEU-')"
Z1=$($PSQL "select id from zeugnisse where \"personId\"='${TEILNEHMER_ID}' and typ='SEMESTER' and status='GUELTIG';")
Z1_BELEG=$($PSQL "select \"belegNr\" from zeugnisse where id='${Z1}';")
pruefe "das Zeugnis ist gueltig und Ausfertigung 1" \
  "$(gleich "$($PSQL "select version from zeugnisse where id='${Z1}' and status='GUELTIG';")" "1")"
pruefe "der Snapshot friert das Ergebnis als Klartext ein (bestanden)" \
  "$(gleich "$($PSQL "select snapshot->'leistungen'->0->>'ergebnisText' from zeugnisse where id='${Z1}';")" "bestanden")"

# Immutabilitaet: die Note nachtraeglich aendern — der Snapshot bleibt unveraendert.
curl -s -o /dev/null -X POST "${BASIS}/api/noten" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"kurseinheitId\":\"${KURSEINHEIT_ID}\",\"semesterId\":\"${SEMESTER_ID}\",\"eintraege\":[{\"teilnahmeId\":\"${TEILNAHME_ID}\",\"ergebnis\":\"NICHT_BESTANDEN\"}]}"
pruefe "nach der Notenaenderung bleibt der ausgestellte Snapshot bestanden (eingefroren)" \
  "$(gleich "$($PSQL "select snapshot->'leistungen'->0->>'ergebnisText' from zeugnisse where id='${Z1}';")" "bestanden")"

# Korrektur = Neuausstellung mit Storno.
ZNEU=$(curl -s -X POST "${BASIS}/api/zeugnisse/ausstellen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${SEMESTER_ID}\",\"typ\":\"SEMESTER\",\"personId\":\"${TEILNEHMER_ID}\"}")
pruefe "die Neuausstellung liefert Ausfertigung 2" "$(enthaelt "$ZNEU" '"version":2')"
pruefe "das alte Zeugnis ist jetzt ERSETZT" \
  "$(gleich "$($PSQL "select status from zeugnisse where id='${Z1}';")" "ERSETZT")"
pruefe "es gibt genau EIN gueltiges Zeugnis (Person/Semester/Typ)" \
  "$(gleich "$($PSQL "select count(*) from zeugnisse where \"personId\"='${TEILNEHMER_ID}' and \"semesterId\"='${SEMESTER_ID}' and typ='SEMESTER' and status='GUELTIG';")" "1")"
Z2=$($PSQL "select id from zeugnisse where \"personId\"='${TEILNEHMER_ID}' and typ='SEMESTER' and status='GUELTIG';")
pruefe "die neue Ausfertigung friert den KORRIGIERTEN Stand ein (nicht bestanden)" \
  "$(gleich "$($PSQL "select snapshot->'leistungen'->0->>'ergebnisText' from zeugnisse where id='${Z2}';")" "nicht bestanden")"
pruefe "die neue Ausfertigung traegt den Storno-Vermerk (ersetzt alte Beleg-Nr)" \
  "$(gleich "$($PSQL "select snapshot->>'ersetztBelegNr' from zeugnisse where id='${Z2}';")" "${Z1_BELEG}")"
pruefe "ein Audit-Eintrag ZEUGNIS_AUSGESTELLT entsteht (auf das Zeugnis bezogen)" \
  "$(gleich "$($PSQL "select (count(*) > 0) from audit_log where aktion='ZEUGNIS_AUSGESTELLT' and \"objektId\"='${Z2}';")" "t")"

# Hoerer bekommt eine Bescheinigung (kein Zeugnis) — ueber den Sammellauf.
ZH_PID=$($PSQL "insert into personen (id,vorname,nachname,email,\"statusCode\",teilnahmeform,\"erstelltAm\",\"aktualisiertAm\") values (gen_random_uuid(),'Hanna','Hoerer','hoerer-zeugnis@example.org','AKTIV','HOERER',now(),now()) returning id;")
$PSQL "insert into teilnahmen (id,\"personId\",\"semesterId\",teilnahmeform,\"erstelltAm\") values (gen_random_uuid(),'${ZH_PID}','${SEMESTER_ID}','HOERER',now());" > /dev/null
# Seit dem Semesterbetrieb (27.09.2026) gibt es die Bescheinigung nur mit einem
# besuchten Abend, und sie nennt nur die besuchten Faecher: Hanna war am Abend
# der Dozentin (NT_TERMIN, Kurseinheit KURSEINHEIT_ID) anwesend.
$PSQL "insert into anwesenheiten (id,\"terminId\",\"teilnahmeId\",status,\"erfasstAm\") select gen_random_uuid(),'${NT_TERMIN}',id,'ANWESEND',now() from teilnahmen where \"personId\"='${ZH_PID}' and \"semesterId\"='${SEMESTER_ID}';" > /dev/null
# Die Rueckfrage vor „Alle ausstellen" nennt serverseitig ermittelte Zahlen
# (ladeSammelVorschau: neue Bescheinigungen der Hoerer, schon vorhandene
# Zeugnisse). Sie steht als Client-Prop sammellauf.rueckfrage im HTML (RSC).
ZS_VORSCHAU=$(curl -s "${BASIS}/verwaltung/zeugnisse?semester=${SEMESTER_ID}&typ=SEMESTER" -H "Cookie: ${KEKS}")
pruefe "die Rueckfrage vor „Alle ausstellen“ nennt Semester und die serverseitig gezaehlten Dokumente" \
  "$([ "$(enthaelt "$ZS_VORSCHAU" 'für Testsemester 2099 ausstellen?')" = "1" ] && [ "$(enthaelt "$ZS_VORSCHAU" 'Teilnahmebescheinigung[en]* (Hörer)')" = "1" ] && [ "$(enthaelt "$ZS_VORSCHAU" 'schon ein gültiges Dokument')" = "1" ] && echo 1 || echo 0)"
ZBATCH=$(rumpf_und_status -X POST "${BASIS}/api/zeugnisse/ausstellen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${SEMESTER_ID}\",\"typ\":\"SEMESTER\"}")
ZBATCH_RUMPF=$(cat /tmp/gbs-rumpf.txt)
pruefe "der Sammellauf laeuft durch (200)" "$(gleich "$ZBATCH" "200")" "$ZBATCH"
# Nur ein Lauf, der wirklich ausstellt, beweist „keine Snapshots": Beim zweiten,
# idempotenten Lauf stuende selbst mit Snapshots in der Antwort nur "neu":[] da.
# Die Snapshots (Name, Geburtsdatum) braucht nur die Archivkopie nach der Antwort.
pruefe "die Antwort eines ausstellenden Sammellaufs enthaelt nur Zahlen, keine Snapshots" \
  "$([ "$(fehlt_in "$ZBATCH_RUMPF" 'snapshot')" = "1" ] && [ "$(fehlt_in "$ZBATCH_RUMPF" 'Hoerer')" = "1" ] && echo "$ZBATCH_RUMPF" | grep -qE '"ausgestellt":[1-9]' && echo 1 || echo 0)" "$ZBATCH_RUMPF"
pruefe "der Hoerer bekommt eine BESCHEINIGUNG (kein Zeugnis)" \
  "$(gleich "$($PSQL "select typ from zeugnisse where \"personId\"='${ZH_PID}' and status='GUELTIG';")" "BESCHEINIGUNG")"
pruefe "die Bescheinigung traegt das Praefix BESCH-" \
  "$(enthaelt "$($PSQL "select \"belegNr\" from zeugnisse where \"personId\"='${ZH_PID}' and status='GUELTIG';")" 'BESCH-')"

# Seriendruck: EIN PDF ueber alle gueltigen (Schueler-Zeugnis + Hoerer-Bescheinigung),
# je Person auf eigenem Blatt (Seitenumbruch wirkt).
ZSCODE=$(curl -s -o /tmp/gbs-serien.pdf -w '%{http_code}' "${BASIS}/api/zeugnisse/seriendruck?semester=${SEMESTER_ID}&typ=SEMESTER" -H "Cookie: ${KEKS}")
pruefe "der Seriendruck liefert ein PDF (200)" "$(gleich "$ZSCODE" "200")" "$ZSCODE"
pruefe "die Datei ist ein PDF" "$([ "$(head -c4 /tmp/gbs-serien.pdf)" = "%PDF" ] && echo 1 || echo 0)"
pruefe "der Seriendruck hat mindestens 2 Seiten (Seitenumbruch je Person)" \
  "$([ "$(grep -ao '/Type /Page ' /tmp/gbs-serien.pdf | wc -l | tr -d ' ')" -ge 2 ] && echo 1 || echo 0)" \
  "$(grep -ao '/Type /Page ' /tmp/gbs-serien.pdf | wc -l | tr -d ' ')"

# Einzeldownload: der Schueler laedt sein eigenes (200), ein Fremder nicht (403), die Schulleitung jedes (200).
ZDL_OWN=$(curl -s -o /tmp/gbs-z.pdf -w '%{http_code}' "${BASIS}/api/zeugnisse/${Z2}/pdf" -H "Cookie: ${KEKS2}")
pruefe "der Schueler laedt sein eigenes Zeugnis (200)" "$(gleich "$ZDL_OWN" "200")" "$ZDL_OWN"
pruefe "und es ist ein PDF" "$([ "$(head -c4 /tmp/gbs-z.pdf)" = "%PDF" ] && echo 1 || echo 0)"
ZDL_FREMD=$(curl -s -o /dev/null -w '%{http_code}' "${BASIS}/api/zeugnisse/${Z2}/pdf" -H "Cookie: ${KEKS_DOZ}")
pruefe "ein Fremder ohne Notenrecht darf ein fremdes Zeugnis nicht laden (403)" "$(gleich "$ZDL_FREMD" "403")" "$ZDL_FREMD"
ZDL_SL=$(curl -s -o /dev/null -w '%{http_code}' "${BASIS}/api/zeugnisse/${Z2}/pdf" -H "Cookie: ${KEKS}")
pruefe "die Schulleitung darf jedes Zeugnis drucken (200)" "$(gleich "$ZDL_SL" "200")" "$ZDL_SL"
# Ein ERSETZTES Zeugnis ist kein gueltiges Dokument mehr: Der Schueler kennt die
# alte Id noch und bekaeme sonst ein gueltig aussehendes PDF (410). Die
# Schulleitung bekommt es als Nachweis — mit Vermerk auf die neue Beleg-Nr.
ZDL_ALT=$(curl -s -o /dev/null -w '%{http_code}' "${BASIS}/api/zeugnisse/${Z1}/pdf" -H "Cookie: ${KEKS2}")
pruefe "ein ersetztes Zeugnis laedt der Schueler nicht mehr (410)" "$(gleich "$ZDL_ALT" "410")" "$ZDL_ALT"
ZDL_ALT_SL=$(curl -s -D /tmp/gbs-kopf-z-alt.txt -o /tmp/gbs-z-alt.pdf -w '%{http_code}' "${BASIS}/api/zeugnisse/${Z1}/pdf" -H "Cookie: ${KEKS}")
pruefe "die Schulleitung laedt das ersetzte Zeugnis als UNGUELTIG gekennzeichnete Datei (200)" \
  "$([ "$ZDL_ALT_SL" = "200" ] && grep -qi "filename=\"${Z1_BELEG}-UNGUELTIG.pdf\"" /tmp/gbs-kopf-z-alt.txt && echo 1 || echo 0)" "$ZDL_ALT_SL"
Z2_BELEG=$($PSQL "select \"belegNr\" from zeugnisse where id='${Z2}';")
pruefe "und das PDF traegt den Vermerk mit der neuen Beleg-Nr" \
  "$([ -n "$Z2_BELEG" ] && grep -aq "ersetzt durch Beleg ${Z2_BELEG}" /tmp/gbs-z-alt.pdf && echo 1 || echo 0)"

# Schueler-Selbstansicht.
ZTN=$(curl -s "${BASIS}/meine-daten" -H "Cookie: ${KEKS2}")
pruefe "der Schueler sieht den Abschnitt Meine Zeugnisse" "$(enthaelt "$ZTN" 'Meine Zeugnisse')"

# --- Abschlusszeugnis: aggregiert die Leistungen ALLER Semester der Person. ---
# FREMD_TEILNAHME (SEM2, aus Abschnitt 35) eine zweite Leistung geben, damit die
# Aggregation ueber zwei Semester nachweisbar ist.
$PSQL "insert into leistungen (id,\"teilnahmeId\",\"kurseinheitId\",ergebnis,\"erfasstAm\") values (gen_random_uuid(),'${FREMD_TEILNAHME}','${KONTEXT_KURS}','BESTANDEN',now());" > /dev/null
ZA1=$(curl -s -X POST "${BASIS}/api/zeugnisse/ausstellen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${SEMESTER_ID}\",\"typ\":\"ABSCHLUSS\",\"personId\":\"${TEILNEHMER_ID}\"}")
pruefe "die Schulleitung stellt ein Abschlusszeugnis aus (Beleg-Nr ZEU-)" "$(enthaelt "$ZA1" '"belegNr":"ZEU-')"
ZA1_ID=$($PSQL "select id from zeugnisse where \"personId\"='${TEILNEHMER_ID}' and typ='ABSCHLUSS' and status='GUELTIG';")
ZA1_BELEG=$($PSQL "select \"belegNr\" from zeugnisse where id='${ZA1_ID}';")
pruefe "das Abschlusszeugnis traegt den Abschnitt 'Gesamte Ausbildung'" \
  "$(gleich "$($PSQL "select snapshot->>'abschnitt' from zeugnisse where id='${ZA1_ID}';")" "Gesamte Ausbildung")"
pruefe "der Snapshot aggregiert die Leistungen BEIDER Semester (2)" \
  "$(gleich "$($PSQL "select jsonb_array_length(snapshot->'leistungen') from zeugnisse where id='${ZA1_ID}';")" "2")"
pruefe "der Titel ist 'Abschlusszeugnis'" \
  "$(gleich "$($PSQL "select snapshot->>'titel' from zeugnisse where id='${ZA1_ID}';")" "Abschlusszeugnis")"

# Kritisch: ein zweiter Abschluss-Lauf in einem ANDEREN Semester legt KEIN zweites
# gueltiges Abschlusszeugnis an — er storniert das erste (je Person eindeutig).
curl -s -o /dev/null -X POST "${BASIS}/api/zeugnisse/ausstellen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${SEM2}\",\"typ\":\"ABSCHLUSS\",\"personId\":\"${TEILNEHMER_ID}\"}"
pruefe "genau EIN gueltiges Abschlusszeugnis je Person (semesterunabhaengig)" \
  "$(gleich "$($PSQL "select count(*) from zeugnisse where \"personId\"='${TEILNEHMER_ID}' and typ='ABSCHLUSS' and status='GUELTIG';")" "1")"
ZA2_ID=$($PSQL "select id from zeugnisse where \"personId\"='${TEILNEHMER_ID}' and typ='ABSCHLUSS' and status='GUELTIG';")
pruefe "das neue Abschlusszeugnis ist Ausfertigung 2" \
  "$(gleich "$($PSQL "select version from zeugnisse where id='${ZA2_ID}';")" "2")"
pruefe "und es storniert das erste (ersetztBelegNr = alte Beleg-Nr)" \
  "$(gleich "$($PSQL "select snapshot->>'ersetztBelegNr' from zeugnisse where id='${ZA2_ID}';")" "${ZA1_BELEG}")"

# --- Batch-Idempotenz: der zweite Sammellauf stellt nichts neu aus, storniert nichts. ---
ZBATCH2=$(curl -s -X POST "${BASIS}/api/zeugnisse/ausstellen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${SEMESTER_ID}\",\"typ\":\"SEMESTER\"}")
pruefe "der zweite Sammellauf stellt nichts neu aus (idempotent)" "$(enthaelt "$ZBATCH2" '"ausgestellt":0')"
# „Vorhanden" und „fehlgeschlagen" getrennt — ein Fehlschlag darf nie als
# „bereits vorhanden" erscheinen; das alte Sammelfeld gibt es nicht mehr.
pruefe "der Sammellauf zaehlt vorhanden und fehlgeschlagen getrennt (0 fehlgeschlagen)" \
  "$([ "$(enthaelt "$ZBATCH2" '"vorhanden":')" = "1" ] && [ "$(enthaelt "$ZBATCH2" '"fehlgeschlagen":0')" = "1" ] && [ "$(fehlt_in "$ZBATCH2" '"uebersprungen"')" = "1" ] && echo 1 || echo 0)" "$ZBATCH2"
# Die Snapshots (Name, Geburtsdatum) braucht nur die Archivkopie nach der Antwort.
pruefe "die Antwort des Sammellaufs enthaelt keine Snapshots" "$(fehlt_in "$ZBATCH2" 'snapshot')" "$ZBATCH2"
pruefe "der Hoerer wird nicht neu ausgestellt (Bescheinigung bleibt Ausfertigung 1)" \
  "$(gleich "$($PSQL "select version from zeugnisse where \"personId\"='${ZH_PID}' and typ='BESCHEINIGUNG' and status='GUELTIG';")" "1")"

# --- Hoerer-Bescheinigung inhaltlich: Faecher als 'teilgenommen', ohne Bewertung. ---
pruefe "die Bescheinigung friert die Faecher als 'teilgenommen' ein" \
  "$(gleich "$($PSQL "select snapshot->'leistungen'->0->>'ergebnisText' from zeugnisse where \"personId\"='${ZH_PID}' and status='GUELTIG';")" "teilgenommen")"
pruefe "die Bescheinigung traegt keine Punkte (Hoerer, ohne Pruefung)" \
  "$(gleich "$($PSQL "select ((snapshot->'leistungen'->0->>'punkte') is null) from zeugnisse where \"personId\"='${ZH_PID}' and status='GUELTIG';")" "t")"
# Frueher standen alle im Semester unterrichteten Faecher darauf (hier mindestens
# KURSEINHEIT_ID und FREMD_KURS), jetzt nur die mit besuchtem Abend.
pruefe "die Bescheinigung nennt nur das besuchte Fach, nicht alle unterrichteten" \
  "$(gleich "$($PSQL "select jsonb_array_length(z.snapshot->'leistungen') = 1 and z.snapshot->'leistungen'->0->>'titel' = (select titel from kurseinheiten where id='${KURSEINHEIT_ID}') and (select count(distinct \"kurseinheitId\") from unterrichtstermine where \"semesterId\"='${SEMESTER_ID}') >= 2 from zeugnisse z where z.\"personId\"='${ZH_PID}' and z.status='GUELTIG';")" "t")"

# --- Abschluss-Sammellauf nur im letzten Semester des Rasters (Code-Review 4) ---
# Sonst bekaeme mit einem Klick jeder Aktive — auch ein Erstsemester — ein
# Abschlusszeugnis. Die Einzel-Ausstellung (ZA1 oben) bleibt davon frei.
ABSCHLUSS_VORHER=$($PSQL "select count(*) from zeugnisse where typ='ABSCHLUSS';")
ZA_SAMMEL=$(rumpf_und_status -X POST "${BASIS}/api/zeugnisse/ausstellen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${SEMESTER_ID}\",\"typ\":\"ABSCHLUSS\"}")
pruefe "Abschluss-Sammellauf in einem Semester ohne Rasterplatz: 400 mit dem Weg zur Zuordnung" \
  "$([ "$ZA_SAMMEL" = "400" ] && grep -q 'keinem Lehrjahr und Halbjahr' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$ZA_SAMMEL $(cat /tmp/gbs-rumpf.txt)"
ZA_SAMMEL_ZIEL=$(rumpf_und_status -X POST "${BASIS}/api/zeugnisse/ausstellen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${TARGET_ID}\",\"typ\":\"ABSCHLUSS\"}")
pruefe "im 1. Lehrjahr: 400 („nur im letzten Semester der Ausbildung“)" \
  "$([ "$ZA_SAMMEL_ZIEL" = "400" ] && grep -q 'nur im letzten Semester der Ausbildung' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$ZA_SAMMEL_ZIEL $(cat /tmp/gbs-rumpf.txt)"
pruefe "dabei entsteht kein Abschlusszeugnis" \
  "$(gleich "$($PSQL "select count(*) from zeugnisse where typ='ABSCHLUSS';")" "$ABSCHLUSS_VORHER")"
SEM_LETZT=$($PSQL "select id from semester where lehrjahr=3 and halbjahr=2 order by start limit 1;")
ZA_LETZT=$(rumpf_und_status -X POST "${BASIS}/api/zeugnisse/ausstellen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${SEM_LETZT}\",\"typ\":\"ABSCHLUSS\"}")
pruefe "im letzten Rastersemester (3. Lehrjahr, Fruehling) laeuft er (200, 0 fehlgeschlagen)" \
  "$([ "$ZA_LETZT" = "200" ] && grep -q '"fehlgeschlagen":0' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$ZA_LETZT $(cat /tmp/gbs-rumpf.txt)"
ZA_UNBEKANNT=$(status_von -X POST "${BASIS}/api/zeugnisse/ausstellen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"$(neuer_token)\",\"typ\":\"SEMESTER\"}")
pruefe "ein Sammellauf fuer ein unbekanntes Semester ist 404 (nicht 200 mit Nullen)" "$(gleich "$ZA_UNBEKANNT" "404")" "$ZA_UNBEKANNT"
pruefe "die Zeugnisseite nennt die Sperre („nur im letzten Semester der Ausbildung“)" \
  "$(enthaelt "$(curl -s "${BASIS}/verwaltung/zeugnisse?semester=${TARGET_ID}&typ=ABSCHLUSS" -H "Cookie: ${KEKS}")" 'nur im letzten Semester der Ausbildung')"

# --- Archivkopien an das DMS nachsenden (Sammel-Nachversand) ---
DMS_T=$(status_von -X POST "${BASIS}/api/zeugnisse/dms-nachsenden" -H "Cookie: ${KEKS2}")
pruefe "ein Teilnehmer darf keine Archivkopien nachsenden (403)" "$(gleich "$DMS_T" "403")" "$DMS_T"
DMS_S=$(rumpf_und_status -X POST "${BASIS}/api/zeugnisse/dms-nachsenden" -H "Cookie: ${KEKS}")
pruefe "ohne DMS-Adresse: 409 mit Hinweis auf DMS_EMAIL" \
  "$([ "$DMS_S" = "409" ] && grep -q 'DMS_EMAIL' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$DMS_S $(cat /tmp/gbs-rumpf.txt)"
ZS_DMS=$(curl -s "${BASIS}/verwaltung/zeugnisse" -H "Cookie: ${KEKS}")
pruefe "die Zeugnisseite zeigt die offenen Archivkopien samt Grund (DMS_EMAIL)" \
  "$([ "$(enthaelt "$ZS_DMS" 'noch nicht im DMS archiviert')" = "1" ] && [ "$(enthaelt "$ZS_DMS" 'DMS_EMAIL')" = "1" ] && echo 1 || echo 0)"

echo
echo "=== 36b. Zeugnisse: Hoerer ohne besuchten Abend, Storno ohne Ersatz ==="
# Empfehlung Semesterbetrieb (27.09.2026), zwei Regeln:
#  - Eine Teilnahmebescheinigung gibt es nur mit mindestens einem besuchten Abend
#    (anwesend oder nachgearbeitet) in einem Fach.
#  - Eine Fehlausstellung laesst sich ohne Ersatz stornieren (Status STORNIERT,
#    Migration 20260928100000): ungueltig, fuer die Person nicht mehr abrufbar,
#    als Nachweis mit Zeitpunkt, Akteur und Pflicht-Grund gespeichert.
# Eigene Personen in 2099-H: Hugo (Hoerer) und Stella (Schuelerin, am Ende
# anonymisiert — sie faellt damit aus allen spaeteren Listen).
pruefe "die Storno-Migration ist eingespielt (Enum-Wert STORNIERT, CHECK zeugnisse_storno_konsistent)" \
  "$(gleich "$($PSQL "select (select count(*) from _prisma_migrations where migration_name='20260928100000_zeugnis_storno' and finished_at is not null) || '/' || (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname='Zeugnisstatus' and e.enumlabel='STORNIERT') || '/' || (select count(*) from pg_constraint where conname='zeugnisse_storno_konsistent');")" "1/1/1")"

# --- Hoerer ohne besuchten Abend: fuer Hugo ist nur ENTSCHULDIGT erfasst.
HUGO_ID=$(person_anlegen Hugo Hoerlos AKTIV HOERER)
HUGO_TEILNAHME=$($PSQL "insert into teilnahmen (id,\"personId\",\"semesterId\",teilnahmeform,\"erstelltAm\") values (gen_random_uuid(),'${HUGO_ID}','${SEMESTER_ID}','HOERER',now()) returning id;")
$PSQL "insert into anwesenheiten (id,\"terminId\",\"teilnahmeId\",status,\"erfasstAm\") values (gen_random_uuid(),'${NT_TERMIN}','${HUGO_TEILNAHME}','ENTSCHULDIGT',now());" > /dev/null
HUGO_EINZELN=$(rumpf_und_status -X POST "${BASIS}/api/zeugnisse/ausstellen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${SEMESTER_ID}\",\"typ\":\"SEMESTER\",\"personId\":\"${HUGO_ID}\"}")
pruefe "ein Hoerer ohne besuchten Abend (nur entschuldigt) bekommt keine Bescheinigung (409)" \
  "$([ "$HUGO_EINZELN" = "409" ] && grep -q 'kein besuchter Abend in einem Fach' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$HUGO_EINZELN $(cat /tmp/gbs-rumpf.txt)"
HUGO_SAMMEL=$(rumpf_und_status -X POST "${BASIS}/api/zeugnisse/ausstellen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${SEMESTER_ID}\",\"typ\":\"SEMESTER\"}")
HUGO_SAMMEL_RUMPF=$(cat /tmp/gbs-rumpf.txt)
pruefe "der Sammellauf uebergeht ihn als „ohne Anwesenheit“ — kein Fehlschlag, kein Dokument" \
  "$([ "$HUGO_SAMMEL" = "200" ] && echo "$HUGO_SAMMEL_RUMPF" | grep -qE '"ohneAnwesenheit":[1-9]' && [ "$(enthaelt "$HUGO_SAMMEL_RUMPF" '"fehlgeschlagen":0')" = "1" ] && [ "$($PSQL "select count(*) from zeugnisse where \"personId\"='${HUGO_ID}';")" = "0" ] && echo 1 || echo 0)" "$HUGO_SAMMEL $HUGO_SAMMEL_RUMPF"
pruefe "die Zeugnisseite sagt, warum (kein besuchter Abend in einem Fach erfasst)" \
  "$(enthaelt "$(curl -s "${BASIS}/verwaltung/zeugnisse?semester=${SEMESTER_ID}&typ=SEMESTER" -H "Cookie: ${KEKS}")" 'kein besuchter Abend in einem Fach erfasst')"
$PSQL "update anwesenheiten set status='ANWESEND' where \"teilnahmeId\"='${HUGO_TEILNAHME}';" > /dev/null
HUGO_NACH=$(curl -s -X POST "${BASIS}/api/zeugnisse/ausstellen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${SEMESTER_ID}\",\"typ\":\"SEMESTER\",\"personId\":\"${HUGO_ID}\"}")
pruefe "mit einem besuchten Abend bekommt er die Bescheinigung (BESCH-, ein Fach)" \
  "$([ "$(enthaelt "$HUGO_NACH" '"belegNr":"BESCH-')" = "1" ] && [ "$($PSQL "select jsonb_array_length(snapshot->'leistungen') from zeugnisse where \"personId\"='${HUGO_ID}' and status='GUELTIG';")" = "1" ] && echo 1 || echo 0)" "$HUGO_NACH"

# --- Storno ohne Ersatz: Stella ist Schuelerin in 2099-H und sieht ihr Zeugnis selbst.
STELLA_ID=$(person_anlegen Stella Storno AKTIV SCHUELER)
$PSQL "insert into person_rolle (\"personId\", \"rolleCode\") values ('${STELLA_ID}', 'TEILNEHMER');" > /dev/null
$PSQL "insert into teilnahmen (id,\"personId\",\"semesterId\",teilnahmeform,\"erstelltAm\") values (gen_random_uuid(),'${STELLA_ID}','${SEMESTER_ID}','SCHUELER',now());" > /dev/null
KEKS_STELLA=$(anmelden_als "$STELLA_ID")
curl -s -o /dev/null -X POST "${BASIS}/api/zeugnisse/ausstellen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${SEMESTER_ID}\",\"typ\":\"SEMESTER\",\"personId\":\"${STELLA_ID}\"}"
ZST=$($PSQL "select id from zeugnisse where \"personId\"='${STELLA_ID}' and status='GUELTIG';")
ZST_BELEG=$($PSQL "select \"belegNr\" from zeugnisse where id='${ZST}';")
pruefe "Vorbedingung: Stella hat ein gueltiges Zeugnis und sieht es unter „Meine Daten“" \
  "$([ -n "$ZST" ] && [ -n "$ZST_BELEG" ] && [ "$(enthaelt "$(curl -s "${BASIS}/meine-daten" -H "Cookie: ${KEKS_STELLA}")" "$ZST_BELEG")" = "1" ] && echo 1 || echo 0)"
storniere() { # $1 = Zeugnis-Id, danach curl-Argumente (Cookie, Rumpf)
  local id="$1"; shift
  rumpf_und_status -X POST "${BASIS}/api/zeugnisse/${id}/stornieren" -H 'Content-Type: application/json' "$@"
}
SN_SELBST=$(storniere "$ZST" -H "Cookie: ${KEKS_STELLA}" -d '{"grund":"Ich will nicht mehr"}')
SN_OHNE=$(storniere "$ZST" -d '{"grund":"ohne Sitzung"}')
pruefe "Storno: die Schuelerin selbst darf nicht (403), ohne Sitzung 401" \
  "$([ "$SN_SELBST" = "403" ] && [ "$SN_OHNE" = "401" ] && echo 1 || echo 0)" "${SN_SELBST}/${SN_OHNE}"
SN_LEER=$(storniere "$ZST" -H "Cookie: ${KEKS}" -d '{}'); SN_LEER_TEXT=$(cat /tmp/gbs-rumpf.txt)
SN_BLANK=$(storniere "$ZST" -H "Cookie: ${KEKS}" -d '{"grund":"   "}'); SN_BLANK_TEXT=$(cat /tmp/gbs-rumpf.txt)
SN_LANG=$(storniere "$ZST" -H "Cookie: ${KEKS}" -d "{\"grund\":\"$(printf 'x%.0s' $(seq 1 501))\"}")
pruefe "ohne Grund, nur mit Leerzeichen, mit 501 Zeichen: 400 — das Zeugnis bleibt gueltig" \
  "$([ "$SN_LEER" = "400" ] && echo "$SN_LEER_TEXT" | grep -q 'Bitte geben Sie einen Grund' && [ "$SN_BLANK" = "400" ] && echo "$SN_BLANK_TEXT" | grep -q 'Bitte geben Sie einen Grund' && [ "$SN_LANG" = "400" ] && grep -q 'höchstens 500 Zeichen' /tmp/gbs-rumpf.txt && [ "$($PSQL "select status from zeugnisse where id='${ZST}';")" = "GUELTIG" ] && echo 1 || echo 0)" "${SN_LEER}/${SN_BLANK}/${SN_LANG}"
SN_404=$(storniere "$(neuer_token)" -H "Cookie: ${KEKS}" -d '{"grund":"Test"}'); SN_404_TEXT=$(cat /tmp/gbs-rumpf.txt)
SN_ERSETZT=$(storniere "$Z1" -H "Cookie: ${KEKS}" -d '{"grund":"Test"}')
pruefe "ein unbekanntes Zeugnis 404, ein ersetztes 409 (es bleibt ERSETZT)" \
  "$([ "$SN_404" = "404" ] && echo "$SN_404_TEXT" | grep -q 'Dieses Zeugnis gibt es nicht' && [ "$SN_ERSETZT" = "409" ] && grep -q 'bereits ersetzt oder storniert' /tmp/gbs-rumpf.txt && [ "$($PSQL "select status from zeugnisse where id='${Z1}';")" = "ERSETZT" ] && echo 1 || echo 0)" "${SN_404}/${SN_ERSETZT}"
SN_OK=$(storniere "$ZST" -H "Cookie: ${KEKS}" -d '{"grund":"Durchstich: falsches Semester"}'); SN_OK_RUMPF=$(cat /tmp/gbs-rumpf.txt)
pruefe "die Schulleitung storniert ohne Ersatz (200, STORNIERT, Beleg-Nr)" \
  "$([ "$SN_OK" = "200" ] && [ "$(enthaelt "$SN_OK_RUMPF" '"status":"STORNIERT"')" = "1" ] && [ "$(enthaelt "$SN_OK_RUMPF" "\"belegNr\":\"${ZST_BELEG}\"")" = "1" ] && echo 1 || echo 0)" "$SN_OK $SN_OK_RUMPF"
pruefe "am Zeugnis stehen Zeitpunkt, Akteur und Grund" \
  "$(gleich "$($PSQL "select status || '|' || (\"storniertAm\" is not null) || '|' || \"storniertVonId\" || '|' || \"stornoGrund\" from zeugnisse where id='${ZST}';")" "STORNIERT|true|${SCHULLEITER_ID}|Durchstich: falsches Semester")"
SN_2=$(storniere "$ZST" -H "Cookie: ${KEKS}" -d '{"grund":"Noch einmal"}')
pruefe "ein zweiter Storno: 409 — der erste Grund bleibt" \
  "$([ "$SN_2" = "409" ] && [ "$($PSQL "select \"stornoGrund\" from zeugnisse where id='${ZST}';")" = "Durchstich: falsches Semester" ] && echo 1 || echo 0)" "$SN_2 $(cat /tmp/gbs-rumpf.txt)"
pruefe "das Protokoll haelt nur fest, DASS es einen Grund gab (ZEUGNIS_STORNIERT) — ohne DMS kein Storno-Vermerk" \
  "$([ "$($PSQL "select count(*) from audit_log where aktion='ZEUGNIS_STORNIERT' and \"objektId\"='${ZST}' and (nachher->>'grundAngegeben')='true' and (coalesce(vorher::text,'') || nachher::text) not like '%falsches Semester%';")" = "1" ] && [ "$($PSQL "select count(*) from email_versand where betreff like 'Storno-Vermerk%';")" = "0" ] && echo 1 || echo 0)"
SN_PDF=$(curl -s -D /tmp/gbs-kopf-storno.txt -o /tmp/gbs-storno.pdf -w '%{http_code}' "${BASIS}/api/zeugnisse/${ZST}/pdf" -H "Cookie: ${KEKS}")
pruefe "die Schulleitung laedt es als Nachweis (200, …-STORNIERT.pdf, Vermerk „STORNIERT am …“)" \
  "$([ "$SN_PDF" = "200" ] && grep -qi "filename=\"${ZST_BELEG}-STORNIERT.pdf\"" /tmp/gbs-kopf-storno.txt && grep -aqE 'STORNIERT am [0-9]{2}\.[0-9]{2}\.[0-9]{4}' /tmp/gbs-storno.pdf && echo 1 || echo 0)" "$SN_PDF"
SN_PDF_SELBST=$(rumpf_und_status "${BASIS}/api/zeugnisse/${ZST}/pdf" -H "Cookie: ${KEKS_STELLA}")
pruefe "Stella selbst bekommt es nicht mehr (410, „wurde storniert“)" \
  "$([ "$SN_PDF_SELBST" = "410" ] && grep -q 'wurde storniert' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$SN_PDF_SELBST $(cat /tmp/gbs-rumpf.txt)"
SN_AKTE=$(curl -s "${BASIS}/meine-daten" -H "Cookie: ${KEKS_STELLA}")
pruefe "und „Meine Daten“ fuehrt die Beleg-Nr nicht mehr (die Akte selbst laedt)" \
  "$([ "$(enthaelt "$SN_AKTE" 'Hallo Stella')" = "1" ] && [ "$(fehlt_in "$SN_AKTE" "$ZST_BELEG")" = "1" ] && echo 1 || echo 0)"
SN_SAMMEL=$(rumpf_und_status -X POST "${BASIS}/api/zeugnisse/ausstellen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${SEMESTER_ID}\",\"typ\":\"SEMESTER\"}")
pruefe "der Sammellauf stellt die stornierte Fehlausstellung nicht still neu aus (storniert gezaehlt)" \
  "$([ "$SN_SAMMEL" = "200" ] && grep -qE '"storniert":[1-9]' /tmp/gbs-rumpf.txt && grep -q '"fehlgeschlagen":0' /tmp/gbs-rumpf.txt && [ "$($PSQL "select count(*) from zeugnisse where \"personId\"='${STELLA_ID}' and status='GUELTIG';")" = "0" ] && echo 1 || echo 0)" "$SN_SAMMEL $(cat /tmp/gbs-rumpf.txt)"
pruefe "die Zeugnisseite zeigt statt eines gueltigen das stornierte Dokument (Beleg-Nr, „storniert am“)" \
  "$(enthaelt "$(curl -s "${BASIS}/verwaltung/zeugnisse?semester=${SEMESTER_ID}&typ=SEMESTER" -H "Cookie: ${KEKS}")" "Beleg-Nr. ${ZST_BELEG} · storniert am")"
# Wie die uebrigen Belege auch fuer den Eigentuemer eingefroren (Trigger, CHECK).
pruefe "Datenbank: Grund und Stand eines stornierten Zeugnisses sind fest" \
  "$([ "$(abgewiesen "update zeugnisse set \"stornoGrund\" = 'anderer Grund' where id='${ZST}';")" = "1" ] && [ "$(abgewiesen "update zeugnisse set status = 'GUELTIG', \"storniertAm\" = null, \"storniertVonId\" = null, \"stornoGrund\" = null where id='${ZST}';")" = "1" ] && echo 1 || echo 0)"
SN_CHECK=$($PSQL "insert into zeugnisse (id, \"belegNr\", \"personId\", \"semesterId\", typ, status, snapshot) values (gen_random_uuid(), 'ZEU-DURCHSTICH-CHECK', '${STELLA_ID}', '${SEMESTER_ID}', 'SEMESTER', 'STORNIERT', '{}'::jsonb);" 2>&1)
pruefe "Datenbank: STORNIERT ohne Zeitpunkt und Grund scheitert am CHECK zeugnisse_storno_konsistent" \
  "$([ "$(echo "$SN_CHECK" | grep -c 'zeugnisse_storno_konsistent')" -ge 1 ] && [ "$($PSQL "select count(*) from zeugnisse where \"belegNr\"='ZEU-DURCHSTICH-CHECK';")" = "0" ] && echo 1 || echo 0)" "$SN_CHECK"
SN_NEU=$(curl -s -X POST "${BASIS}/api/zeugnisse/ausstellen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${SEMESTER_ID}\",\"typ\":\"SEMESTER\",\"personId\":\"${STELLA_ID}\"}")
ZST_NEU=$($PSQL "select id from zeugnisse where \"personId\"='${STELLA_ID}' and status='GUELTIG';")
pruefe "einzeln laesst sich danach neu ausstellen — wieder Ausfertigung 1, das stornierte bleibt STORNIERT" \
  "$([ "$(enthaelt "$SN_NEU" '"version":1')" = "1" ] && [ -n "$ZST_NEU" ] && [ "$($PSQL "select status from zeugnisse where id='${ZST}';")" = "STORNIERT" ] && echo 1 || echo 0)" "$SN_NEU"
SN_ANON=$(rumpf_und_status -X POST "${BASIS}/api/personen/${STELLA_ID}/anonymisieren" -H "Cookie: ${KEKS}")
pruefe "die Anonymisierung ersetzt den Storno-Grund durch den Platzhalter und zaehlt ihn (stornoGruendeAnonymisiert 1)" \
  "$([ "$SN_ANON" = "200" ] && [ "$($PSQL "select \"stornoGrund\" from zeugnisse where id='${ZST}';")" = "[anonymisiert]" ] && [ "$($PSQL "select nachher->>'stornoGruendeAnonymisiert' from audit_log where aktion='PERSON_ANONYMISIERT' and \"objektId\"='${STELLA_ID}';")" = "1" ] && echo 1 || echo 0)" "$SN_ANON $(cat /tmp/gbs-rumpf.txt)"
SN_NACH_ANON=$(storniere "$ZST_NEU" -H "Cookie: ${KEKS}" -d '{"grund":"nach der Anonymisierung"}')
pruefe "danach ist kein Storno mehr moeglich (409, „anonymisiert“) — ihr neues Zeugnis bleibt gueltig" \
  "$([ "$SN_NACH_ANON" = "409" ] && grep -q 'anonymisiert' /tmp/gbs-rumpf.txt && [ "$($PSQL "select status from zeugnisse where id='${ZST_NEU}';")" = "GUELTIG" ] && echo 1 || echo 0)" "$SN_NACH_ANON $(cat /tmp/gbs-rumpf.txt)"

echo
echo "=== 37. Herkunftspruefung (CSRF), Abmelden und Sitzungshinweis ==="
# Die Middleware prueft bei jeder schreibenden /api-Anfrage Origin und
# Sec-Fetch-Site (lib/herkunft.ts, Code-Review 4 M5). Der ganze Durchstich
# schickt keinen der beiden Header — dass er gruen ist, belegt den Durchlass ohne
# Header (curl, Cron, Durchstich). Hier die Browserfaelle, am Weg zur
# Kontouebernahme: eine E-Mail-Aenderung als „simple request" (text/plain, ohne
# Preflight) von einer fremden Seite.
EIGENER_ORIGIN="https://durchstich.example.org"
CSRF_SUB=$(status_von -X POST "${BASIS}/api/meine-daten/email" -H "Cookie: ${KEKS2}" -H 'Content-Type: text/plain' \
  -H 'Origin: https://evil.durchstich.example.org' -d '{"email":"x@angreifer.de"}')
CSRF_FREMD=$(status_von -X POST "${BASIS}/api/meine-daten/email" -H "Cookie: ${KEKS2}" -H 'Content-Type: text/plain' \
  -H 'Origin: https://angreifer.example' -d '{"email":"x@angreifer.de"}')
pruefe "fremder Origin (Nachbar-Subdomain bzw. fremde Site) wird abgewiesen (403/403)" \
  "$([ "$CSRF_SUB" = "403" ] && [ "$CSRF_FREMD" = "403" ] && echo 1 || echo 0)" "${CSRF_SUB}/${CSRF_FREMD}"
pruefe "und es entsteht kein Aenderungsantrag" \
  "$(gleich "$($PSQL "select count(*) from email_aenderungen where \"neueEmail\"='x@angreifer.de';")" "0")"
# Der eigene Origin kommt bis zur Route durch; die weist die unbrauchbare Adresse
# mit 400 ab — so bleibt die Probe ohne Nebenwirkung.
CSRF_EIGEN=$(status_von -X POST "${BASIS}/api/meine-daten/email" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' \
  -H "Origin: ${EIGENER_ORIGIN}" -d '{"email":"keine-adresse"}')
pruefe "der eigene Origin (= APP_URL) kommt bis zur Route durch (400 fuer die unbrauchbare Adresse)" "$(gleich "$CSRF_EIGEN" "400")" "$CSRF_EIGEN"
CSRF_SCHEMA=$(status_von -X POST "${BASIS}/api/meine-daten/email" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' \
  -H 'Origin: http://durchstich.example.org' -d '{"email":"keine-adresse"}')
CSRF_PORT=$(status_von -X POST "${BASIS}/api/meine-daten/email" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' \
  -H 'Origin: https://durchstich.example.org:8443' -d '{"email":"keine-adresse"}')
pruefe "anderes Schema oder anderer Port gilt als fremd (403/403)" \
  "$([ "$CSRF_SCHEMA" = "403" ] && [ "$CSRF_PORT" = "403" ] && echo 1 || echo 0)" "${CSRF_SCHEMA}/${CSRF_PORT}"
FETCH_CROSS=$(status_von -X POST "${BASIS}/api/meine-daten/email" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' \
  -H 'Sec-Fetch-Site: cross-site' -d '{"email":"keine-adresse"}')
FETCH_SAMESITE=$(status_von -X POST "${BASIS}/api/meine-daten/email" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' \
  -H 'Sec-Fetch-Site: same-site' -d '{"email":"keine-adresse"}')
pruefe "ohne Origin: Sec-Fetch-Site cross-site und same-site werden abgewiesen (403/403)" \
  "$([ "$FETCH_CROSS" = "403" ] && [ "$FETCH_SAMESITE" = "403" ] && echo 1 || echo 0)" "${FETCH_CROSS}/${FETCH_SAMESITE}"
FETCH_SAMEORIGIN=$(status_von -X POST "${BASIS}/api/meine-daten/email" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' \
  -H 'Sec-Fetch-Site: same-origin' -d '{"email":"keine-adresse"}')
pruefe "Sec-Fetch-Site same-origin kommt durch (400 von der Route)" "$(gleich "$FETCH_SAMEORIGIN" "400")" "$FETCH_SAMEORIGIN"
HEALTH_FREMD=$(status_von "${BASIS}/api/health" -H 'Origin: https://angreifer.example')
pruefe "lesende Anfragen bleiben frei: GET /api/health mit fremdem Origin (200/503, nicht 403)" \
  "$([ "$HEALTH_FREMD" = "200" ] || [ "$HEALTH_FREMD" = "503" ] && echo 1 || echo 0)" "$HEALTH_FREMD"

# Login-CSRF: Eine fremde Seite darf niemandem eine Sitzung unterschieben — und
# den Link dabei auch nicht verbrauchen.
LC_TOKEN=$(neuer_token)
$PSQL "insert into magic_links (id, \"personId\", \"tokenHash\", \"laeuftAb\", \"erstelltAm\") values (gen_random_uuid(), '${SCHULLEITER_ID}', '$(hash_von "$LC_TOKEN")', now() + interval '1 hour', now());" > /dev/null
rm -f /tmp/gbs-kopf-lc.txt
LC=$(curl -s -D /tmp/gbs-kopf-lc.txt -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/auth/token" \
  -H 'Origin: https://angreifer.example' -H 'Content-Type: text/plain' -d "{\"token\":\"${LC_TOKEN}\"}")
pruefe "Login-CSRF: fremder Origin loest keinen Anmeldelink ein (403)" "$(gleich "$LC" "403")" "$LC"
pruefe "dabei wird kein Cookie gesetzt und der Link nicht verbraucht" \
  "$([ -s /tmp/gbs-kopf-lc.txt ] && ! grep -qi '^set-cookie:' /tmp/gbs-kopf-lc.txt && [ "$($PSQL "select count(*) from magic_links where \"tokenHash\"='$(hash_von "$LC_TOKEN")' and \"benutztAm\" is null;")" = "1" ] && echo 1 || echo 0)"
KEKS_AB=$(curl -s -D - -o /dev/null -X POST "${BASIS}/api/auth/token" -H 'Content-Type: application/json' -d "{\"token\":\"${LC_TOKEN}\"}" \
  | grep -i '^set-cookie:' | head -1 | sed 's/^[^:]*: //' | cut -d';' -f1)
pruefe "ohne fremden Origin laesst sich derselbe Link einloesen" "$([ -n "$KEKS_AB" ] && echo 1 || echo 0)"
pruefe "jede Abweisung steht mit Grund im Betriebslog ([HERKUNFT])" \
  "$([ "$(docker logs gbs-durchstich 2>&1 | grep -c '\[HERKUNFT\]')" -ge 1 ] && echo 1 || echo 0)"

# Abmelden (M4): In Produktion heisst das Cookie __Host-gbs_sitzung. Ein
# Loeschversuch ohne Secure verwirft der Browser — die Sitzung bliebe offen,
# waehrend die Route „abgemeldet" meldet. Der Durchstich laeuft im
# Produktions-Image (NODE_ENV=production).
AB_STATUS=$(curl -s -D /tmp/gbs-kopf-ab.txt -o /tmp/gbs-ab.json -w '%{http_code}' -X POST "${BASIS}/api/auth/abmelden" -H "Cookie: ${KEKS_AB}")
pruefe "Abmelden antwortet 200 (abgemeldet)" \
  "$([ "$AB_STATUS" = "200" ] && grep -q '"abgemeldet":true' /tmp/gbs-ab.json && echo 1 || echo 0)" "$AB_STATUS"
AB_COOKIE=$(grep -i '^set-cookie: __Host-gbs_sitzung=;' /tmp/gbs-kopf-ab.txt | head -1)
pruefe "das Loeschcookie traegt Secure, Path=/, Max-Age=0 und HttpOnly" \
  "$([ -n "$AB_COOKIE" ] && echo "$AB_COOKIE" | grep -qi 'secure' && echo "$AB_COOKIE" | grep -qi 'path=/' && echo "$AB_COOKIE" | grep -qi 'max-age=0' && echo "$AB_COOKIE" | grep -qi 'httponly' && echo 1 || echo 0)" "$AB_COOKIE"
pruefe "das Abmelden steht im Protokoll (ABGEMELDET)" \
  "$(gleich "$($PSQL "select count(*) from audit_log where aktion='ABGEMELDET' and \"akteurId\"='${SCHULLEITER_ID}';")" "1")"

# /anmelden weist auf eine noch laufende Sitzung hin — und fuehrt Neue zur
# Anmeldung fuer die Bibelschule.
pruefe "/anmelden mit laufender Sitzung: Hinweis „noch als …“" \
  "$(enthaelt "$(curl -s "${BASIS}/anmelden" -H "Cookie: ${KEKS}")" 'noch als')"
ANMELDEN_OHNE=$(curl -s "${BASIS}/anmelden")
pruefe "ohne Cookie steht dort kein solcher Hinweis" "$(fehlt_in "$ANMELDEN_OHNE" 'noch als')"
pruefe "die Seite verlinkt die Anmeldung zur Bibelschule (/anmeldung)" "$(enthaelt "$ANMELDEN_OHNE" 'href="/anmeldung"')"

# Bankverbindung im Klartext: nur per POST (die Herkunftspruefung greift — ein
# praeparierter Link erzeugte sonst im Namen des Angemeldeten einen unloeschbaren
# Einsicht-Eintrag), und nie in einem Cache.
BANK_GET=$(status_von "${BASIS}/api/personen/${TEILNEHMER_ID}/bankverbindung" -H "Cookie: ${KEKS_V}")
pruefe "Bankverbindung: GET gibt es nicht (405)" "$(gleich "$BANK_GET" "405")" "$BANK_GET"
BANK_EINSICHT_VORHER=$($PSQL "select count(*) from audit_log where aktion='BANKVERBINDUNG_EINGESEHEN';")
BANK_FREMD=$(status_von -X POST "${BASIS}/api/personen/${TEILNEHMER_ID}/bankverbindung" -H "Cookie: ${KEKS_V}" -H 'Origin: https://angreifer.example')
BANK_CROSS=$(status_von -X POST "${BASIS}/api/personen/${TEILNEHMER_ID}/bankverbindung" -H "Cookie: ${KEKS_V}" -H 'Sec-Fetch-Site: cross-site')
pruefe "fremde Herkunft wird abgewiesen (403/403) — ohne Einsicht-Eintrag im Protokoll" \
  "$([ "$BANK_FREMD" = "403" ] && [ "$BANK_CROSS" = "403" ] && [ "$($PSQL "select count(*) from audit_log where aktion='BANKVERBINDUNG_EINGESEHEN';")" = "$BANK_EINSICHT_VORHER" ] && echo 1 || echo 0)" "${BANK_FREMD}/${BANK_CROSS}"
BANK_OK=$(curl -s -D /tmp/gbs-kopf-bank.txt -o /tmp/gbs-bank.json -w '%{http_code}' -X POST "${BASIS}/api/personen/${TEILNEHMER_ID}/bankverbindung" \
  -H "Cookie: ${KEKS_V}" -H "Origin: ${EIGENER_ORIGIN}")
pruefe "vom eigenen Origin gibt die Verwaltung die IBAN heraus (200, Cache-Control: no-store)" \
  "$([ "$BANK_OK" = "200" ] && grep -q '"iban"' /tmp/gbs-bank.json && grep -qi '^cache-control: no-store' /tmp/gbs-kopf-bank.txt && echo 1 || echo 0)" "$BANK_OK"
BANK_TN=$(curl -s -D /tmp/gbs-kopf-bank-tn.txt -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/personen/${TEILNEHMER_ID}/bankverbindung" -H "Cookie: ${KEKS2}")
pruefe "ein Teilnehmer bekommt 403 — ebenfalls nicht zwischengespeichert" \
  "$([ "$BANK_TN" = "403" ] && grep -qi '^cache-control: no-store' /tmp/gbs-kopf-bank-tn.txt && echo 1 || echo 0)" "$BANK_TN"

# Einstellungen: Ein Schluessel zaehlt nur als eigener Eintrag. Mit `in` fanden
# Prototyp-Namen wie „constructor" eine geerbte Methode, und die Route endete
# in einer 500.
EIN_C=$(status_von -X PUT "${BASIS}/api/einstellungen" -H "Cookie: ${KEKS_ADMIN}" -H 'Content-Type: application/json' -d '{"schluessel":"constructor","wert":5}')
EIN_P=$(status_von -X PUT "${BASIS}/api/einstellungen" -H "Cookie: ${KEKS_ADMIN}" -H 'Content-Type: application/json' -d '{"schluessel":"__proto__","wert":5}')
EIN_T=$(status_von -X PUT "${BASIS}/api/einstellungen" -H "Cookie: ${KEKS_ADMIN}" -H 'Content-Type: application/json' -d '{"schluessel":"toString","wert":5}')
pruefe "Prototyp-Namen sind keine Einstellung (404/404/404)" \
  "$([ "$EIN_C" = "404" ] && [ "$EIN_P" = "404" ] && [ "$EIN_T" = "404" ] && echo 1 || echo 0)" "${EIN_C}/${EIN_P}/${EIN_T}"
EIN_OK=$(status_von -X PUT "${BASIS}/api/einstellungen" -H "Cookie: ${KEKS_ADMIN}" -H 'Content-Type: application/json' -d '{"schluessel":"AUTH_SITZUNG_STUNDEN","wert":12}')
pruefe "eine echte Einstellung laesst sich setzen (200)" "$(gleich "$EIN_OK" "200")" "$EIN_OK"

echo
echo "=== 38. Einwilligungstexte sind eingefroren (Trigger, M8) ==="
# Erteilte Einwilligungen verweisen auf ihre Fassung. Aenderte sich deren Text,
# zeigten alle bisherigen Einwilligungen still auf einen Text, dem niemand
# zugestimmt hat (Nachweis nach Art. 7 Abs. 1 DSGVO). Geprueft als Eigentuemer —
# der Trigger gilt fuer jeden, das entzogene Recht (Abschnitt 31) nur fuer gbs_app.
# Geprueft an der geltenden Fassung 2 (seit der Umstellung auf „Sie“): So stellt
# das Zuruecknehmen von aktivBis unten genau den Stand des Seeds wieder her.
pruefe "den Text einer Fassung zu aendern weist die Datenbank ab" \
  "$(abgewiesen "update einwilligungs_texte set text = text || ' (geaendert)' where code='DATENSCHUTZ' and version=2;")"
pruefe "der Text ist unveraendert" \
  "$(gleich "$($PSQL "select count(*) from einwilligungs_texte where text like '%(geaendert)';")" "0")"
pruefe "ebenso Pflicht und Titel" \
  "$([ "$(abgewiesen "update einwilligungs_texte set pflicht = not pflicht where code='DATENSCHUTZ' and version=2;")" = "1" ] && [ "$(abgewiesen "update einwilligungs_texte set titel = titel || ' x' where code='DATENSCHUTZ' and version=2;")" = "1" ] && echo 1 || echo 0)"
pruefe "ein UPDATE ohne Aenderung laeuft durch (kein Fehlalarm)" \
  "$(laeuft_durch "update einwilligungs_texte set titel = titel where code='DATENSCHUTZ' and version=2;")"
pruefe "ausser Kraft setzen ueber aktivBis ist erlaubt — und zuruecknehmbar" \
  "$([ "$(laeuft_durch "update einwilligungs_texte set \"aktivBis\" = now() + interval '10 years' where code='DATENSCHUTZ' and version=2;")" = "1" ] && [ "$(laeuft_durch "update einwilligungs_texte set \"aktivBis\" = null where code='DATENSCHUTZ' and version=2;")" = "1" ] && echo 1 || echo 0)"
# Eine Fassung ohne Einwilligung daran — der Fremdschluessel schuetzt sie also
# nicht, nur der Trigger. aktivBis in der Vergangenheit, damit sie in keinem
# Formular erscheint.
$PSQL "insert into einwilligungs_texte (id, code, version, titel, text, \"istArt9\", pflicht, \"aktivBis\") values (gen_random_uuid()::text, 'TEST', 99, 't', 't', false, false, now() - interval '1 day');" > /dev/null
pruefe "eine Fassung laesst sich nicht loeschen, auch ohne Einwilligung daran" \
  "$(abgewiesen "delete from einwilligungs_texte where code='TEST';")"
pruefe "die Testfassung steht weiter da" \
  "$(gleich "$($PSQL "select count(*) from einwilligungs_texte where code='TEST';")" "1")"
TEXTE_VORHER=$($PSQL "select (select count(*) from einwilligungs_texte) || '/' || (select count(*) from einwilligungen);")
# Mit CASCADE fiele auch einwilligungen mit — deren eigener TRUNCATE-Trigger
# bricht ohnehin ab, und ohne CASCADE bricht schon der Fremdschluessel ab. Dass
# der Trigger DIESER Tabelle greift, zeigt erst seine Meldung (die Trigger der
# ausdruecklich genannten Tabelle feuern vor denen der mitgeleerten).
pruefe "TRUNCATE (auch mit CASCADE) scheitert am Trigger der Fassungen selbst" \
  "$($PSQL "truncate einwilligungs_texte cascade;" 2>&1 | grep -q 'TRUNCATE auf einwilligungs_texte ist nicht zulaessig' && echo 1 || echo 0)"
pruefe "Fassungen und Einwilligungen sind vollstaendig erhalten" \
  "$(gleich "$($PSQL "select (select count(*) from einwilligungs_texte) || '/' || (select count(*) from einwilligungen);")" "$TEXTE_VORHER")"

echo
echo "=== 39. Statuswechsel von Hand, letzter Administrator, Absolventen (M9) ==="
# Vorher liess sich der Status nur an vier fest verdrahteten Stellen setzen — der
# „Not-Aus" (VERSTORBEN, AUSGESCHLOSSEN, ABGEBROCHEN) griff nie. Recht
# PERSON_STATUS_WECHSELN, laut Seed nur die Schulleitung.
W1_ID=$($PSQL "insert into personen (id, vorname, nachname, email, \"statusCode\", \"erstelltAm\", \"aktualisiertAm\") values (gen_random_uuid(), 'Walter', 'Wechsel', 'walter.wechsel@beispiel.de', 'AKTIV', now(), now()) returning id;")
ST1=$(status_von -X POST "${BASIS}/api/personen/${W1_ID}/status" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"nachCode":"BEURLAUBT"}')
pruefe "die Schulleitung setzt einen Status von Hand (BEURLAUBT, 200)" "$(gleich "$ST1" "200")" "$ST1"
pruefe "der Status steht in der Akte" "$(gleich "$($PSQL "select \"statusCode\" from personen where id='${W1_ID}';")" "BEURLAUBT")"
pruefe "der Wechsel steht mit Ausloeser in status_wechsel" \
  "$(gleich "$($PSQL "select \"vonCode\" || '>' || \"nachCode\" || '|' || \"ausgeloestVonId\" from status_wechsel where \"personId\"='${W1_ID}' order by \"erstelltAm\" desc limit 1;")" "AKTIV>BEURLAUBT|${SCHULLEITER_ID}")"
pruefe "und im Protokoll (STATUS_GEWECHSELT)" \
  "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='STATUS_GEWECHSELT' and \"objektId\"='${W1_ID}';")" "t")"
ST_ADMIN=$(status_von -X POST "${BASIS}/api/personen/${W1_ID}/status" -H "Cookie: ${KEKS_ADMIN}" -H 'Content-Type: application/json' -d '{"nachCode":"AKTIV"}')
ST_TN=$(status_von -X POST "${BASIS}/api/personen/${W1_ID}/status" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' -d '{"nachCode":"AKTIV"}')
ST_V=$(status_von -X POST "${BASIS}/api/personen/${W1_ID}/status" -H "Cookie: ${KEKS_V}" -H 'Content-Type: application/json' -d '{"nachCode":"AKTIV"}')
pruefe "Administrator, Teilnehmer und Verwaltung setzen keinen Status (403/403/403)" \
  "$([ "$ST_ADMIN" = "403" ] && [ "$ST_TN" = "403" ] && [ "$ST_V" = "403" ] && echo 1 || echo 0)" "${ST_ADMIN}/${ST_TN}/${ST_V}"
ST_OHNE=$(status_von -X POST "${BASIS}/api/personen/${W1_ID}/status" -H 'Content-Type: application/json' -d '{"nachCode":"AKTIV"}')
pruefe "ohne Sitzung: 401" "$(gleich "$ST_OHNE" "401")" "$ST_OHNE"
ST_ZURUECK=$(status_von -X POST "${BASIS}/api/personen/${W1_ID}/status" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"nachCode":"AKTIV"}')
pruefe "zurueck auf AKTIV (200)" "$(gleich "$ST_ZURUECK" "200")" "$ST_ZURUECK"
ST_GLEICH=$(status_von -X POST "${BASIS}/api/personen/${W1_ID}/status" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"nachCode":"AKTIV"}')
ST_INT=$(status_von -X POST "${BASIS}/api/personen/${W1_ID}/status" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"nachCode":"INTERESSENT"}')
ST_ANON=$(status_von -X POST "${BASIS}/api/personen/${W1_ID}/status" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"nachCode":"ANONYMISIERT"}')
ST_UNBEK=$(status_von -X POST "${BASIS}/api/personen/${W1_ID}/status" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"nachCode":"GIBTSNICHT"}')
pruefe "kein Wechsel: derselbe Status, INTERESSENT, ANONYMISIERT, unbekannt (je 400)" \
  "$([ "$ST_GLEICH" = "400" ] && [ "$ST_INT" = "400" ] && [ "$ST_ANON" = "400" ] && [ "$ST_UNBEK" = "400" ] && echo 1 || echo 0)" "${ST_GLEICH}/${ST_INT}/${ST_ANON}/${ST_UNBEK}"
ST_SELBST=$(status_von -X POST "${BASIS}/api/personen/${SCHULLEITER_ID}/status" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"nachCode":"BEURLAUBT"}')
pruefe "den eigenen Status setzt niemand selbst (403)" "$(gleich "$ST_SELBST" "403")" "$ST_SELBST"
# Gerd (Abschnitt 16) hat eine eingereichte Anmeldung, ueber die noch nicht
# entschieden ist — ein Wechsel von Hand ginge an der Aufnahme vorbei.
ST_OFFEN=$(rumpf_und_status -X POST "${BASIS}/api/personen/${FREI_ID}/status" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"nachCode":"BEURLAUBT"}')
pruefe "bei offener Anmeldung kein Wechsel von Hand (409)" \
  "$([ "$ST_OFFEN" = "409" ] && grep -q 'noch nicht entschieden' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$ST_OFFEN $(cat /tmp/gbs-rumpf.txt)"

# Endzustand an Wilma: Grund Pflicht, kein Weg zurueck, Sitzung endet, keine
# Noten und kein Zeugnis mehr. Sie ist Schuelerin in 2099-H.
W2_ID=$($PSQL "insert into personen (id, vorname, nachname, email, \"statusCode\", teilnahmeform, \"erstelltAm\", \"aktualisiertAm\") values (gen_random_uuid(), 'Wilma', 'Wechsel', 'wilma.wechsel@beispiel.de', 'AKTIV', 'SCHUELER', now(), now()) returning id;")
$PSQL "insert into person_rolle (\"personId\", \"rolleCode\") values ('${W2_ID}', 'TEILNEHMER');" > /dev/null
W2_TEILNAHME=$($PSQL "insert into teilnahmen (id,\"personId\",\"semesterId\",teilnahmeform,\"erstelltAm\") values (gen_random_uuid(),'${W2_ID}','${SEMESTER_ID}','SCHUELER',now()) returning id;")
KEKS_W2=$(anmelden_als "$W2_ID")
pruefe "Wilma meldet sich an" "$([ -n "$KEKS_W2" ] && echo 1 || echo 0)"
VST_OHNE=$(status_von -X POST "${BASIS}/api/personen/${W2_ID}/status" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"nachCode":"VERSTORBEN"}')
pruefe "VERSTORBEN ohne Grund wird abgewiesen (400)" "$(gleich "$VST_OHNE" "400")" "$VST_OHNE"
VST=$(status_von -X POST "${BASIS}/api/personen/${W2_ID}/status" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"nachCode":"VERSTORBEN","grund":"Mitteilung Familie"}')
pruefe "mit Grund wird VERSTORBEN gesetzt (200)" "$(gleich "$VST" "200")" "$VST"
VST_ZURUECK=$(status_von -X POST "${BASIS}/api/personen/${W2_ID}/status" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"nachCode":"AKTIV"}')
pruefe "aus dem Endzustand fuehrt kein Statuswechsel heraus (409)" "$(gleich "$VST_ZURUECK" "409")" "$VST_ZURUECK"
# Der Grund ist Freitext mit Personenbezug: Er steht in status_wechsel (dort
# erreicht ihn die Anonymisierung), im unloeschbaren Protokoll nur, DASS es einen gab.
pruefe "das Protokoll haelt nur fest, dass ein Grund angegeben wurde" \
  "$(gleich "$($PSQL "select count(*) from audit_log where aktion='STATUS_GEWECHSELT' and \"objektId\"='${W2_ID}' and nachher::text like '%grundAngegeben%' and (coalesce(vorher::text,'') || nachher::text) not like '%Mitteilung%';")" "1")"
pruefe "ihre laufende Sitzung ist damit beendet (/meine-daten 307)" \
  "$(gleich "$(status_von "${BASIS}/meine-daten" -H "Cookie: ${KEKS_W2}")" "307")"
W2_ZEUGNIS=$(rumpf_und_status -X POST "${BASIS}/api/zeugnisse/ausstellen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d "{\"semesterId\":\"${SEMESTER_ID}\",\"typ\":\"SEMESTER\",\"personId\":\"${W2_ID}\"}")
pruefe "fuer eine Person im Endzustand wird kein Zeugnis ausgestellt (409, „Endzustand“)" \
  "$([ "$W2_ZEUGNIS" = "409" ] && grep -q 'Endzustand' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$W2_ZEUGNIS $(cat /tmp/gbs-rumpf.txt)"
W2_NOTE=$(curl -s -X POST "${BASIS}/api/noten" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d "{\"kurseinheitId\":\"${KURSEINHEIT_ID}\",\"semesterId\":\"${SEMESTER_ID}\",\"eintraege\":[{\"teilnahmeId\":\"${W2_TEILNAHME}\",\"ergebnis\":\"BESTANDEN\"}]}")
pruefe "ihre Teilnahme wird bei der Notenerfassung uebersprungen (gesetzt 0, keine Leistung)" \
  "$([ "$(enthaelt "$W2_NOTE" '"gesetzt":0')" = "1" ] && [ "$($PSQL "select count(*) from leistungen where \"teilnahmeId\"='${W2_TEILNAHME}';")" = "0" ] && echo 1 || echo 0)" "$W2_NOTE"

# Letzter Administrator: Anna ist das einzige Administratorkonto. Ein Endzustand
# oder die Anonymisierung sperrte danach jeden aus Konten und Rollen aus.
LA_STATUS=$(rumpf_und_status -X POST "${BASIS}/api/personen/${ADMIN_ID}/status" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"nachCode":"VERSTORBEN","grund":"Test"}')
pruefe "den letzten Administrator setzt niemand in einen Endzustand (409)" \
  "$([ "$LA_STATUS" = "409" ] && grep -q 'letzte Administrator' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$LA_STATUS $(cat /tmp/gbs-rumpf.txt)"
LA_ANON=$(status_von -X POST "${BASIS}/api/personen/${ADMIN_ID}/anonymisieren" -H "Cookie: ${KEKS}")
pruefe "und anonymisiert ihn nicht (409)" "$(gleich "$LA_ANON" "409")" "$LA_ANON"
# Ein zweites Administratorkonto im Endzustand kommt selbst nicht mehr hinein —
# es zaehlt nicht.
ADMIN2_ID=$($PSQL "insert into personen (id, vorname, nachname, email, \"statusCode\", \"erstelltAm\", \"aktualisiertAm\") values (gen_random_uuid(), 'Adam', 'Ausgeschieden', 'adam.ausgeschieden@beispiel.de', 'AUSGESCHLOSSEN', now(), now()) returning id;")
$PSQL "insert into person_rolle (\"personId\", \"rolleCode\") values ('${ADMIN2_ID}', 'ADMIN');" > /dev/null
LA2_STATUS=$(status_von -X POST "${BASIS}/api/personen/${ADMIN_ID}/status" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"nachCode":"VERSTORBEN","grund":"Test"}')
LA2_ANON=$(status_von -X POST "${BASIS}/api/personen/${ADMIN_ID}/anonymisieren" -H "Cookie: ${KEKS}")
LA2_ROLLEN=$(status_von -X PUT "${BASIS}/api/personen/${ADMIN_ID}/rollen" -H "Cookie: ${KEKS_ADMIN}" -H 'Content-Type: application/json' -d '{"rollen":[]}')
pruefe "auch neben einem Admin im Endzustand bleibt Anna die letzte (409/409/409)" \
  "$([ "$LA2_STATUS" = "409" ] && [ "$LA2_ANON" = "409" ] && [ "$LA2_ROLLEN" = "409" ] && echo 1 || echo 0)" "${LA2_STATUS}/${LA2_ANON}/${LA2_ROLLEN}"
pruefe "Anna ist weiter aktiv und Administratorin" \
  "$(gleich "$($PSQL "select p.\"statusCode\" || '/' || (select count(*) from person_rolle r where r.\"personId\" = p.id and r.\"rolleCode\"='ADMIN') from personen p where p.id='${ADMIN_ID}';")" "AKTIV/1")"

# Absolventen (Fachentscheidung 27.09.2026): kein Endzustand — der Portalzugang
# bleibt, sonst kaemen sie nicht an ihr Abschlusszeugnis —, aber nicht aktiv
# und ohne Automatik-Mails.
pruefe "ABSOLVENT: kein Endzustand, nicht aktiv, keine Automatik-Mails (f|f|f)" \
  "$(gleich "$($PSQL "select \"istTerminal\", \"istAktiv\", \"automatikMails\" from teilnehmer_status where code='ABSOLVENT';")" "f|f|f")"
ALMA_ID=$($PSQL "insert into personen (id, vorname, nachname, email, \"statusCode\", teilnahmeform, \"erstelltAm\", \"aktualisiertAm\") values (gen_random_uuid(), 'Alma', 'Abgang', 'alma.abgang@beispiel.de', 'AKTIV', 'SCHUELER', now(), now()) returning id;")
$PSQL "insert into person_rolle (\"personId\", \"rolleCode\") values ('${ALMA_ID}', 'TEILNEHMER');" > /dev/null
$PSQL "insert into teilnahmen (id,\"personId\",\"semesterId\",teilnahmeform,\"erstelltAm\") values (gen_random_uuid(),'${ALMA_ID}','${SEMESTER_ID}','SCHUELER',now());" > /dev/null
KEKS_ALMA=$(anmelden_als "$ALMA_ID")
ST_ALMA=$(status_von -X POST "${BASIS}/api/personen/${ALMA_ID}/status" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"nachCode":"ABSOLVENT"}')
pruefe "Alma wird Absolventin (200)" "$(gleich "$ST_ALMA" "200")" "$ST_ALMA"
pruefe "ihr Portalzugang bleibt (/meine-daten 200)" "$(gleich "$(status_von "${BASIS}/meine-daten" -H "Cookie: ${KEKS_ALMA}")" "200")"
ALMA_LINK=$(status_von -X POST "${BASIS}/api/personen/${ALMA_ID}/anmeldelink" -H "Cookie: ${KEKS}")
pruefe "ein Anmeldelink laesst sich weiter verschicken (200, kein Endzustand)" "$(gleich "$ALMA_LINK" "200")" "$ALMA_LINK"
curl -s -o /tmp/gbs-liste-absolvent.xlsx "${BASIS}/api/semester/${SEMESTER_ID}/export" -H "Cookie: ${KEKS}"
INHALT_ABSOLVENT=$(unzip -p /tmp/gbs-liste-absolvent.xlsx 2>/dev/null)
pruefe "in der Teilnehmerliste steht sie nicht mehr (Excel, Gegenprobe: Hoerer stehen drin)" \
  "$([ "$(enthaelt "$INHALT_ABSOLVENT" 'Hoerer')" = "1" ] && [ "$(fehlt_in "$INHALT_ABSOLVENT" 'Abgang')" = "1" ] && echo 1 || echo 0)"
ALMA_ZEUGNIS=$(curl -s -X POST "${BASIS}/api/zeugnisse/ausstellen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d "{\"semesterId\":\"${SEMESTER_ID}\",\"typ\":\"ABSCHLUSS\",\"personId\":\"${ALMA_ID}\"}")
pruefe "ihr Abschlusszeugnis wird ausgestellt (Beleg-Nr ZEU-)" "$(enthaelt "$ALMA_ZEUGNIS" '"belegNr":"ZEU-')" "$ALMA_ZEUGNIS"

# Wiederaufnahme nach Abbruch (Empfehlung Semesterbetrieb, 27.09.2026):
# ABGEBROCHEN ist kein Endzustand mehr — wie ABSOLVENT nicht aktiv und ohne
# Automatik-Mails, der Zugang bleibt. Zurueck nach AKTIV nur mit Grund.
pruefe "ABGEBROCHEN: kein Endzustand, nicht aktiv, keine Automatik-Mails (f|f|f)" \
  "$(gleich "$($PSQL "select \"istTerminal\", \"istAktiv\", \"automatikMails\" from teilnehmer_status where code='ABGEBROCHEN';")" "f|f|f")"
BRUNO_ID=$($PSQL "insert into personen (id, vorname, nachname, email, \"statusCode\", teilnahmeform, \"erstelltAm\", \"aktualisiertAm\") values (gen_random_uuid(), 'Bruno', 'Pause', 'bruno.pause@beispiel.de', 'AKTIV', 'SCHUELER', now(), now()) returning id;")
$PSQL "insert into person_rolle (\"personId\", \"rolleCode\") values ('${BRUNO_ID}', 'TEILNEHMER');" > /dev/null
# Bruno ist Schueler in 2099-H. Ohne diese Teilnahme stuende er nach der
# Wiederaufnahme als „noch nicht zugeordnet“ da, und die Sammeluebernahme in
# Abschnitt 41 legte ihn an — dort wird aber geprueft, dass sie niemanden anlegt.
$PSQL "insert into teilnahmen (id,\"personId\",\"semesterId\",teilnahmeform,\"erstelltAm\") values (gen_random_uuid(),'${BRUNO_ID}','${SEMESTER_ID}','SCHUELER',now());" > /dev/null
KEKS_BRUNO=$(anmelden_als "$BRUNO_ID")
AB_OHNE=$(status_von -X POST "${BASIS}/api/personen/${BRUNO_ID}/status" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"nachCode":"ABGEBROCHEN"}')
AB_MIT=$(status_von -X POST "${BASIS}/api/personen/${BRUNO_ID}/status" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"nachCode":"ABGEBROCHEN","grund":"Pause wegen Umzug"}')
pruefe "Bruno bricht ab, nur mit Grund (400, dann 200)" \
  "$([ "$AB_OHNE" = "400" ] && [ "$AB_MIT" = "200" ] && echo 1 || echo 0)" "${AB_OHNE}/${AB_MIT}"
pruefe "sein Portalzugang bleibt (/meine-daten 200, kein Endzustand)" \
  "$(gleich "$(status_von "${BASIS}/meine-daten" -H "Cookie: ${KEKS_BRUNO}")" "200")"
WA_OHNE=$(rumpf_und_status -X POST "${BASIS}/api/personen/${BRUNO_ID}/status" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"nachCode":"AKTIV"}')
pruefe "die Wiederaufnahme ohne Grund wird abgewiesen (400, eigene Meldung)" \
  "$([ "$WA_OHNE" = "400" ] && grep -q 'Wiederaufnahme nach einem Abbruch braucht einen Grund' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$WA_OHNE $(cat /tmp/gbs-rumpf.txt)"
WA_MIT=$(status_von -X POST "${BASIS}/api/personen/${BRUNO_ID}/status" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"nachCode":"AKTIV","grund":"Kommt zum Herbst zurueck"}')
pruefe "mit Grund nimmt die Schulleitung ihn wieder auf (200, AKTIV)" \
  "$([ "$WA_MIT" = "200" ] && [ "$($PSQL "select \"statusCode\" from personen where id='${BRUNO_ID}';")" = "AKTIV" ] && echo 1 || echo 0)" "$WA_MIT"
pruefe "der Verlauf haelt beide Wechsel mit Grund fest, das Protokoll nur, DASS einer da war" \
  "$([ "$($PSQL "select string_agg(\"vonCode\" || '>' || \"nachCode\", ',' order by \"erstelltAm\") from status_wechsel where \"personId\"='${BRUNO_ID}' and grund is not null;")" = "AKTIV>ABGEBROCHEN,ABGEBROCHEN>AKTIV" ] && [ "$($PSQL "select count(*) from audit_log where aktion='STATUS_GEWECHSELT' and \"objektId\"='${BRUNO_ID}' and (nachher->>'grundAngegeben')='true' and nachher::text not like '%Umzug%' and nachher::text not like '%Herbst%';")" = "2" ] && echo 1 || echo 0)"

echo
echo "=== 40. Ausbildungsdaten: Geburtsdatum, Gemeinde, Teilnahmeform (M9) ==="
# Recht wie der Statuswechsel (nur Schulleitung). Ins Protokoll nur Feldnamen.
X_ID=$($PSQL "insert into personen (id, vorname, nachname, email, \"statusCode\", teilnahmeform, \"erstelltAm\", \"aktualisiertAm\") values (gen_random_uuid(), 'Xenia', 'Ausbildung', 'xenia.ausbildung@beispiel.de', 'AKTIV', 'SCHUELER', now(), now()) returning id;")
X_TEILNAHME=$($PSQL "insert into teilnahmen (id,\"personId\",\"semesterId\",teilnahmeform,\"erstelltAm\") values (gen_random_uuid(),'${X_ID}','${SEMESTER_ID}','SCHUELER',now()) returning id;")
AD_GEB=$(status_von -X PUT "${BASIS}/api/personen/${X_ID}/ausbildungsdaten" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"geburtsdatum":"1990-04-30"}')
pruefe "das Geburtsdatum wird gesetzt (200, 30.04.1990)" \
  "$([ "$AD_GEB" = "200" ] && [ "$($PSQL "select geburtsdatum::text from personen where id='${X_ID}';")" = "1990-04-30" ] && echo 1 || echo 0)" "$AD_GEB"
pruefe "das Protokoll nennt das Feld, nicht den Wert" \
  "$(gleich "$($PSQL "select nachher::text like '%geburtsdatum%' and nachher::text not like '%1990%' from audit_log where aktion='PERSON_AUSBILDUNGSDATEN_GEAENDERT' and \"objektId\"='${X_ID}' order by \"erstelltAm\" desc limit 1;")" "t")"
AD_ZUKUNFT=$(status_von -X PUT "${BASIS}/api/personen/${X_ID}/ausbildungsdaten" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"geburtsdatum\":\"$(tag 30)\"}")
AD_UNMOEGLICH=$(status_von -X PUT "${BASIS}/api/personen/${X_ID}/ausbildungsdaten" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"geburtsdatum":"1990-02-31"}')
pruefe "Geburtsdatum in der Zukunft oder unmoeglich wird abgewiesen (400/400)" \
  "$([ "$AD_ZUKUNFT" = "400" ] && [ "$AD_UNMOEGLICH" = "400" ] && echo 1 || echo 0)" "${AD_ZUKUNFT}/${AD_UNMOEGLICH}"
AD_HOERER=$(rumpf_und_status -X PUT "${BASIS}/api/personen/${X_ID}/ausbildungsdaten" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"teilnahmeform":"HOERER"}')
pruefe "der Formwechsel gilt fuer Person und laufende Teilnahme (200, 1 Teilnahme angepasst)" \
  "$([ "$AD_HOERER" = "200" ] && grep -q '"teilnahmenAngepasst":1' /tmp/gbs-rumpf.txt && [ "$($PSQL "select p.teilnahmeform || '|' || t.teilnahmeform from personen p join teilnahmen t on t.\"personId\" = p.id where t.id='${X_TEILNAHME}';")" = "HOERER|HOERER" ] && echo 1 || echo 0)" "$AD_HOERER $(cat /tmp/gbs-rumpf.txt)"
AD_LEER=$(status_von -X PUT "${BASIS}/api/personen/${X_ID}/ausbildungsdaten" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"teilnahmeform":""}')
pruefe "mit laufender Teilnahme laesst sich die Form nicht leeren (400)" "$(gleich "$AD_LEER" "400")" "$AD_LEER"
# Regression aus Runde 2: Person und Teilnahme weichen voneinander ab. Das
# Personen-Update war dann leer und wurde als „gerade anonymisiert" (409) gemeldet.
$PSQL "update personen set teilnahmeform='SCHUELER' where id='${X_ID}';" > /dev/null
AD_ABWEICHEND=$(rumpf_und_status -X PUT "${BASIS}/api/personen/${X_ID}/ausbildungsdaten" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"teilnahmeform":"SCHUELER"}')
pruefe "weicht nur die Teilnahme ab, wird sie angeglichen (200, 1 angepasst, SCHUELER)" \
  "$([ "$AD_ABWEICHEND" = "200" ] && grep -q '"teilnahmenAngepasst":1' /tmp/gbs-rumpf.txt && [ "$($PSQL "select teilnahmeform from teilnahmen where id='${X_TEILNAHME}';")" = "SCHUELER" ] && echo 1 || echo 0)" "$AD_ABWEICHEND $(cat /tmp/gbs-rumpf.txt)"
# Die Gemeinde ist eine Angabe nach Art. 9 DSGVO: ohne erteilte Einwilligung
# kein neuer Wert. Leeren geht immer.
AD_GEMEINDE=$(status_von -X PUT "${BASIS}/api/personen/${X_ID}/ausbildungsdaten" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"gemeinde":"Testgemeinde"}')
AD_GEMEINDE_LEER=$(status_von -X PUT "${BASIS}/api/personen/${X_ID}/ausbildungsdaten" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"gemeinde":""}')
pruefe "ohne Art.-9-Einwilligung keine Gemeinde (409), leeren geht (200)" \
  "$([ "$AD_GEMEINDE" = "409" ] && [ "$AD_GEMEINDE_LEER" = "200" ] && [ "$($PSQL "select count(*) from personen where id='${X_ID}' and gemeinde is null;")" = "1" ] && echo 1 || echo 0)" "${AD_GEMEINDE}/${AD_GEMEINDE_LEER}"
AD_PETRA=$(status_von -X PUT "${BASIS}/api/personen/${TEILNEHMER_ID}/ausbildungsdaten" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"gemeinde":"FeG Minden Nord"}')
pruefe "mit Art.-9-Einwilligung (Petra) wird die Gemeinde gesetzt (200)" \
  "$([ "$AD_PETRA" = "200" ] && [ "$($PSQL "select gemeinde from personen where id='${TEILNEHMER_ID}';")" = "FeG Minden Nord" ] && echo 1 || echo 0)" "$AD_PETRA"
curl -s -o /dev/null -X PUT "${BASIS}/api/personen/${TEILNEHMER_ID}/ausbildungsdaten" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"gemeinde":"FeG Minden"}'
AD_V=$(status_von -X PUT "${BASIS}/api/personen/${X_ID}/ausbildungsdaten" -H "Cookie: ${KEKS_V}" -H 'Content-Type: application/json' -d '{"geburtsdatum":"1990-05-01"}')
pruefe "die Verwaltung aendert keine Ausbildungsdaten (403)" "$(gleich "$AD_V" "403")" "$AD_V"
# Eine fuer das Semester abgemeldete Teilnahme verlangt keine festgelegte Form,
# geht beim Wechsel aber mit (sonst gaelte nach „Wieder aufnehmen" die alte).
$PSQL "update teilnahmen set \"abgemeldetAm\"=now(), \"abmeldeGrund\"='BIN_RAUS' where id='${X_TEILNAHME}';" > /dev/null
AD_ABGEMELDET=$(rumpf_und_status -X PUT "${BASIS}/api/personen/${X_ID}/ausbildungsdaten" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"teilnahmeform":"HOERER"}')
pruefe "die abgemeldete Teilnahme geht beim Formwechsel mit (200, 1 angepasst, HOERER)" \
  "$([ "$AD_ABGEMELDET" = "200" ] && grep -q '"teilnahmenAngepasst":1' /tmp/gbs-rumpf.txt && [ "$($PSQL "select teilnahmeform from teilnahmen where id='${X_TEILNAHME}';")" = "HOERER" ] && echo 1 || echo 0)" "$AD_ABGEMELDET $(cat /tmp/gbs-rumpf.txt)"
AD_ABGEMELDET_LEER=$(status_von -X PUT "${BASIS}/api/personen/${X_ID}/ausbildungsdaten" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"teilnahmeform":""}')
pruefe "mit nur abgemeldeter Teilnahme laesst sich die Form leeren (200)" "$(gleich "$AD_ABGEMELDET_LEER" "200")" "$AD_ABGEMELDET_LEER"
$PSQL "update teilnahmen set \"abgemeldetAm\"=null, \"abmeldeGrund\"=null, teilnahmeform='SCHUELER' where id='${X_TEILNAHME}';" > /dev/null
$PSQL "update personen set teilnahmeform='SCHUELER' where id='${X_ID}';" > /dev/null
AD_ANONYM=$(status_von -X PUT "${BASIS}/api/personen/${KLAUS_ID}/ausbildungsdaten" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"geburtsdatum":"1980-01-01"}')
pruefe "eine anonymisierte Person laesst sich nicht bearbeiten (409)" "$(gleich "$AD_ANONYM" "409")" "$AD_ANONYM"

echo
echo "=== 41. Abgemeldete Teilnahme faellt aus allen Listen — und „Wieder aufnehmen“ ==="
# Fachentscheidung 27.09.2026: „bin raus" (bzw. keine Rueckmeldung) meldet die
# Teilnahme ab; sie zaehlt dann nirgends mehr. Petra wird fuer 2099-H abgemeldet
# und am Ende wieder aufgenommen — die spaeteren Abschnitte finden sie wie vorher.
$PSQL "update teilnahmen set \"abgemeldetAm\"=now(), \"abmeldeGrund\"='BIN_RAUS' where id='${TEILNAHME_ID}';" > /dev/null
curl -s -o /tmp/gbs-liste-abgemeldet.xlsx "${BASIS}/api/semester/${SEMESTER_ID}/export" -H "Cookie: ${KEKS}"
INHALT_ABGEMELDET=$(unzip -p /tmp/gbs-liste-abgemeldet.xlsx 2>/dev/null)
pruefe "die Excel-Liste fuehrt sie nicht mehr (Gegenprobe: Hoerer stehen drin)" \
  "$([ "$(enthaelt "$INHALT_ABGEMELDET" 'Hoerer')" = "1" ] && [ "$(fehlt_in "$INHALT_ABGEMELDET" 'Beispiel')" = "1" ] && echo 1 || echo 0)"
pruefe "die Teilnehmerseite sagt, dass jemand abgemeldet ist" \
  "$(enthaelt "$(curl -s "${BASIS}/verwaltung/teilnehmer" -H "Cookie: ${KEKS}")" 'für dieses Semester abgemeldet')"
AB_NOTE_SL=$(status_von -X POST "${BASIS}/api/noten" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"kurseinheitId\":\"${KURSEINHEIT_ID}\",\"semesterId\":\"${SEMESTER_ID}\",\"eintraege\":[{\"teilnahmeId\":\"${TEILNAHME_ID}\",\"ergebnis\":\"BESTANDEN\"}]}")
AB_NOTE_DOZ=$(status_von -X POST "${BASIS}/api/dozent/note" -H "Cookie: ${KEKS_DOZ}" -H 'Content-Type: application/json' -d "{\"kurseinheitId\":\"${KURSEINHEIT_ID}\",\"semesterId\":\"${SEMESTER_ID}\",\"eintraege\":[{\"teilnahmeId\":\"${TEILNAHME_ID}\",\"ergebnis\":\"BESTANDEN\"}]}")
pruefe "keine Noten fuer eine abgemeldete Teilnahme (Schulleitung/Dozentin 409/409)" \
  "$([ "$AB_NOTE_SL" = "409" ] && [ "$AB_NOTE_DOZ" = "409" ] && echo 1 || echo 0)" "${AB_NOTE_SL}/${AB_NOTE_DOZ}"
AB_ANW=$(curl -s -X POST "${BASIS}/api/stundenplan/anwesenheit" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"terminId\":\"${TERMIN_ID}\",\"eintraege\":[{\"teilnahmeId\":\"${TEILNAHME_ID}\",\"status\":\"GEFEHLT\"}]}")
pruefe "die Anwesenheitserfassung uebergeht sie (gesetzt 0)" "$(enthaelt "$AB_ANW" '"gesetzt":0')" "$AB_ANW"
AB_SELBST=$(status_von -X POST "${BASIS}/api/meine-daten/anwesenheit" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' -d "{\"terminId\":\"${SB_PAST}\",\"status\":\"ANWESEND\"}")
pruefe "sie selbst kann sich fuer dieses Semester nicht mehr bestaetigen (404)" "$(gleich "$AB_SELBST" "404")" "$AB_SELBST"
AB_ZEUGNIS=$(status_von -X POST "${BASIS}/api/zeugnisse/ausstellen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${SEMESTER_ID}\",\"typ\":\"SEMESTER\",\"personId\":\"${TEILNEHMER_ID}\"}")
pruefe "fuer die abgemeldete Teilnahme gibt es kein Zeugnis (409)" "$(gleich "$AB_ZEUGNIS" "409")" "$AB_ZEUGNIS"
AB_UEBERNAHME=$(curl -s -X POST "${BASIS}/api/semester/${SEMESTER_ID}/teilnehmer" -H "Cookie: ${KEKS}")
pruefe "die Sammeluebernahme legt sie nicht still wieder an (uebernommen 0, eine Teilnahme)" \
  "$([ "$(enthaelt "$AB_UEBERNAHME" '"uebernommen":0')" = "1" ] && [ "$($PSQL "select count(*) from teilnahmen where \"personId\"='${TEILNEHMER_ID}' and \"semesterId\"='${SEMESTER_ID}';")" = "1" ] && echo 1 || echo 0)" "$AB_UEBERNAHME"
AKTE_ABGEMELDET=$(curl -s "${BASIS}/verwaltung/personen/${TEILNEHMER_ID}" -H "Cookie: ${KEKS}")
pruefe "die Akte zeigt die Abmeldung mit Grund („abgemeldet (…bin raus…)“)" \
  "$([ "$(enthaelt "$AKTE_ABGEMELDET" 'abgemeldet (')" = "1" ] && [ "$(enthaelt "$AKTE_ABGEMELDET" 'bin raus')" = "1" ] && echo 1 || echo 0)"
pruefe "und sagt, warum hier keine Noten stehen" "$(enthaelt "$AKTE_ABGEMELDET" 'eine abgemeldete Teilnahme wird nicht benotet')"
pruefe "der Personenstatus bleibt dabei unveraendert (ANGENOMMEN)" \
  "$(gleich "$($PSQL "select \"statusCode\" from personen where id='${TEILNEHMER_ID}';")" "ANGENOMMEN")"
# Wieder aufnehmen — nur die Schulleitung, genau einmal.
WA_TN=$(status_von -X POST "${BASIS}/api/semesterueberleitung/wieder-aufnehmen" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' -d "{\"teilnahmeId\":\"${TEILNAHME_ID}\"}")
pruefe "ein Teilnehmer nimmt niemanden wieder auf (403)" "$(gleich "$WA_TN" "403")" "$WA_TN"
WA=$(status_von -X POST "${BASIS}/api/semesterueberleitung/wieder-aufnehmen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"teilnahmeId\":\"${TEILNAHME_ID}\"}")
pruefe "die Schulleitung nimmt sie wieder auf (200)" "$(gleich "$WA" "200")" "$WA"
pruefe "die Teilnahme zaehlt wieder und gilt als bestaetigt" \
  "$(gleich "$($PSQL "select \"abgemeldetAm\" is null and \"abmeldeGrund\" is null and \"bestaetigtAm\" is not null from teilnahmen where id='${TEILNAHME_ID}';")" "t")"
pruefe "das Wiederaufnehmen steht im Protokoll" \
  "$(gleich "$($PSQL "select count(*) from audit_log where aktion='TEILNAHME_WIEDER_AUFGENOMMEN' and \"objektId\"='${TEILNAHME_ID}';")" "1")"
WA2=$(status_von -X POST "${BASIS}/api/semesterueberleitung/wieder-aufnehmen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"teilnahmeId\":\"${TEILNAHME_ID}\"}")
WA_404=$(status_von -X POST "${BASIS}/api/semesterueberleitung/wieder-aufnehmen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"teilnahmeId\":\"$(neuer_token)\"}")
pruefe "ein zweites Mal 409, eine unbekannte Teilnahme 404" \
  "$([ "$WA2" = "409" ] && [ "$WA_404" = "404" ] && echo 1 || echo 0)" "${WA2}/${WA_404}"

echo
echo "=== 41b. Zuletzt abgemeldet: die Absage gilt ueber das Semester hinaus, einzeln uebernehmen ==="
# Empfehlung Semesterbetrieb (27.09.2026): Wer fuer das Vorsemester „Ich bin
# raus“ gesagt hat, hat im laufenden Semester keine Teilnahme — die
# Sammeluebernahme legte ihn frueher still wieder an. Jetzt laesst sie ihn aus;
# die Schulleitung uebernimmt einzeln, wer wieder dabei sein will. Das
# Vorsemester beginnt VOR 2099-H (das erst in zwei Wochen beginnt).
VOR_SEM=$($PSQL "insert into semester (id, code, bezeichnung, start, ende, \"erstelltAm\") values (gen_random_uuid(), 'UEB-VOR', 'Vorsemester Test', '$(tag -150)', '$(tag -10)', now()) returning id;")
LOTTE_ID=$(person_anlegen Lotte Letztesmal AKTIV SCHUELER)
$PSQL "insert into person_rolle (\"personId\", \"rolleCode\") values ('${LOTTE_ID}', 'TEILNEHMER');" > /dev/null
$PSQL "insert into teilnahmen (id, \"personId\", \"semesterId\", teilnahmeform, \"eingeladenAm\", \"abgemeldetAm\", \"abmeldeGrund\", \"erstelltAm\") values (gen_random_uuid(), '${LOTTE_ID}', '${VOR_SEM}', 'SCHUELER', now() - interval '160 days', now() - interval '155 days', 'BIN_RAUS', now() - interval '160 days');" > /dev/null
uebernimm() { rumpf_und_status -X POST "${BASIS}/api/semester/${SEMESTER_ID}/teilnehmer" -H 'Content-Type: application/json' "$@"; }
LOTTE_TEILNAHMEN="select count(*) from teilnahmen where \"personId\"='${LOTTE_ID}' and \"semesterId\"='${SEMESTER_ID}';"
LA_SEITE=$(curl -s "${BASIS}/verwaltung/teilnehmer" -H "Cookie: ${KEKS}")
pruefe "die Teilnehmerseite fuehrt sie unter „Zuletzt abgemeldet“ — mit Namen und Grund" \
  "$([ "$(enthaelt "$LA_SEITE" 'Zuletzt abgemeldet (bin raus / keine Rückmeldung):')" = "1" ] && [ "$(enthaelt "$LA_SEITE" 'Letztesmal, Lotte')" = "1" ] && [ "$(enthaelt "$LA_SEITE" 'Vorsemester Test: hat abgesagt')" = "1" ] && echo 1 || echo 0)"
LA_SAMMEL=$(rumpf_und_status -X POST "${BASIS}/api/semester/${SEMESTER_ID}/teilnehmer" -H "Cookie: ${KEKS}")
pruefe "die Sammeluebernahme laesst sie aus und zaehlt sie getrennt (zuletztAbgemeldet)" \
  "$([ "$LA_SAMMEL" = "200" ] && grep -qE '"zuletztAbgemeldet":[1-9]' /tmp/gbs-rumpf.txt && [ "$($PSQL "$LOTTE_TEILNAHMEN")" = "0" ] && echo 1 || echo 0)" "$LA_SAMMEL $(cat /tmp/gbs-rumpf.txt)"
LA_TN=$(uebernimm -H "Cookie: ${KEKS2}" -d "{\"personId\":\"${LOTTE_ID}\"}")
LA_X=$(uebernimm -H "Cookie: ${KEKS}" -d '{"personId":"x"}')
LA_KAPUTT=$(uebernimm -H "Cookie: ${KEKS}" -d '{"personId":')
pruefe "Einzeluebernahme: Teilnehmer 403, keine UUID 400, kaputtes JSON 400 — nichts angelegt" \
  "$([ "$LA_TN" = "403" ] && [ "$LA_X" = "400" ] && [ "$LA_KAPUTT" = "400" ] && [ "$($PSQL "$LOTTE_TEILNAHMEN")" = "0" ] && echo 1 || echo 0)" "${LA_TN}/${LA_X}/${LA_KAPUTT}"
LA_EINZELN=$(uebernimm -H "Cookie: ${KEKS}" -d "{\"personId\":\"${LOTTE_ID}\"}")
LOTTE_TEILNAHME=$($PSQL "select id from teilnahmen where \"personId\"='${LOTTE_ID}' and \"semesterId\"='${SEMESTER_ID}';")
# Der erwartete Rumpf steht vorab in einer Variablen: Die Bash 3.2 von macOS
# zerlegt ein "{\"…\"}}" innerhalb von "$( … )" in mehrere Argumente.
LA_ERWARTET="{\"data\":{\"uebernommen\":1,\"teilnahmeId\":\"${LOTTE_TEILNAHME}\"}}"
pruefe "die Schulleitung uebernimmt sie einzeln (200, uebernommen 1, mit der neuen Teilnahme)" \
  "$([ "$LA_EINZELN" = "200" ] && [ -n "$LOTTE_TEILNAHME" ] && [ "$(cat /tmp/gbs-rumpf.txt)" = "$LA_ERWARTET" ] && echo 1 || echo 0)" "$LA_EINZELN $(cat /tmp/gbs-rumpf.txt)"
pruefe "das Protokoll nennt die uebergangene Absage (Vorsemester, BIN_RAUS) — ohne Namen" \
  "$(gleich "$($PSQL "select count(*) from audit_log where aktion='SEMESTER_TEILNEHMER_EINZELN_UEBERNOMMEN' and \"objektId\"='${LOTTE_TEILNAHME}' and nachher->>'personId'='${LOTTE_ID}' and nachher->>'teilnahmeform'='SCHUELER' and nachher->'zuletztAbgemeldet'->>'semester'='UEB-VOR' and nachher->'zuletztAbgemeldet'->>'grund'='BIN_RAUS' and nachher::text not like '%Lotte%';")" "1")"
LA_SEITE_NACH=$(curl -s "${BASIS}/verwaltung/teilnehmer" -H "Cookie: ${KEKS}")
pruefe "danach steht sie in der Teilnehmerliste, nicht mehr unter „Zuletzt abgemeldet“" \
  "$([ "$(enthaelt "$LA_SEITE_NACH" 'Letztesmal')" = "1" ] && [ "$(fehlt_in "$LA_SEITE_NACH" 'Letztesmal, Lotte')" = "1" ] && echo 1 || echo 0)"
LA_2=$(uebernimm -H "Cookie: ${KEKS}" -d "{\"personId\":\"${LOTTE_ID}\"}")
pruefe "ein zweites Mal: 409 „bereits zugeordnet“ — weiter genau eine Teilnahme" \
  "$([ "$LA_2" = "409" ] && grep -q 'bereits zugeordnet' /tmp/gbs-rumpf.txt && [ "$($PSQL "$LOTTE_TEILNAHMEN")" = "1" ] && echo 1 || echo 0)" "$LA_2 $(cat /tmp/gbs-rumpf.txt)"
LA_404=$(uebernimm -H "Cookie: ${KEKS}" -d "{\"personId\":\"$(neuer_token)\"}")
pruefe "eine unbekannte Person: 404" \
  "$([ "$LA_404" = "404" ] && grep -q 'Diese Person gibt es nicht' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$LA_404 $(cat /tmp/gbs-rumpf.txt)"
# Walter (Abschnitt 39) ist aktiv, hat aber keine Rolle Teilnehmer.
LA_ROLLE=$(uebernimm -H "Cookie: ${KEKS}" -d "{\"personId\":\"${W1_ID}\"}")
pruefe "eine aktive Person ohne Teilnehmerrolle: 409 „kein Teilnehmer“ — nichts angelegt" \
  "$([ "$LA_ROLLE" = "409" ] && grep -q 'kein Teilnehmer' /tmp/gbs-rumpf.txt && [ "$($PSQL "select count(*) from teilnahmen where \"personId\"='${W1_ID}';")" = "0" ] && echo 1 || echo 0)" "$LA_ROLLE $(cat /tmp/gbs-rumpf.txt)"

echo
echo "=== 42. Semesterueberleitung: Antwort aendern, Semesterpflege, verschobener Beginn ==="
# „bin raus" und die Antwort aendern — bis zum Vortag des Beginns frei.
RITA_ID=$($PSQL "insert into personen (id, vorname, nachname, email, \"statusCode\", \"erstelltAm\", \"aktualisiertAm\") values (gen_random_uuid(), 'Rita', 'Rueckmeldung', 'rita.rueckmeldung@beispiel.de', 'AKTIV', now(), now()) returning id;")
T_RITA=$(neuer_token)
RITA_TEILNAHME=$($PSQL "insert into teilnahmen (id, \"personId\", \"semesterId\", teilnahmeform, \"eingeladenAm\", \"bestaetigungTokenHash\", \"bestaetigungLaeuftAb\", \"erstelltAm\") values (gen_random_uuid(), '${RITA_ID}', '${TARGET_ID}', 'SCHUELER', now(), '$(hash_von "$T_RITA")', now() + interval '30 days', now()) returning id;")
RAUS=$(curl -s -X POST "${BASIS}/api/ueberleitung/bestaetigen" -H 'Content-Type: application/json' -d "{\"token\":\"${T_RITA}\",\"antwort\":\"raus\"}")
pruefe "„bin raus“ meldet die Teilnahme ab (abgemeldet)" "$(enthaelt "$RAUS" '"status":"abgemeldet"')" "$RAUS"
pruefe "abgemeldet mit Grund BIN_RAUS, ohne Zusage" \
  "$(gleich "$($PSQL "select \"abmeldeGrund\" || '|' || (\"bestaetigtAm\" is null) from teilnahmen where id='${RITA_TEILNAHME}' and \"abgemeldetAm\" is not null;")" "BIN_RAUS|true")"
RAUS2=$(curl -s -X POST "${BASIS}/api/ueberleitung/bestaetigen" -H 'Content-Type: application/json' -d "{\"token\":\"${T_RITA}\",\"antwort\":\"raus\"}")
pruefe "ein zweites „raus“ meldet schon_abgemeldet — ohne zweiten Protokolleintrag" \
  "$([ "$(enthaelt "$RAUS2" '"status":"schon_abgemeldet"')" = "1" ] && [ "$($PSQL "select count(*) from audit_log where aktion='TEILNAHME_ABGEMELDET' and \"objektId\"='${RITA_TEILNAHME}';")" = "1" ] && echo 1 || echo 0)" "$RAUS2"
DOCH=$(curl -s -X POST "${BASIS}/api/ueberleitung/bestaetigen" -H 'Content-Type: application/json' -d "{\"token\":\"${T_RITA}\",\"antwort\":\"dabei\"}")
pruefe "danach „dabei“ hebt die eigene Absage auf (ok, bestaetigt, nicht mehr abgemeldet)" \
  "$([ "$(enthaelt "$DOCH" '"status":"ok"')" = "1" ] && [ "$($PSQL "select \"abgemeldetAm\" is null and \"abmeldeGrund\" is null and \"bestaetigtAm\" is not null from teilnahmen where id='${RITA_TEILNAHME}';")" = "t" ] && echo 1 || echo 0)" "$DOCH"
OHNE_ANTWORT=$(curl -s -X POST "${BASIS}/api/ueberleitung/bestaetigen" -H 'Content-Type: application/json' -d "{\"token\":\"${T_RITA}\"}")
pruefe "ohne Antwort gilt weiter „dabei“ (schon_bestaetigt)" "$(enthaelt "$OHNE_ANTWORT" '"status":"schon_bestaetigt"')" "$OHNE_ANTWORT"
VIELLEICHT=$(status_von -X POST "${BASIS}/api/ueberleitung/bestaetigen" -H 'Content-Type: application/json' -d "{\"token\":\"${T_RITA}\",\"antwort\":\"vielleicht\"}")
pruefe "eine unbekannte Antwort ist 400" "$(gleich "$VIELLEICHT" "400")" "$VIELLEICHT"

# Semesterpflege: Lehrjahr/Halbjahr beim Anlegen und Aendern, Kuerzel fest.
PFLEGE_START=$(tag 200); PFLEGE_ENDE=$(tag 280)
PFLEGE=$(curl -s -X POST "${BASIS}/api/semester" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d "{\"code\":\"UEB-PFLEGE\",\"bezeichnung\":\"Pflegesemester\",\"start\":\"${PFLEGE_START}\",\"ende\":\"${PFLEGE_ENDE}\",\"lehrjahr\":3,\"halbjahr\":2}")
PFLEGE_ID=$(echo "$PFLEGE" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
pruefe "ein Semester im 3. Lehrjahr, Fruehling wird angelegt (3/2)" \
  "$(gleich "$($PSQL "select lehrjahr || '/' || halbjahr from semester where id='${PFLEGE_ID}';")" "3/2")" "$PFLEGE"
KUERZEL=$(rumpf_und_status -X PUT "${BASIS}/api/semester/${PFLEGE_ID}" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d "{\"code\":\"UEB-ANDERS\",\"bezeichnung\":\"Pflegesemester\",\"start\":\"${PFLEGE_START}\",\"ende\":\"${PFLEGE_ENDE}\"}")
pruefe "das Kuerzel laesst sich nicht aendern (400, feldgenau)" \
  "$([ "$KUERZEL" = "400" ] && grep -q '"feld":"code"' /tmp/gbs-rumpf.txt && grep -q 'nicht mehr ändern' /tmp/gbs-rumpf.txt && [ "$($PSQL "select code from semester where id='${PFLEGE_ID}';")" = "UEB-PFLEGE" ] && echo 1 || echo 0)" "$KUERZEL $(cat /tmp/gbs-rumpf.txt)"
PFLEGE_OHNE=$(status_von -X PUT "${BASIS}/api/semester/${PFLEGE_ID}" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d "{\"code\":\"UEB-PFLEGE\",\"bezeichnung\":\"Pflegesemester neu\",\"start\":\"${PFLEGE_START}\",\"ende\":\"${PFLEGE_ENDE}\"}")
pruefe "ein Aendern ohne Lehrjahr/Halbjahr laesst die Rasterverortung stehen (200, 3/2)" \
  "$([ "$PFLEGE_OHNE" = "200" ] && [ "$($PSQL "select lehrjahr || '/' || halbjahr from semester where id='${PFLEGE_ID}';")" = "3/2" ] && echo 1 || echo 0)" "$PFLEGE_OHNE"
PFLEGE_4=$(status_von -X PUT "${BASIS}/api/semester/${PFLEGE_ID}" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d "{\"code\":\"UEB-PFLEGE\",\"bezeichnung\":\"Pflegesemester\",\"start\":\"${PFLEGE_START}\",\"ende\":\"${PFLEGE_ENDE}\",\"lehrjahr\":4,\"halbjahr\":2}")
PFLEGE_HALB=$(status_von -X PUT "${BASIS}/api/semester/${PFLEGE_ID}" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d "{\"code\":\"UEB-PFLEGE\",\"bezeichnung\":\"Pflegesemester\",\"start\":\"${PFLEGE_START}\",\"ende\":\"${PFLEGE_ENDE}\",\"lehrjahr\":2}")
pruefe "Lehrjahr 4 bzw. Lehrjahr ohne Halbjahr wird abgewiesen (400/400)" \
  "$([ "$PFLEGE_4" = "400" ] && [ "$PFLEGE_HALB" = "400" ] && echo 1 || echo 0)" "${PFLEGE_4}/${PFLEGE_HALB}"
ZA_PFLEGE=$(rumpf_und_status -X POST "${BASIS}/api/zeugnisse/ausstellen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${PFLEGE_ID}\",\"typ\":\"ABSCHLUSS\"}")
pruefe "im so gepflegten letzten Rastersemester laeuft der Abschluss-Sammellauf (200)" \
  "$([ "$ZA_PFLEGE" = "200" ] && grep -q '"fehlgeschlagen":0' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$ZA_PFLEGE $(cat /tmp/gbs-rumpf.txt)"

# Verschobener Beginn: Die Links gelten bis Semesterstart und wandern mit.
VS_START=$(tag 20); VS_START_NEU=$(tag 27); VS_ENDE=$(tag 120)
VS=$(curl -s -X POST "${BASIS}/api/semester" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d "{\"code\":\"UEB-VERSCHUB\",\"bezeichnung\":\"Verschobener Beginn\",\"start\":\"${VS_START}\",\"ende\":\"${VS_ENDE}\"}")
VS_ID=$(echo "$VS" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
VS_P1=$($PSQL "insert into personen (id, vorname, nachname, email, \"statusCode\", \"erstelltAm\", \"aktualisiertAm\") values (gen_random_uuid(), 'Vroni', 'Verschub', 'vroni.verschub@beispiel.de', 'AKTIV', now(), now()) returning id;")
T3=$(neuer_token)
VS_T1=$($PSQL "insert into teilnahmen (id, \"personId\", \"semesterId\", teilnahmeform, \"eingeladenAm\", \"bestaetigungTokenHash\", \"bestaetigungLaeuftAb\", \"erstelltAm\") values (gen_random_uuid(), '${VS_P1}', '${VS_ID}', 'SCHUELER', now(), '$(hash_von "$T3")', '${VS_START}', now()) returning id;")
VS_PUT=$(status_von -X PUT "${BASIS}/api/semester/${VS_ID}" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d "{\"code\":\"UEB-VERSCHUB\",\"bezeichnung\":\"Verschobener Beginn\",\"start\":\"${VS_START_NEU}\",\"ende\":\"${VS_ENDE}\"}")
pruefe "der Beginn laesst sich nach hinten verschieben (200)" "$(gleich "$VS_PUT" "200")" "$VS_PUT"
pruefe "die Frist des offenen Links wandert mit (= neuer Beginn)" \
  "$(gleich "$($PSQL "select t.\"bestaetigungLaeuftAb\" = s.start from teilnahmen t join semester s on s.id = t.\"semesterId\" where t.id='${VS_T1}';")" "t")"
pruefe "das Protokoll nennt die Zahl der nachgezogenen Links (1)" \
  "$(gleich "$($PSQL "select nachher->>'linksNachgezogen' from audit_log where aktion='SEMESTER_GEAENDERT' and \"objektId\"='${VS_ID}' order by \"erstelltAm\" desc limit 1;")" "1")"
VS_DABEI=$(curl -s -X POST "${BASIS}/api/ueberleitung/bestaetigen" -H 'Content-Type: application/json' -d "{\"token\":\"${T3}\"}")
pruefe "der Link gilt weiter; die Frist ist der Vortag des neuen Beginns" \
  "$([ "$(enthaelt "$VS_DABEI" '"status":"ok"')" = "1" ] && [ "$(enthaelt "$VS_DABEI" "\"frist\":\"$(tag_de 26)\"")" = "1" ] && echo 1 || echo 0)" "$VS_DABEI"
VS_P2=$($PSQL "insert into personen (id, vorname, nachname, email, \"statusCode\", \"erstelltAm\", \"aktualisiertAm\") values (gen_random_uuid(), 'Volker', 'Verschub', 'volker.verschub@beispiel.de', 'AKTIV', now(), now()) returning id;")
$PSQL "insert into teilnahmen (id, \"personId\", \"semesterId\", teilnahmeform, \"eingeladenAm\", \"bestaetigungTokenHash\", \"bestaetigungLaeuftAb\", \"erstelltAm\") values (gen_random_uuid(), '${VS_P2}', '${VS_ID}', 'SCHUELER', now(), '$(hash_von "$(neuer_token)")', '${VS_START_NEU}', now());" > /dev/null
VS_HEUTE=$(rumpf_und_status -X PUT "${BASIS}/api/semester/${VS_ID}" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d "{\"code\":\"UEB-VERSCHUB\",\"bezeichnung\":\"Verschobener Beginn\",\"start\":\"${HEUTE}\",\"ende\":\"${VS_ENDE}\"}")
pruefe "ein Beginn heute schloesse offene Rueckmeldungen schlagartig — 409, feldgenau" \
  "$([ "$VS_HEUTE" = "409" ] && grep -q 'Rückmeldung' /tmp/gbs-rumpf.txt && grep -q '"feld":"start"' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$VS_HEUTE $(cat /tmp/gbs-rumpf.txt)"
pruefe "der Beginn bleibt dabei unveraendert" "$(gleich "$($PSQL "select start::text from semester where id='${VS_ID}';")" "$VS_START_NEU")"

# Einladung am oder nach einem Erinnerungsstichtag erledigt diese Stufen gleich
# mit — sonst ginge noch am selben Tag eine Erinnerung hinterher, deren frischer
# Link den der Einladung entwertete.
T7=$(curl -s -X POST "${BASIS}/api/semester" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d "{\"code\":\"UEB-T7\",\"bezeichnung\":\"Ueberleitung in einer Woche\",\"start\":\"$(tag 7)\",\"ende\":\"$(tag 90)\"}" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
UEBER_T7=$(curl -s -X POST "${BASIS}/api/semesterueberleitung/start" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${T7}\"}")
pruefe "Einladung an T-7: Stufen 1 und 2 erledigt, 3 offen" \
  "$(gleich "$($PSQL "select count(*) > 0 and bool_and(\"erinnertStufe1Am\" is not null and \"erinnertStufe2Am\" is not null and \"erinnertStufe3Am\" is null) from teilnahmen where \"semesterId\"='${T7}';")" "t")" "$UEBER_T7"
pruefe "das Protokoll nennt die erledigten Stufen [1, 2]" \
  "$(gleich "$($PSQL "select nachher->'erledigteStufen' = '[1, 2]'::jsonb from audit_log where aktion='SEMESTER_UEBERLEITUNG_GESTARTET' and \"objektId\"='${T7}';")" "t")"
pruefe "Absolventin und Verstorbene werden nicht eingeladen (nicht aktiv)" \
  "$(gleich "$($PSQL "select count(*) from teilnahmen where \"semesterId\"='${T7}' and \"personId\" in ('${ALMA_ID}','${W2_ID}');")" "0")"
T3SEM=$(curl -s -X POST "${BASIS}/api/semester" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d "{\"code\":\"UEB-T3\",\"bezeichnung\":\"Ueberleitung in drei Tagen\",\"start\":\"$(tag 3)\",\"ende\":\"$(tag 90)\"}" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
curl -s -o /dev/null -X POST "${BASIS}/api/semesterueberleitung/start" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${T3SEM}\"}"
pruefe "Einladung an T-3: alle drei Stufen erledigt" \
  "$(gleich "$($PSQL "select count(*) > 0 and bool_and(\"erinnertStufe1Am\" is not null and \"erinnertStufe2Am\" is not null and \"erinnertStufe3Am\" is not null) from teilnahmen where \"semesterId\"='${T3SEM}';")" "t")"

# Zwei gleichzeitige Starts (zwei Tabs, zwei Personen der Leitung) laden jeden
# genau einmal ein — und zaehlen niemanden doppelt.
PAR=$(curl -s -X POST "${BASIS}/api/semester" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d "{\"code\":\"UEB-PARALLEL\",\"bezeichnung\":\"Paralleler Start\",\"start\":\"$(tag 40)\",\"ende\":\"$(tag 130)\"}" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
curl -s -X POST "${BASIS}/api/semesterueberleitung/start" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${PAR}\"}" > /tmp/gbs-parallel-1.txt &
curl -s -X POST "${BASIS}/api/semesterueberleitung/start" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${PAR}\"}" > /tmp/gbs-parallel-2.txt &
wait
PAR1=$(sed -n 's/.*"eingeladen":\([0-9]*\).*/\1/p' /tmp/gbs-parallel-1.txt)
PAR2=$(sed -n 's/.*"eingeladen":\([0-9]*\).*/\1/p' /tmp/gbs-parallel-2.txt)
PAR_DB=$($PSQL "select count(*) from teilnahmen where \"semesterId\"='${PAR}' and \"eingeladenAm\" is not null;")
pruefe "zwei gleichzeitige Starts zaehlen zusammen genau die angelegten Einladungen" \
  "$([ -n "$PAR1" ] && [ -n "$PAR2" ] && [ "$PAR_DB" -gt 0 ] && [ $((PAR1 + PAR2)) -eq "$PAR_DB" ] && echo 1 || echo 0)" "${PAR1} + ${PAR2} / ${PAR_DB}"

echo
echo "=== 43. Anmeldungen: Antwortansicht, Zwischenstand, Fangfeld (M13) ==="
# Die Antworten einer Anmeldung sind lesbar — Art.-9-Antworten nur fuer die, die
# ueber die Aufnahme entscheiden, und nur bei wirksamer Einwilligung; die IBAN nie
# aus dem Antwortbogen; jeder Abruf im Protokoll, ohne Inhalte.
ANTW_SL=$(curl -s -o /tmp/gbs-antw.html -w '%{http_code}' "${BASIS}/verwaltung/anmeldungen/${ANMELDUNG_ID}" -H "Cookie: ${KEKS}")
ANTW_SL_HTML=$(cat /tmp/gbs-antw.html)
pruefe "die Schulleitung liest Petras Antworten (200: Art. 9, Zahlweise, Bank)" \
  "$([ "$ANTW_SL" = "200" ] && [ "$(enthaelt "$ANTW_SL_HTML" 'Ich moechte die Bibel besser verstehen')" = "1" ] && [ "$(enthaelt "$ANTW_SL_HTML" 'Halbjährlich')" = "1" ] && [ "$(enthaelt "$ANTW_SL_HTML" 'Sparkasse Minden-Luebbecke')" = "1" ] && echo 1 || echo 0)" "$ANTW_SL"
pruefe "keine Stelle der IBAN; stattdessen der Hinweis, wo sie liegt" \
  "$([ "$(fehlt_in "$ANTW_SL_HTML" 'DE89')" = "1" ] && [ "$(fehlt_in "$ANTW_SL_HTML" '0532 0130')" = "1" ] && [ "$(fehlt_in "$ANTW_SL_HTML" 'AT61')" = "1" ] && [ "$(enthaelt "$ANTW_SL_HTML" 'Wird hier nicht angezeigt')" = "1" ] && [ "$(fehlt_in "$ANTW_SL_HTML" 'Nicht im Antwortbogen gespeichert')" = "1" ] && echo 1 || echo 0)"
pruefe "der Abruf steht im Protokoll — Art. 9 angezeigt, ohne Inhalte und Namen" \
  "$(gleich "$($PSQL "select nachher::text like '%\"art9Angezeigt\": true%' and nachher::text not like '%Bibel%' and nachher::text not like '%Petra%' and nachher::text not like '%Halbj%' from audit_log where aktion='ANMELDUNG_ANTWORTEN_ANGESEHEN' and \"objektId\"='${ANMELDUNG_ID}' and \"akteurId\"='${SCHULLEITER_ID}' order by \"erstelltAm\" desc limit 1;")" "t")"
ANTW_V=$(curl -s -o /tmp/gbs-antw-v.html -w '%{http_code}' "${BASIS}/verwaltung/anmeldungen/${ANMELDUNG_ID}" -H "Cookie: ${KEKS_V}")
ANTW_V_HTML=$(cat /tmp/gbs-antw-v.html)
pruefe "die Verwaltung sieht Zahlweise und den abgesicherten IBAN-Weg (200)" \
  "$([ "$ANTW_V" = "200" ] && [ "$(enthaelt "$ANTW_V_HTML" 'Halbjährlich')" = "1" ] && [ "$(enthaelt "$ANTW_V_HTML" 'vollständig anzeigen')" = "1" ] && echo 1 || echo 0)" "$ANTW_V"
pruefe "aber keine Art.-9-Antworten (ausgeblendet) und keine IBAN" \
  "$([ "$(enthaelt "$ANTW_V_HTML" 'ausgeblendet')" = "1" ] && [ "$(fehlt_in "$ANTW_V_HTML" 'Bibel besser verstehen')" = "1" ] && [ "$(fehlt_in "$ANTW_V_HTML" 'DE89')" = "1" ] && echo 1 || echo 0)"
pruefe "ihr Abruf steht mit art9Angezeigt=false im Protokoll" \
  "$(gleich "$($PSQL "select nachher::text like '%\"art9Angezeigt\": false%' from audit_log where aktion='ANMELDUNG_ANTWORTEN_ANGESEHEN' and \"akteurId\"='${VERWALTUNG_ID}' order by \"erstelltAm\" desc limit 1;")" "t")"
ANTW_ADMIN=$(status_von "${BASIS}/verwaltung/anmeldungen/${ANMELDUNG_ID}" -H "Cookie: ${KEKS_ADMIN}")
ANTW_OHNE=$(status_von "${BASIS}/verwaltung/anmeldungen/${ANMELDUNG_ID}")
pruefe "Administrator (ohne Anmelderecht) und ohne Sitzung: weggeleitet (307/307)" \
  "$([ "$ANTW_ADMIN" = "307" ] && [ "$ANTW_OHNE" = "307" ] && echo 1 || echo 0)" "${ANTW_ADMIN}/${ANTW_OHNE}"
ENTWURF_ANM=$($PSQL "select id from anmeldungen where status='ENTWURF' limit 1;")
ANTW_404=$(status_von "${BASIS}/verwaltung/anmeldungen/$(neuer_token)" -H "Cookie: ${KEKS}")
ANTW_ENTWURF=$(status_von "${BASIS}/verwaltung/anmeldungen/${ENTWURF_ANM}" -H "Cookie: ${KEKS}")
pruefe "eine unbekannte Anmeldung und ein Entwurf sind 404/404" \
  "$([ "$ANTW_404" = "404" ] && [ "$ANTW_ENTWURF" = "404" ] && echo 1 || echo 0)" "${ANTW_404}/${ANTW_ENTWURF}"
GERD_ANM=$($PSQL "select id from anmeldungen where \"personId\"='${FREI_ID}';")
GERD_HTML=$(curl -s "${BASIS}/verwaltung/anmeldungen/${GERD_ANM}" -H "Cookie: ${KEKS}")
pruefe "ohne wirksame Einwilligung (Gerd) bleiben die Art.-9-Fragen auch fuer die Schulleitung ausgeblendet" \
  "$([ "$(enthaelt "$GERD_HTML" 'keine wirksame Einwilligung')" = "1" ] && [ "$(enthaelt "$GERD_HTML" 'Fragen dieses Abschnitts sind ausgeblendet')" = "1" ] && [ "$(fehlt_in "$GERD_HTML" 'Antworten sind ausgeblendet')" = "1" ] && echo 1 || echo 0)"
# Seit dem Oberflächenplan (09/2026) zeigt die Liste standardmäßig „Offen“; Petras
# Anmeldung ist entschieden. Der Link zur Akte und der Bankhinweis stehen in der
# Einzelansicht (Antwortansicht).
LISTE_ANM=$(curl -s "${BASIS}/verwaltung/anmeldungen?ansicht=entschieden" -H "Cookie: ${KEKS}")
pruefe "die Anmeldeliste (Entschieden) verlinkt die Antwortansicht, die Antwortansicht die Akte" \
  "$([ "$(enthaelt "$LISTE_ANM" "/verwaltung/anmeldungen/${ANMELDUNG_ID}")" = "1" ] && [ "$(enthaelt "$ANTW_SL_HTML" "/verwaltung/personen/${TEILNEHMER_ID}")" = "1" ] && echo 1 || echo 0)"
pruefe "die Verwaltung sieht in der Antwortansicht nur „hinterlegt“ — keine Schein-Maske" \
  "$([ "$(enthaelt "$ANTW_V_HTML" 'hinterlegt')" = "1" ] && [ "$(enthaelt "$ANTW_V_HTML" 'vollständig anzeigen')" = "1" ] && [ "$(fehlt_in "$ANTW_V_HTML" '•••• •••• XXXX')" = "1" ] && echo 1 || echo 0)"

# Zwischenstand: Der Token steht im URL-Fragment und kommt im Rumpf — als
# ?fortsetzen=… stand er in jedem Zugriffslog des Proxys. Gespeichert wird ohne
# Art.-9-Freitexte und ohne IBAN.
ZS_SPEICHERN=$(curl -s -X POST "${BASIS}/api/anmeldung" -H 'Content-Type: application/json' -H 'X-Real-Ip: 203.0.113.63' \
  -d "{\"aktion\":\"speichern\",\"versionId\":\"${VERSION_ID}\",\"antworten\":{\"vorname\":\"Zora\",\"motivation\":\"Nur zum Test\",\"iban\":\"DE89 3704 0044 0532 0130 00\"}}")
ZS_TOKEN=$(echo "$ZS_SPEICHERN" | sed -n 's/.*"fortsetzenToken":"\([^"]*\)".*/\1/p')
pruefe "ein Zwischenstand wird gespeichert (Fortsetzen-Token)" "$([ -n "$ZS_TOKEN" ] && echo 1 || echo 0)" "$ZS_SPEICHERN"
ZS_SEITE=$(curl -s -o /tmp/gbs-zs.html -w '%{http_code}' "${BASIS}/anmeldung?fortsetzen=${ZS_TOKEN}")
pruefe "die Seite laedt aus der Adresse nichts mehr (200, ohne den Zwischenstand)" \
  "$([ "$ZS_SEITE" = "200" ] && [ "$(fehlt_in "$(cat /tmp/gbs-zs.html)" 'Zora')" = "1" ] && echo 1 || echo 0)" "$ZS_SEITE"
ZS_LADEN=$(curl -s -w '\n%{http_code}' -X POST "${BASIS}/api/anmeldung" -H 'Content-Type: application/json' -H 'X-Real-Ip: 203.0.113.64' \
  -d "{\"aktion\":\"laden\",\"fortsetzenToken\":\"${ZS_TOKEN}\"}")
pruefe "geladen wird per POST mit dem Token im Rumpf (200, Vorname)" \
  "$([ "$(echo "$ZS_LADEN" | tail -1)" = "200" ] && [ "$(enthaelt "$ZS_LADEN" '"vorname":"Zora"')" = "1" ] && echo 1 || echo 0)" "$ZS_LADEN"
pruefe "Art.-9-Freitext und IBAN stehen weder in der Antwort noch im gespeicherten Entwurf" \
  "$([ "$(fehlt_in "$ZS_LADEN" 'Nur zum Test')" = "1" ] && [ "$(fehlt_in "$ZS_LADEN" 'DE89')" = "1" ] && [ "$($PSQL "select antworten::text like '%Zora%' and antworten::text not like '%Nur zum Test%' and antworten::text not like '%DE89%' from anmeldungen where \"fortsetzenTokenHash\"='$(hash_von "$ZS_TOKEN")';")" = "t" ] && echo 1 || echo 0)"
ZS_404=$(curl -s -w '\n%{http_code}' -X POST "${BASIS}/api/anmeldung" -H 'Content-Type: application/json' -H 'X-Real-Ip: 203.0.113.64' \
  -d "{\"aktion\":\"laden\",\"fortsetzenToken\":\"$(neuer_token)\"}")
pruefe "ein unbekannter Token: 404 (abgelaufen oder ungueltig)" \
  "$([ "$(echo "$ZS_404" | tail -1)" = "404" ] && [ "$(enthaelt "$ZS_404" 'abgelaufen oder ungültig')" = "1" ] && echo 1 || echo 0)" "$ZS_404"
ZS_400=$(status_von -X POST "${BASIS}/api/anmeldung" -H 'Content-Type: application/json' -H 'X-Real-Ip: 203.0.113.64' -d '{"aktion":"laden","fortsetzenToken":"kein-token"}')
pruefe "ein Token ohne gueltiges Format: 400" "$(gleich "$ZS_400" "400")" "$ZS_400"

# Fangfeld: Wer das fuer Menschen unsichtbare Feld fuellt, ist ein Roboter —
# gleiche Antwort, aber keine Akte, keine Mail.
FALLE=$(curl -s -X POST "${BASIS}/api/anmeldung" -H 'Content-Type: application/json' -H 'X-Real-Ip: 203.0.113.62' \
  -d "$(anmeldung_rumpf "Fiona" "Fangfeld" "falle@beispiel.de" "1991-01-01" "x")")
pruefe "ein gefuelltes Fangfeld bekommt dieselbe Antwort (eingereicht)" "$(enthaelt "$FALLE" 'eingereicht')" "$FALLE"
pruefe "aber es entsteht weder eine Akte noch eine Mail" \
  "$(gleich "$($PSQL "select (select count(*) from personen where email='falle@beispiel.de') + (select count(*) from email_versand where empfaenger='falle@beispiel.de');")" "0")"
pruefe "der verworfene Versuch steht ohne Inhalt im Protokoll" \
  "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='ANMELDUNG_VERWORFEN_FANGFELD' and nachher is null;")" "t")"
FALLE2=$(curl -s -X POST "${BASIS}/api/anmeldung" -H 'Content-Type: application/json' -H 'X-Real-Ip: 203.0.113.62' \
  -d "$(anmeldung_rumpf "Fiona" "Fangfeld" "falle@beispiel.de" "1991-01-01" "")")
pruefe "Gegenprobe: mit leerem Fangfeld entsteht die Akte" \
  "$([ "$(enthaelt "$FALLE2" 'eingereicht')" = "1" ] && [ "$($PSQL "select count(*) from personen where email='falle@beispiel.de';")" = "1" ] && echo 1 || echo 0)" "$FALLE2"
FIONA_ID=$($PSQL "select id from personen where email='falle@beispiel.de';")
FORMULAR_HTML=$(curl -s "${BASIS}/anmeldung")
pruefe "das oeffentliche Formular enthaelt das Fangfeld (id=\"hp_feld\", kein Autofill-Name)" \
  "$([ "$(enthaelt "$FORMULAR_HTML" 'id="hp_feld"')" = "1" ] && [ "$(fehlt_in "$FORMULAR_HTML" 'id="website"')" = "1" ] && echo 1 || echo 0)"
pruefe "Pflichtangaben sind fuer Vorlesesoftware als Text benannt, nicht per aria-label" \
  "$([ "$(enthaelt "$FORMULAR_HTML" '(Pflichtangabe)')" = "1" ] && [ "$(fehlt_in "$FORMULAR_HTML" 'aria-label="Pflichtangabe"')" = "1" ] && echo 1 || echo 0)"
pruefe "der Hinweis auf die Pflichtangaben steht genau einmal" \
  "$(gleich "$(echo "$FORMULAR_HTML" | grep -o 'gekennzeichnete Felder sind Pflichtangaben' | wc -l | tr -d ' ')" "1")"

# Widerruf: Die juengste Einwilligungszeile zaehlt. Danach sind Petras
# Art.-9-Antworten auch fuer die Schulleitung ausgeblendet. Petra hat Fassung 2
# bestaetigt, der Widerruf zeigt bewusst auf Fassung 1: Gewertet wird je Code
# ueber alle Fassungen (`art9EinwilligungenWirksam`), nicht je Fassung.
$PSQL "insert into einwilligungen (id, \"personId\", \"textId\", erteilt, zeitpunkt) values (gen_random_uuid(), '${TEILNEHMER_ID}', (select id from einwilligungs_texte where code='GLAUBENSANGABEN' and version=1), false, now() + interval '1 second');" > /dev/null
WIDERRUF_HTML=$(curl -s "${BASIS}/verwaltung/anmeldungen/${ANMELDUNG_ID}" -H "Cookie: ${KEKS}")
pruefe "nach dem Widerruf sind Petras Art.-9-Antworten ausgeblendet (keine wirksame Einwilligung)" \
  "$([ "$(fehlt_in "$WIDERRUF_HTML" 'Bibel besser verstehen')" = "1" ] && [ "$(enthaelt "$WIDERRUF_HTML" 'keine wirksame Einwilligung')" = "1" ] && echo 1 || echo 0)"

echo
echo "=== 44. Personen-Detailakte: Noten nur fuer die Schulleitung ==="
# Noten und Zeugnisse sind eine paedagogische Sicht (NOTEN_VERWALTEN), Status
# und Ausbildungsdaten liegen bei der Schulleitung (PERSON_STATUS_WECHSELN).
AKTE_SL=$(curl -s -o /tmp/gbs-akte.html -w '%{http_code}' "${BASIS}/verwaltung/personen/${TEILNEHMER_ID}" -H "Cookie: ${KEKS}")
AKTE_SL_HTML=$(cat /tmp/gbs-akte.html)
pruefe "die Schulleitung sieht in der Akte Noten und Zeugnisse (200)" \
  "$([ "$AKTE_SL" = "200" ] && [ "$(enthaelt "$AKTE_SL_HTML" '>Noten</h2>')" = "1" ] && [ "$(enthaelt "$AKTE_SL_HTML" 'Zeugnisse &amp; Bescheinigungen')" = "1" ] && echo 1 || echo 0)" "$AKTE_SL"
pruefe "und den Block Ausbildungsdaten & Status" "$(enthaelt "$AKTE_SL_HTML" "id=\"ausbildung-${TEILNEHMER_ID}\"")"
AKTE_V=$(curl -s -o /tmp/gbs-akte-v.html -w '%{http_code}' "${BASIS}/verwaltung/personen/${TEILNEHMER_ID}" -H "Cookie: ${KEKS_V}")
AKTE_V_HTML=$(cat /tmp/gbs-akte-v.html)
pruefe "die Verwaltung sieht die Akte ohne Noten, Zeugnisse und Ausbildungsdaten (200)" \
  "$([ "$AKTE_V" = "200" ] && [ "$(fehlt_in "$AKTE_V_HTML" '>Noten</h2>')" = "1" ] && [ "$(fehlt_in "$AKTE_V_HTML" 'Zeugnisse &amp; Bescheinigungen')" = "1" ] && [ "$(fehlt_in "$AKTE_V_HTML" "id=\"ausbildung-${TEILNEHMER_ID}\"")" = "1" ] && echo 1 || echo 0)" "$AKTE_V"
AKTE_ADMIN_HTML=$(curl -s "${BASIS}/verwaltung/personen/${TEILNEHMER_ID}" -H "Cookie: ${KEKS_ADMIN}")
pruefe "der Administrator ebenso ohne Noten und Zeugnisse" \
  "$([ "$(fehlt_in "$AKTE_ADMIN_HTML" '>Noten</h2>')" = "1" ] && [ "$(fehlt_in "$AKTE_ADMIN_HTML" 'Zeugnisse &amp; Bescheinigungen')" = "1" ] && echo 1 || echo 0)"
AKTE_TN=$(status_von "${BASIS}/verwaltung/personen/${TEILNEHMER_ID}" -H "Cookie: ${KEKS2}")
pruefe "ein Teilnehmer wird von der Akte weggeleitet (307)" "$(gleich "$AKTE_TN" "307")" "$AKTE_TN"
LISTE_P_SL=$(curl -s "${BASIS}/verwaltung/personen" -H "Cookie: ${KEKS}")
LISTE_P_V=$(curl -s "${BASIS}/verwaltung/personen" -H "Cookie: ${KEKS_V}")
pruefe "die Personenliste zeigt die Notenspalte nur der Schulleitung" \
  "$([ "$(enthaelt "$LISTE_P_SL" 'Noten (bestanden)')" = "1" ] && [ "$(fehlt_in "$LISTE_P_V" 'Noten (bestanden)')" = "1" ] && echo 1 || echo 0)"
pruefe "die Anwesenheitsspalte urteilt nicht mehr pauschal „unter Soll“" "$(fehlt_in "$LISTE_P_SL" 'unter Soll')"
AKTE_HANS=$(curl -s "${BASIS}/verwaltung/personen/${HOERER_ID}" -H "Cookie: ${KEKS}")
pruefe "die Akte eines Hoerers sagt, warum er nicht benotet wird (nicht: nicht eingeschrieben)" \
  "$([ "$(enthaelt "$AKTE_HANS" 'Hörer werden nicht benotet')" = "1" ] && [ "$(fehlt_in "$AKTE_HANS" 'nicht eingeschrieben')" = "1" ] && echo 1 || echo 0)"

echo
echo "=== 45. Anonymisierung Ende-zu-Ende: Sitzung, Zeugnis, Versandprotokoll, offene Anmeldung ==="
# Tilda: aufgenommen, mit Sitzung, Zeugnis, einer alten Verwaltungsmail mit
# ihrem Namen im Betreff, einem Fehlertext mit ihrer Adresse und Drosselzeilen.
TILDA=$(curl -s -X POST "${BASIS}/api/anmeldung" -H 'Content-Type: application/json' -H 'X-Real-Ip: 203.0.113.60' \
  -d "$(anmeldung_rumpf "Tilda" "Tilgung" "tilda.tilgung@beispiel.de" "1980-12-24")")
TILDA_ID=$($PSQL "select id from personen where email='tilda.tilgung@beispiel.de';")
TILDA_ANM=$($PSQL "select id from anmeldungen where \"personId\"='${TILDA_ID}';")
TILDA_AUFNAHME=$(status_von -X POST "${BASIS}/api/anmeldungen/${TILDA_ANM}/entscheiden" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"entscheidung":"ANNEHMEN"}')
pruefe "Tilda meldet sich an und wird aufgenommen (Teilnahme in 2099-H)" \
  "$([ "$(enthaelt "$TILDA" 'eingereicht')" = "1" ] && [ "$TILDA_AUFNAHME" = "200" ] && [ "$($PSQL "select count(*) from teilnahmen where \"personId\"='${TILDA_ID}' and \"semesterId\"='${SEMESTER_ID}';")" = "1" ] && echo 1 || echo 0)" "$TILDA_AUFNAHME $TILDA"
KEKS_T=$(anmelden_als "$TILDA_ID")
curl -s -o /dev/null -X POST "${BASIS}/api/zeugnisse/ausstellen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d "{\"semesterId\":\"${SEMESTER_ID}\",\"typ\":\"SEMESTER\",\"personId\":\"${TILDA_ID}\"}"
Z_T=$($PSQL "select id from zeugnisse where \"personId\"='${TILDA_ID}' and status='GUELTIG';")
Z_T_BELEG=$($PSQL "select \"belegNr\" from zeugnisse where id='${Z_T}';")
pruefe "vorher: Sitzung, Rolle und ein Zeugnis mit Name und Geburtsdatum" \
  "$([ -n "$KEKS_T" ] && [ "$($PSQL "select count(*) from person_rolle where \"personId\"='${TILDA_ID}';")" -ge 1 ] && [ "$($PSQL "select snapshot::text like '%Tilgung%' and snapshot::text like '%24.12.1980%' from zeugnisse where id='${Z_T}';")" = "t" ] && echo 1 || echo 0)"
$PSQL "insert into email_versand (id, \"personId\", empfaenger, betreff, status, fehler, \"erstelltAm\") values (gen_random_uuid(), '${SCHULLEITER_ID}', 'leiter@beispiel.de', 'Neue Anmeldung: Tilda Tilgung', 'GESENDET', null, now()), (gen_random_uuid(), null, 'postmaster@beispiel.de', 'Zustellbericht', 'FEHLER', '550 5.1.1 <tilda.tilgung@beispiel.de>: Recipient address rejected', now());" > /dev/null
$PSQL "insert into rate_limit (id, schluessel, zeitpunkt) values (gen_random_uuid(), 'MAGIC_LINK:tilda.tilgung@beispiel.de', now()), (gen_random_uuid(), 'PASSWORT:tilda.tilgung@beispiel.de', now());" > /dev/null
ANON_T=$(rumpf_und_status -X POST "${BASIS}/api/personen/${TILDA_ID}/anonymisieren" -H "Cookie: ${KEKS}")
pruefe "die Anonymisierung laeuft ueber den Anwendungsnutzer durch (200, 1 Zeugnis)" \
  "$([ "$ANON_T" = "200" ] && grep -q '"zeugnisse":1' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$ANON_T $(cat /tmp/gbs-rumpf.txt)"
# Fachentscheidung 27.09.2026: Ausgestellte Zeugnisse bleiben als Nachweis, ohne
# Name und Geburtsdatum. Der Trigger laesst genau diesen Eingriff zu.
pruefe "das Zeugnis bleibt gueltig mit Beleg-Nr — aber ohne Name und Geburtsdatum" \
  "$(gleich "$($PSQL "select snapshot->'person'->>'name' = '[anonymisiert]' and snapshot->'person'->>'geburtsdatum' is null and snapshot::text not like '%Tilgung%' and snapshot::text not like '%24.12.1980%' and \"belegNr\" = '${Z_T_BELEG}' and status = 'GUELTIG' from zeugnisse where id='${Z_T}';")" "t")"
pruefe "Betreff, Empfaenger und Fehlertext im Versandprotokoll nennen sie nicht mehr" \
  "$(gleich "$($PSQL "select count(*) from email_versand where (betreff || ' ' || empfaenger || ' ' || coalesce(fehler,'')) ilike any (array['%Tilgung%','%tilda.tilgung@%']);")" "0")"
pruefe "die Zeilen selbst bleiben als Betriebsspur (Platzhalter)" \
  "$(gleich "$($PSQL "select count(*) >= 2 from email_versand where betreff = '[anonymisiert]' or fehler = '[anonymisiert]';")" "t")"
pruefe "ihre Drosselzeilen (Adresse im Schluessel) sind geloescht" \
  "$(gleich "$($PSQL "select count(*) from rate_limit where schluessel ilike '%tilda.tilgung@%';")" "0")"
pruefe "Rollen entfernt, Passwortstand frisch, Statuswechsel festgehalten" \
  "$(gleich "$($PSQL "select (select count(*) from person_rolle where \"personId\"='${TILDA_ID}') = 0 and (select \"passwortGeaendertAm\" > now() - interval '5 minutes' from personen where id='${TILDA_ID}') and (select count(*) from status_wechsel where \"personId\"='${TILDA_ID}' and \"nachCode\"='ANONYMISIERT') = 1;")" "t")"
T_SEITE=$(status_von "${BASIS}/meine-daten" -H "Cookie: ${KEKS_T}")
T_PUT=$(status_von -X PUT "${BASIS}/api/meine-daten" -H "Cookie: ${KEKS_T}" -H 'Content-Type: application/json' -d '{"ort":"Irgendwo"}')
pruefe "ihre alte Sitzung fuehrt nirgends mehr hin (Akte 307, Schreiben 401)" \
  "$([ "$T_SEITE" = "307" ] && [ "$T_PUT" = "401" ] && echo 1 || echo 0)" "${T_SEITE}/${T_PUT}"
T_PDF=$(status_von "${BASIS}/api/zeugnisse/${Z_T}/pdf" -H "Cookie: ${KEKS_T}")
T_PDF_SL=$(status_von "${BASIS}/api/zeugnisse/${Z_T}/pdf" -H "Cookie: ${KEKS}")
pruefe "ihr Zeugnis-PDF: fuer die alte Sitzung 401, fuer die Schulleitung weiter 200" \
  "$([ "$T_PDF" = "401" ] && [ "$T_PDF_SL" = "200" ] && echo 1 || echo 0)" "${T_PDF}/${T_PDF_SL}"
T_NEU=$(rumpf_und_status -X POST "${BASIS}/api/zeugnisse/ausstellen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d "{\"semesterId\":\"${SEMESTER_ID}\",\"typ\":\"SEMESTER\",\"personId\":\"${TILDA_ID}\"}")
pruefe "keine Neuausstellung fuer sie (409, „anonymisiert“)" \
  "$([ "$T_NEU" = "409" ] && grep -q 'anonymisiert' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$T_NEU"
T_STAMM=$(status_von -X PUT "${BASIS}/api/personen/${TILDA_ID}/stammdaten" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"vorname":"Tilda","nachname":"Neu"}')
T_MAIL=$(status_von -X PUT "${BASIS}/api/personen/${TILDA_ID}/email" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"email":"tilda.neu@beispiel.de"}')
T_ROLLEN=$(status_von -X PUT "${BASIS}/api/personen/${TILDA_ID}/rollen" -H "Cookie: ${KEKS_ADMIN}" -H 'Content-Type: application/json' -d '{"rollen":["TEILNEHMER"]}')
T_STATUS=$(status_von -X POST "${BASIS}/api/personen/${TILDA_ID}/status" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"nachCode":"AKTIV"}')
T_AUSK=$(status_von -X POST "${BASIS}/api/personen/${TILDA_ID}/auskunft" -H "Cookie: ${KEKS}")
pruefe "alle Schreibwege sind fuer sie geschlossen (Stammdaten, Adresse, Rollen, Status, Auskunft: 409)" \
  "$([ "$T_STAMM" = "409" ] && [ "$T_MAIL" = "409" ] && [ "$T_ROLLEN" = "409" ] && [ "$T_STATUS" = "409" ] && [ "$T_AUSK" = "409" ] && echo 1 || echo 0)" "${T_STAMM}/${T_MAIL}/${T_ROLLEN}/${T_STATUS}/${T_AUSK}"

# Bruno: nur eine eingereichte Anmeldung. Die Anonymisierung schliesst sie —
# sonst stuende sie weiter in der Arbeitsliste, und „Annehmen" hoebe den
# Endzustand wieder auf (M7).
BRUNO=$(curl -s -X POST "${BASIS}/api/anmeldung" -H 'Content-Type: application/json' -H 'X-Real-Ip: 203.0.113.61' \
  -d "$(anmeldung_rumpf "Bruno" "Bewerber" "bruno.bewerber@beispiel.de" "1985-06-15")")
BRUNO_ID=$($PSQL "select id from personen where email='bruno.bewerber@beispiel.de';")
BRUNO_ANM=$($PSQL "select id from anmeldungen where \"personId\"='${BRUNO_ID}';")
ANON_B=$(status_von -X POST "${BASIS}/api/personen/${BRUNO_ID}/anonymisieren" -H "Cookie: ${KEKS}")
pruefe "eine Person mit offener Anmeldung wird anonymisiert (200)" \
  "$([ "$(enthaelt "$BRUNO" 'eingereicht')" = "1" ] && [ "$ANON_B" = "200" ] && echo 1 || echo 0)" "$ANON_B $BRUNO"
pruefe "ihre Anmeldung ist damit geschlossen (ABGELEHNT, Grund [anonymisiert], entschieden)" \
  "$(gleich "$($PSQL "select status || '|' || coalesce(ablehnungsgrund,'') || '|' || (\"entschiedenAm\" is not null) from anmeldungen where id='${BRUNO_ANM}';")" "ABGELEHNT|[anonymisiert]|true")"
B_ANNEHMEN=$(status_von -X POST "${BASIS}/api/anmeldungen/${BRUNO_ANM}/entscheiden" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"entscheidung":"ANNEHMEN"}')
pruefe "annehmen laesst sie sich nicht mehr (409) — keine Teilnahme, keine Willkommensmail" \
  "$([ "$B_ANNEHMEN" = "409" ] && [ "$($PSQL "select (select count(*) from teilnahmen where \"personId\"='${BRUNO_ID}') + (select count(*) from email_versand where \"personId\"='${BRUNO_ID}' and \"vorlageCode\"='ANMELDUNG_ANGENOMMEN');")" = "0" ] && echo 1 || echo 0)" "$B_ANNEHMEN"
LISTE_NACH_ANON=$(curl -s "${BASIS}/verwaltung/anmeldungen?ansicht=entschieden" -H "Cookie: ${KEKS}")
pruefe "die Anmeldeliste fuehrt Anmeldungen Anonymisierter nicht mehr" \
  "$([ "$(fehlt_in "$LISTE_NACH_ANON" "${BRUNO_ANM}")" = "1" ] && [ "$(fehlt_in "$LISTE_NACH_ANON" "${TILDA_ANM}")" = "1" ] && echo 1 || echo 0)"

# Endzustand vor der Entscheidung: Fiona (Abschnitt 43) wird ausgeschlossen,
# bevor ueber ihre Anmeldung entschieden ist. Aufnehmen geht dann nicht mehr,
# ablehnen schon.
$PSQL "update personen set \"statusCode\"='AUSGESCHLOSSEN' where id='${FIONA_ID}';" > /dev/null
FIONA_ANM=$($PSQL "select id from anmeldungen where \"personId\"='${FIONA_ID}';")
F_ANNEHMEN=$(status_von -X POST "${BASIS}/api/anmeldungen/${FIONA_ANM}/entscheiden" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"entscheidung":"ANNEHMEN"}')
F_ABLEHNEN=$(status_von -X POST "${BASIS}/api/anmeldungen/${FIONA_ANM}/entscheiden" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"entscheidung":"ABLEHNEN","grund":"Ausgeschlossen"}')
pruefe "eine ausgeschlossene Person wird nicht aufgenommen (409), ablehnen geht (200)" \
  "$([ "$F_ANNEHMEN" = "409" ] && [ "$F_ABLEHNEN" = "200" ] && echo 1 || echo 0)" "${F_ANNEHMEN}/${F_ABLEHNEN}"

echo
echo "=== 46. Formular-Builder: gespeicherte Zuordnung, Beschriftungen, Art. 9 (M15, M17) ==="
ENTWURF_ANTWORT=$(curl -s -X POST "${BASIS}/api/formulare/entwurf" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"formularCode":"ANMELDUNG"}')
ENTWURF_ID=$(echo "$ENTWURF_ANTWORT" | sed -n 's/.*"versionId":"\([^"]*\)".*/\1/p')
pruefe "ein Entwurf des Anmeldeformulars entsteht" "$([ -n "$ENTWURF_ID" ] && echo 1 || echo 0)" "$ENTWURF_ANTWORT"
BUILDER_V=$(curl -s "${BASIS}/verwaltung/formulare/${VERSION_ID}" -H "Cookie: ${KEKS}")
BUILDER_E=$(curl -s "${BASIS}/verwaltung/formulare/${ENTWURF_ID}" -H "Cookie: ${KEKS}")
# M17: Die Auswahl „Schueler/Hoerer" zeigte die gespeicherte Zuordnung nicht an —
# wer speicherte, ohne neu zu waehlen, verlor sie.
pruefe "die gespeicherte Zuordnung ist vorbelegt — je einmal Schueler und Hoerer (Fassung und Entwurf)" \
  "$([ "$(echo "$BUILDER_V" | grep -o 'value="SCHUELER" selected=""' | wc -l | tr -d ' ')" = "1" ] && [ "$(echo "$BUILDER_V" | grep -o 'value="HOERER" selected=""' | wc -l | tr -d ' ')" = "1" ] && [ "$(echo "$BUILDER_E" | grep -o 'value="SCHUELER" selected=""' | wc -l | tr -d ' ')" = "1" ] && [ "$(echo "$BUILDER_E" | grep -o 'value="HOERER" selected=""' | wc -l | tr -d ' ')" = "1" ] && echo 1 || echo 0)"
# M15: Beschriftungen gehoeren zu ihren Feldern; die IDs haengen an der Position,
# nicht am (aenderbaren, evtl. leerzeichenhaltigen) Schluessel.
pruefe "Beschriftungen gehoeren zu ihren Feldern (id/for builder-a0-titel)" \
  "$([ "$(enthaelt "$BUILDER_E" 'id="builder-a0-titel"')" = "1" ] && [ "$(enthaelt "$BUILDER_E" 'for="builder-a0-titel"')" = "1" ] && echo 1 || echo 0)"
pruefe "keine ID mit Leerzeichen, keine aus dem Feldschluessel" \
  "$([ -n "$BUILDER_E" ] && ! echo "$BUILDER_E" | grep -qE 'id="builder-[^"]* [^"]*"' && [ "$(fehlt_in "$BUILDER_E" 'id="builder-teilnahmeform-')" = "1" ] && echo 1 || echo 0)"
pruefe "Abschnitts-Bedienelemente sind benannt (Beschreibung, Loeschen)" \
  "$([ "$(enthaelt "$BUILDER_E" 'aria-label="Abschnitt 1, Beschreibung (optional)"')" = "1" ] && [ "$(enthaelt "$BUILDER_E" 'aria-label="Abschnitt 1 löschen"')" = "1" ] && echo 1 || echo 0)"

# Der PUT-Rumpf entsteht aus der gespeicherten Fassung — genau so, wie ihn der
# Builder schickt (teilnahmeformZuordnung = validierung.teilnahmeform).
# $2/$3/$4 sind SQL-Ausdruecke fuer Zuordnung, Optionen und istArt9 je Feld f;
# Zeichenketten darin in Dollar-Quotes, damit sie hier in einfachen Anfuehrungs-
# zeichen stehen koennen.
builder_rumpf() { # $1 = versionId
  $PSQL "select json_build_object('einleitung', v.einleitung, 'abschnitte', (
      select json_agg(json_build_object('titel', a.titel, 'beschreibung', a.beschreibung, 'felder', (
        select coalesce(json_agg(json_build_object('code', f.code, 'typ', f.typ, 'label', f.label,
          'hilfetext', f.hilfetext, 'platzhalter', f.platzhalter, 'pflicht', f.pflicht, 'optionen', ${3},
          'personFeld', f.\"personFeld\", 'istArt9', ${4}, 'teilnahmeformZuordnung', ${2}) order by f.reihenfolge), '[]'::json)
        from formular_felder f where f.\"abschnittId\" = a.id)) order by a.reihenfolge)
      from formular_abschnitte a where a.\"versionId\" = v.id))
    from formular_versionen v where v.id = '${1}';"
}
BR_ZUORDNUNG='f.validierung->$c$teilnahmeform$c$'
BR_OPTIONEN='f.optionen'
BR_ART9='f."istArt9"'
BR_PUT=$(rumpf_und_status -X PUT "${BASIS}/api/formulare/${ENTWURF_ID}" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d "$(builder_rumpf "$ENTWURF_ID" "$BR_ZUORDNUNG" "$BR_OPTIONEN" "$BR_ART9")")
pruefe "Speichern ohne Neuwahl der Zuordnung klappt (200)" "$(gleich "$BR_PUT" "200")" "$BR_PUT $(cat /tmp/gbs-rumpf.txt)"
pruefe "die Zuordnung steht danach unveraendert in der Fassung" \
  "$(gleich "$($PSQL "select f.validierung = '{\"teilnahmeform\":{\"Als Schüler — mit Prüfungen\":\"SCHUELER\",\"Als Hörer — ohne Prüfungen\":\"HOERER\"}}'::jsonb from formular_felder f join formular_abschnitte a on a.id = f.\"abschnittId\" where a.\"versionId\"='${ENTWURF_ID}' and f.code='teilnahmeform';")" "t")"
BR_OHNE=$(rumpf_und_status -X PUT "${BASIS}/api/formulare/${ENTWURF_ID}" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d "$(builder_rumpf "$ENTWURF_ID" "null::jsonb" "$BR_OPTIONEN" "$BR_ART9")")
pruefe "ohne Zuordnung weist der Server ab (400, „Schüler oder Hörer“)" \
  "$([ "$BR_OHNE" = "400" ] && grep -q 'Schüler oder Hörer' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$BR_OHNE $(cat /tmp/gbs-rumpf.txt)"
# Eine Zuordnung zu einer Antwort, die es nicht (mehr) gibt, und Randleerzeichen
# in den Antworten: Der Server bereinigt beides selbst.
BR_ZUORDNUNG_VERWAIST='case when f.code = $c$teilnahmeform$c$ then (f.validierung->$c$teilnahmeform$c$) || $j${"Verwaist":"HOERER"}$j$::jsonb else f.validierung->$c$teilnahmeform$c$ end'
BR_OPTIONEN_RAND='case when f.code = $c$teilnahmeform$c$ then $j$[" Als Schüler — mit Prüfungen ","Als Hörer — ohne Prüfungen"]$j$::jsonb else f.optionen end'
BR_VERWAIST=$(rumpf_und_status -X PUT "${BASIS}/api/formulare/${ENTWURF_ID}" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d "$(builder_rumpf "$ENTWURF_ID" "$BR_ZUORDNUNG_VERWAIST" "$BR_OPTIONEN_RAND" "$BR_ART9")")
pruefe "verwaiste Zuordnung und Randleerzeichen werden bereinigt gespeichert (200)" \
  "$([ "$BR_VERWAIST" = "200" ] && [ "$($PSQL "select f.validierung::text not like '%Verwaist%' and f.optionen::text not like '%\" Als%' from formular_felder f join formular_abschnitte a on a.id = f.\"abschnittId\" where a.\"versionId\"='${ENTWURF_ID}' and f.code='teilnahmeform';")" = "t" ] && echo 1 || echo 0)" "$BR_VERWAIST $(cat /tmp/gbs-rumpf.txt)"
# Die Gemeindezugehoerigkeit ist Art. 9 — das Haekchen „Besonders geschuetzt"
# laesst sich fuer sie nicht abwaehlen, weder beim Speichern noch beim Veroeffentlichen.
BR_ART9_AUS='case when f.code = $c$gemeinde_mitglied$c$ then false else f."istArt9" end'
BR_GEMEINDE=$(rumpf_und_status -X PUT "${BASIS}/api/formulare/${ENTWURF_ID}" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d "$(builder_rumpf "$ENTWURF_ID" "$BR_ZUORDNUNG" "$BR_OPTIONEN" "$BR_ART9_AUS")")
pruefe "die Gemeinde laesst sich nicht als ungeschuetzt speichern (400, Art. 9)" \
  "$([ "$BR_GEMEINDE" = "400" ] && grep -q 'Art. 9' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$BR_GEMEINDE $(cat /tmp/gbs-rumpf.txt)"
$PSQL "update formular_felder set \"istArt9\" = false where code='gemeinde_mitglied' and \"abschnittId\" in (select id from formular_abschnitte where \"versionId\"='${ENTWURF_ID}');" > /dev/null
BR_VEROEFF=$(rumpf_und_status -X POST "${BASIS}/api/formulare/${ENTWURF_ID}/veroeffentlichen" -H "Cookie: ${KEKS}")
$PSQL "update formular_felder set \"istArt9\" = true where code='gemeinde_mitglied' and \"abschnittId\" in (select id from formular_abschnitte where \"versionId\"='${ENTWURF_ID}');" > /dev/null
pruefe "und so nicht veroeffentlichen (400, Art. 9) — die bisherige Fassung bleibt gueltig" \
  "$([ "$BR_VEROEFF" = "400" ] && grep -q 'Art. 9' /tmp/gbs-rumpf.txt && [ "$($PSQL "select status from formular_versionen where id='${VERSION_ID}';")" = "VEROEFFENTLICHT" ] && echo 1 || echo 0)" "$BR_VEROEFF $(cat /tmp/gbs-rumpf.txt)"

echo
echo "=== 47. Eingefrorene Zeugnisse; Noten haengen an ihrer Kurseinheit ==="
# Wie die Honorarbelege (Abschnitt 29b): auch fuer den Eigentuemer unveraenderlich,
# bis auf die Schritte, die die Anwendung braucht (GUELTIG -> ERSETZT, DMS-Versand,
# Anonymisierungs-Scrub — Letzteres in Abschnitt 45 ueber die App belegt).
pruefe "den Snapshot eines ausgestellten Zeugnisses aendert auch der Eigentuemer nicht" \
  "$(abgewiesen "update zeugnisse set snapshot = jsonb_set(snapshot, '{leistungen,0,ergebnisText}', '\"x\"') where id='${Z2}';")"
pruefe "ein ersetztes Zeugnis wird nicht wieder gueltig" \
  "$(abgewiesen "update zeugnisse set status='GUELTIG' where id='${Z1}';")"
pruefe "die Zeugnistabelle laesst sich nicht leeren" "$(abgewiesen "truncate zeugnisse;")"
pruefe "Z1 und Z2 stehen unveraendert (ERSETZT, nicht bestanden)" \
  "$(gleich "$($PSQL "select (select status::text from zeugnisse where id='${Z1}') || '/' || (select snapshot->'leistungen'->0->>'ergebnisText' from zeugnisse where id='${Z2}');")" "ERSETZT/nicht bestanden")"
LEISTUNGEN_VORHER=$($PSQL "select count(*) from leistungen;")
KURS_LOESCHEN=$($PSQL "delete from kurseinheiten where id='${KURSEINHEIT_ID}';" 2>&1)
pruefe "eine Kurseinheit mit Noten laesst sich nicht loeschen (RESTRICT)" \
  "$(echo "$KURS_LOESCHEN" | grep -q 'leistungen_kurseinheitId_fkey' && echo 1 || echo 0)" "$KURS_LOESCHEN"
pruefe "Noten und Kurseinheit stehen danach unveraendert" \
  "$(gleich "$($PSQL "select (select count(*) from leistungen) || '/' || (select count(*) from kurseinheiten where id='${KURSEINHEIT_ID}');")" "${LEISTUNGEN_VORHER}/1")"

echo
echo "=== 48. Datenauskunft: vollstaendiger Inhalt, Link verfaellt mit der Adresse ==="
# Art. 15 verlangt eine Kopie ALLER Daten — Anwesenheit, Noten, Zeugnisse,
# Unterricht und Honorar fehlten bis Code-Review 4. Das PDF ist unkomprimiert;
# Klammern stehen darin maskiert als \( … \).
AUSK2=$(status_von -X POST "${BASIS}/api/personen/${TEILNEHMER_ID}/auskunft" -H "Cookie: ${KEKS}")
AUSK2_TOKEN=$(neuer_token)
$PSQL "update datenauskuenfte set \"tokenHash\"='$(hash_von "$AUSK2_TOKEN")' where id=(select id from datenauskuenfte where \"personId\"='${TEILNEHMER_ID}' order by \"erstelltAm\" desc limit 1);" > /dev/null
AUSK2_ABRUF=$(curl -s -o /tmp/gbs-auskunft-2.pdf -w '%{http_code}' -X POST "${BASIS}/api/auskunft/abrufen" -H 'Content-Type: application/json' -d "{\"token\":\"${AUSK2_TOKEN}\"}")
pruefe "Petras Auskunft enthaelt Anwesenheit, Noten, Zeugnisse, Unterricht und die Angaben nach Art. 15" \
  "$([ "$AUSK2" = "200" ] && [ "$AUSK2_ABRUF" = "200" ] && grep -aq '6. Anwesenheit' /tmp/gbs-auskunft-2.pdf && grep -aq '7. Leistungen und Noten' /tmp/gbs-auskunft-2.pdf && grep -aq '8. Zeugnisse und Bescheinigungen' /tmp/gbs-auskunft-2.pdf && grep -aq '9. Unterricht als Dozent' /tmp/gbs-auskunft-2.pdf && grep -aq '10. Angaben nach Art. 15' /tmp/gbs-auskunft-2.pdf && echo 1 || echo 0)" "${AUSK2}/${AUSK2_ABRUF}"
pruefe "und die Beleg-Nr ihres gueltigen Zeugnisses" \
  "$([ -n "$Z2_BELEG" ] && grep -aqF "$Z2_BELEG" /tmp/gbs-auskunft-2.pdf && echo 1 || echo 0)"
AUSK_DOZ=$(status_von -X POST "${BASIS}/api/personen/${DOZENT_ID}/auskunft" -H "Cookie: ${KEKS}")
AUSK_DOZ_TOKEN=$(neuer_token)
$PSQL "update datenauskuenfte set \"tokenHash\"='$(hash_von "$AUSK_DOZ_TOKEN")' where id=(select id from datenauskuenfte where \"personId\"='${DOZENT_ID}' order by \"erstelltAm\" desc limit 1);" > /dev/null
AUSK_DOZ_ABRUF=$(curl -s -o /tmp/gbs-auskunft-doz.pdf -w '%{http_code}' -X POST "${BASIS}/api/auskunft/abrufen" -H 'Content-Type: application/json' -d "{\"token\":\"${AUSK_DOZ_TOKEN}\"}")
pruefe "die Auskunft der Dozentin nennt ihre Honorarabrechnung samt Summe" \
  "$([ "$AUSK_DOZ" = "200" ] && [ "$AUSK_DOZ_ABRUF" = "200" ] && grep -aqF 'Summe \(' /tmp/gbs-auskunft-doz.pdf && echo 1 || echo 0)" "${AUSK_DOZ}/${AUSK_DOZ_ABRUF}"
# Ein offener Auskunftslink liegt im BISHERIGEN Postfach. Aendert die Verwaltung
# die Adresse (etwa weil das alte Postfach uebernommen ist), muss er verfallen.
NA=$(status_von -X POST "${BASIS}/api/personen/${NEU_ID}/auskunft" -H "Cookie: ${KEKS}")
NA_TOKEN=$(neuer_token)
$PSQL "update datenauskuenfte set \"tokenHash\"='$(hash_von "$NA_TOKEN")' where \"personId\"='${NEU_ID}';" > /dev/null
NA_MAIL=$(status_von -X PUT "${BASIS}/api/personen/${NEU_ID}/email" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"email":"neu.konto.anders@beispiel.de"}')
pruefe "die Verwaltung aendert die Anmeldeadresse einer Person mit offenem Auskunftslink (200)" \
  "$([ "$NA" = "200" ] && [ "$NA_MAIL" = "200" ] && echo 1 || echo 0)" "${NA}/${NA_MAIL}"
NA_ABRUF=$(status_von -X POST "${BASIS}/api/auskunft/abrufen" -H 'Content-Type: application/json' -d "{\"token\":\"${NA_TOKEN}\"}")
pruefe "der Auskunftslink im alten Postfach ist damit ungueltig (401), keiner gilt mehr" \
  "$([ "$NA_ABRUF" = "401" ] && [ "$($PSQL "select count(*) from datenauskuenfte where \"personId\"='${NEU_ID}' and \"laeuftAb\" > now();")" = "0" ] && echo 1 || echo 0)" "$NA_ABRUF"
pruefe "das Protokoll nennt die Zahl der entwerteten Auskunftslinks (1)" \
  "$(gleich "$($PSQL "select nachher::text like '%\"entwerteteAuskunftslinks\": 1%' from audit_log where aktion='EMAIL_GEAENDERT_DURCH_VERWALTUNG' and \"objektId\"='${NEU_ID}' order by \"erstelltAm\" desc limit 1;")" "t")"
pruefe "die Bestaetigungsseite fuer eine neue Adresse laedt ohne Token in der Adresse (200)" \
  "$([ "$(status_von "${BASIS}/meine-daten/email")" = "200" ] && [ "$(enthaelt "$(curl -s "${BASIS}/meine-daten/email")" 'Neue E-Mail-Adresse bestätigen')" = "1" ] && echo 1 || echo 0)"

echo
echo "=== 49. Betrieb: Seed-Wiederholung, Semester gehoeren dem Betrieb, Neustart, Umgebung ==="
# Der Seed laeuft bei jedem Start. Gegen die geschuetzte Datenbank darf er weder
# an einem Einwilligungstext (Trigger) noch an einem vom Betrieb geaenderten
# Semester scheitern — sonst startet der Container in einer Endlosschleife neu.
RECHTE_VORHER=$($PSQL "select count(*) from rolle_recht;")
docker exec gbs-durchstich node prisma/seed.js > /tmp/gbs-seed-1.log 2>&1
SEED1=$?
pruefe "der Seed laesst sich gegen die geschuetzte Datenbank wiederholen (Exit 0)" "$(gleich "$SEED1" "0")" "$(tail -3 /tmp/gbs-seed-1.log)"
pruefe "die Rechtematrix ist danach vollstaendig wie vorher" "$(gleich "$($PSQL "select count(*) from rolle_recht;")" "$RECHTE_VORHER")"
ORIG_START=$($PSQL "select start::text from semester where code='2026-H';")
$PSQL "update semester set start = start + 7, bezeichnung = 'Herbstsemester 2026 (korrigiert)' where code='2026-H';" > /dev/null
docker exec gbs-durchstich node prisma/seed.js > /tmp/gbs-seed-2.log 2>&1
SEED2=$?
pruefe "ein vom Betrieb korrigiertes Semester uebersteht den Seed (Exit 0, Beginn und Bezeichnung bleiben)" \
  "$([ "$SEED2" = "0" ] && grep -q 'Semester existieren bereits' /tmp/gbs-seed-2.log && [ "$($PSQL "select start = ('${ORIG_START}'::date + 7) and bezeichnung = 'Herbstsemester 2026 (korrigiert)' from semester where code='2026-H';")" = "t" ] && echo 1 || echo 0)" "$SEED2 $(tail -2 /tmp/gbs-seed-2.log)"
$PSQL "update semester set code = '2026-HX' where code='2026-H';" > /dev/null
SEM_ANZAHL=$($PSQL "select count(*) from semester;")
docker exec gbs-durchstich node prisma/seed.js > /tmp/gbs-seed-3.log 2>&1
SEED3=$?
pruefe "ein umbenanntes Semester legt der Seed nicht unter dem alten Kuerzel neu an (Exit 0)" \
  "$([ "$SEED3" = "0" ] && [ "$($PSQL "select (select count(*) from semester where code='2026-H') || '/' || (select count(*) from semester) || '/' || (select count(*) from semester where \"istAktuell\");")" = "0/${SEM_ANZAHL}/1" ] && echo 1 || echo 0)" "$SEED3 $(tail -2 /tmp/gbs-seed-3.log)"
# Das Eigentuemer-Passwort kommt im Betrieb ueber env_file mit. Nach Migration,
# Setup und Seed braucht der Server es nicht mehr — in seiner Umgebung waere es
# der Schluessel, die Append-only-Trigger zu entfernen. PID 1 ist nach `exec` der
# Server selbst.
# GRENZE (bekannter Rest, offene Entscheidung „eigener Migrationsdienst"):
# `docker exec` und der Healthcheck bekommen die Container-Umgebung (Config.Env).
# Dort stehen DB_PASSWORD und die Eigentuemer-DATABASE_URL weiter, und diese
# Prozesse laufen als derselbe Nutzer wie der Server. Die beiden Rest-Pruefungen
# halten das sichtbar fest; sie werden rot, sobald ein Migrationsdienst den Rest
# behebt — dann hier umdrehen.
pruefe "Rest (bekannt): docker exec/Healthcheck sehen das Eigentuemer-Passwort weiter (Config.Env)" \
  "$(gleich "$(docker exec gbs-durchstich sh -c 'env | grep -c ^DB_PASSWORD=')" "1")"
pruefe "Rest (bekannt): ... ebenso die Eigentuemer-DATABASE_URL" \
  "$(gleich "$(docker exec gbs-durchstich sh -c 'env | grep -c ^DATABASE_URL=postgresql://gbs:')" "1")"
pruefe "der Server (PID 1) laeuft ohne DB_PASSWORD in seiner Umgebung" \
  "$(gleich "$(docker exec gbs-durchstich sh -c 'tr "\0" "\n" < /proc/1/environ | grep -c "^DB_PASSWORD="')" "0")"
pruefe "der Server (PID 1) verbindet sich ueber die gbs_app-URL, nicht als Eigentuemer" \
  "$(gleich "$(docker exec gbs-durchstich sh -c 'tr "\0" "\n" < /proc/1/environ | grep -c "^DATABASE_URL=postgresql://gbs_app:"')" "1")"
# Neustart mit dem umbenannten Semester: Frueher legte der Seed 2026-H mit
# istAktuell neu an, verletzte den Unique-Index und endete mit Exit 1 — der
# Container startete in einer Endlosschleife neu.
docker restart gbs-durchstich > /dev/null
KOPF="000"
for i in $(seq 1 60); do
  sleep 2
  KOPF=$(curl -s -o /dev/null -w '%{http_code}' "${BASIS}/api/health" 2>/dev/null)
  [ "$KOPF" != "000" ] && break
done
pruefe "nach einem Neustart kommt der Container wieder hoch (kein Crash-Loop)" \
  "$([ "$KOPF" != "000" ] && [ "$(docker inspect -f '{{.State.Running}}' gbs-durchstich 2>/dev/null)" = "true" ] && echo 1 || echo 0)" "HTTP ${KOPF}"
pruefe "und es gibt weiter kein neues 2026-H und genau ein laufendes Semester" \
  "$(gleich "$($PSQL "select (select count(*) from semester where code='2026-H') || '/' || (select count(*) from semester where \"istAktuell\");")" "0/1")"
$PSQL "update semester set code = '2026-H', start = '${ORIG_START}', bezeichnung = 'Herbstsemester 2026' where code='2026-HX';" > /dev/null

# Bestandsmigration der Betreffs (20260927130000): alte Betreffs mit Namen werden
# auf die festen Texte gesetzt — nur bei passender oder fehlender Vorlage; ein
# zweiter Lauf aendert nichts mehr.
$PSQL "insert into email_versand (id, empfaenger, betreff, \"vorlageCode\", status, \"erstelltAm\") values (gen_random_uuid(), 'altbestand@beispiel.de', 'Neue Anmeldung: Max Muster', 'ANMELDUNG_VERWALTUNG', 'FEHLER', now()), (gen_random_uuid(), 'altbestand@beispiel.de', 'Stammdaten geändert: Max', null, 'FEHLER', now()), (gen_random_uuid(), 'altbestand@beispiel.de', 'Kommt nicht ins Portal: Erika', 'ZUGANG_HILFE_MELDUNG', 'FEHLER', now()), (gen_random_uuid(), 'altbestand@beispiel.de', 'Neue Anmeldung: X', 'ANDERE', 'FEHLER', now());" > /dev/null
BETREFF_MIGRATION=prisma/migrations/20260927130000_versandprotokoll_betreff_ohne_namen/migration.sql
docker exec gbs-durchstich cat "$BETREFF_MIGRATION" | docker exec -i gbs-campus-db-dev psql -U gbs -d ${DBNAME} -q > /dev/null 2>&1
pruefe "die Bestandsmigration setzt die alten Betreffs auf die festen Texte (fremde Vorlage bleibt)" \
  "$(gleich "$($PSQL "select count(*) filter (where betreff in ('Neue Anmeldung eingegangen','Stammdaten geändert','Meldung zum Portalzugang')) || '/' || count(*) filter (where betreff = 'Neue Anmeldung: X') from email_versand where empfaenger='altbestand@beispiel.de';")" "3/1")"
ZWEITER_LAUF=$(docker exec gbs-durchstich cat "$BETREFF_MIGRATION" | docker exec -i gbs-campus-db-dev psql -U gbs -d ${DBNAME} 2>&1)
pruefe "ein zweiter Lauf aendert keine Zeile (3x UPDATE 0)" \
  "$(gleich "$(echo "$ZWEITER_LAUF" | grep -c '^UPDATE 0$')" "3")" "$ZWEITER_LAUF"
$PSQL "delete from email_versand where empfaenger='altbestand@beispiel.de';" > /dev/null

# Betriebsseite (Administrator): was im Betrieb ohne SMTP und DMS offen bleibt.
BETRIEB=$(curl -s "${BASIS}/verwaltung/betrieb" -H "Cookie: ${KEKS_ADMIN}")
pruefe "die Betriebsseite nennt den Anmeldelink als einzigen Weg ohne Passwort" \
  "$(enthaelt "$BETRIEB" 'Für alle ohne Passwort ist der Anmeldelink')"
pruefe "sie zeigt die offenen DMS-Belege und den Grund (DMS_EMAIL fehlt)" \
  "$([ "$(enthaelt "$BETRIEB" 'Belege noch nicht im DMS')" = "1" ] && [ "$(enthaelt "$BETRIEB" 'keine DMS-Adresse eingerichtet (DMS_EMAIL)')" = "1" ] && echo 1 || echo 0)"
pruefe "und wann der Worker zuletzt lief" "$(enthaelt "$BETRIEB" 'Worker zuletzt gelaufen')"
pruefe "jede Seite traegt ihren eigenen Titel (Semester · GBS Campus)" \
  "$(enthaelt "$(curl -s "${BASIS}/verwaltung/semester" -H "Cookie: ${KEKS}")" '<title>Semester · GBS Campus</title>')"

# Opt-out: Ohne APP_DB_PASSWORD bleibt der Server am Eigentuemer-Zugang — genau
# das, was docker-compose bei leerem Passwort erzeugt (URL mit leerem Passwort).
# Frueher schaltete der Entrypoint trotzdem um, und der Server stand ohne DB.
docker rm -f gbs-durchstich-optout > /dev/null 2>&1
docker run -d --name gbs-durchstich-optout -p 3101:3000 \
  -e DATABASE_URL="postgresql://gbs:gbs_dev_2026@host.docker.internal:5434/${DBNAME}?schema=public" \
  -e APP_DB_PASSWORD="" \
  -e APP_DATABASE_URL="postgresql://gbs_app:@host.docker.internal:5434/${DBNAME}?schema=public" \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  -e APP_URL="https://durchstich.example.org" \
  -e TZ=Europe/Berlin \
  gbs-campus-test:local > /dev/null
OPT_KOPF="000"
for i in $(seq 1 60); do
  sleep 2
  OPT_KOPF=$(curl -s -o /tmp/gbs-optout-health.json -w '%{http_code}' "http://localhost:3101/api/health" 2>/dev/null)
  [ "$OPT_KOPF" != "000" ] && break
done
pruefe "Opt-out ohne APP_DB_PASSWORD: der Server antwortet, ohne Datenbankfehler" \
  "$([ "$OPT_KOPF" != "000" ] && [ "$(fehlt_in "$(cat /tmp/gbs-optout-health.json 2>/dev/null)" 'Datenbank nicht erreichbar')" = "1" ] && echo 1 || echo 0)" "HTTP ${OPT_KOPF} $(cat /tmp/gbs-optout-health.json 2>/dev/null)"
pruefe "und sagt im Log, dass er am Eigentuemer-Zugang bleibt" \
  "$(docker logs gbs-durchstich-optout 2>&1 | grep -q 'APP_DB_PASSWORD nicht gesetzt' && echo 1 || echo 0)"
docker rm -f gbs-durchstich-optout > /dev/null 2>&1

# Startpruefung von APP_URL: Eine Adresse ohne Host bzw. eine, die nicht zu
# APP_DOMAIN passt, liess den Start frueher durch — danach wies die
# Herkunftspruefung jede Aenderung ab. Jetzt endet der Start mit Exit 1.
startabbruch() { # $1 = Containername, danach zusaetzliche docker-run-Argumente; gibt den Exit-Code aus
  local name="$1" i
  shift
  docker rm -f "$name" > /dev/null 2>&1
  docker run -d --name "$name" \
    -e DATABASE_URL="postgresql://gbs:gbs_dev_2026@host.docker.internal:5434/${DBNAME}?schema=public" \
    -e SESSION_SECRET="$(openssl rand -hex 32)" \
    -e ENCRYPTION_KEY="$(openssl rand -hex 32)" \
    -e TZ=Europe/Berlin \
    "$@" gbs-campus-test:local > /dev/null
  for i in $(seq 1 60); do
    [ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null)" = "false" ] && break
    sleep 2
  done
  docker inspect -f '{{.State.ExitCode}}' "$name" 2>/dev/null
}
URL_EXIT=$(startabbruch gbs-durchstich-appurl -e APP_URL="https://")
pruefe "APP_URL ohne Host bricht den Start ab (Exit 1, Grund im Log)" \
  "$([ "$URL_EXIT" = "1" ] && docker logs gbs-durchstich-appurl 2>&1 | grep -q 'APP_URL: ist keine vollständige Adresse' && echo 1 || echo 0)" "$URL_EXIT"
docker rm -f gbs-durchstich-appurl > /dev/null 2>&1
DOMAIN_EXIT=$(startabbruch gbs-durchstich-appdomain -e APP_URL="https://durchstich.example.org" -e APP_DOMAIN="andere.example.org")
pruefe "APP_URL, die nicht zu APP_DOMAIN passt, bricht den Start ab (Exit 1, Grund im Log)" \
  "$([ "$DOMAIN_EXIT" = "1" ] && docker logs gbs-durchstich-appdomain 2>&1 | grep -q 'APP_URL: passt nicht zu APP_DOMAIN' && echo 1 || echo 0)" "$DOMAIN_EXIT"
docker rm -f gbs-durchstich-appdomain > /dev/null 2>&1

# Das Container-Log erreicht keine Anonymisierung: Mail- und Verteilerzeilen
# nennen die Protokoll-ID, nie eine Adresse. Der Durchstich laeuft ohne SMTP,
# „nicht verschickt"-Zeilen gibt es also reichlich.
pruefe "keine E-Mail-Adresse in den Mail- und Verteilerzeilen des Server-Logs" \
  "$([ -z "$(docker logs gbs-durchstich 2>&1 | grep -E '\[(MAIL|VERTEILER)\].*@')" ] && echo 1 || echo 0)"
pruefe "Gegenprobe: die Zeilen gibt es (Protokoll-ID statt Adresse)" \
  "$([ "$(docker logs gbs-durchstich 2>&1 | grep -c '\[MAIL\] Nicht verschickt (Protokoll')" -gt 0 ] && echo 1 || echo 0)"

echo
echo "=== 50. Schutz vor Massenanmeldungen: Mindestdauer, Gesamtgrenze, Warnung ==="
# Die Schichten aus lib/anmelde-schutz.ts. Zu Beginn des Laufs sind Mindestdauer
# und Gesamtgrenzen gelockert (siehe „Container starten"); hier werden sie
# einzeln scharf geschaltet. Jede Anfrage kommt von einem eigenen Anschluss,
# damit die Anschlussdrossel nicht dazwischenfunkt.
setze_einstellung() { $PSQL "update einstellungen set wert='$2' where schluessel='$1';" > /dev/null; }
mit_stempel() { # $1 = Formularstempel, danach die Argumente von anmeldung_rumpf
  local s="$1"; shift
  anmeldung_rumpf "$@" | sed "1s/^{/{ \"formularStempel\": \"${s}\",/"
}
eingaenge_stunde() { $PSQL "select count(*) from rate_limit where schluessel='ANMELDUNG_EINGANG' and zeitpunkt > now() - interval '1 hour';"; }

# --- Mindestdauer (Formularstempel)
setze_einstellung ANMELDUNG_MINDESTDAUER_SEKUNDEN 3
S_OHNE=$(rumpf_und_status -X POST "${BASIS}/api/anmeldung" -H 'Content-Type: application/json' -H 'X-Real-Ip: 203.0.113.80' \
  -d "$(anmeldung_rumpf "Stempel" "Fehlt" "stempel.fehlt@beispiel.de" "1990-01-01")")
pruefe "ohne Formularstempel abgewiesen (400, „nicht mehr aktuell“)" \
  "$([ "$S_OHNE" = "400" ] && grep -q 'nicht mehr aktuell' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$S_OHNE $(cat /tmp/gbs-rumpf.txt)"
STEMPEL=$(curl -s "${BASIS}/anmeldung" | grep -o 'data-formular-stempel="[^"]*"' | head -1 | sed 's/^data-formular-stempel="//; s/"$//')
pruefe "die Formularseite liefert einen signierten Stempel aus" \
  "$(echo "$STEMPEL" | grep -qE '^[0-9]{13}\.[A-Za-z0-9_-]{43}$' && echo 1 || echo 0)" "$STEMPEL"
S_SOFORT=$(rumpf_und_status -X POST "${BASIS}/api/anmeldung" -H 'Content-Type: application/json' -H 'X-Real-Ip: 203.0.113.81' \
  -d "$(mit_stempel "$STEMPEL" "Stempel" "Sofort" "stempel.sofort@beispiel.de" "1990-01-01")")
pruefe "sofort nach dem Laden abgeschickt: abgewiesen (400, „schneller“)" \
  "$([ "$S_SOFORT" = "400" ] && grep -q 'schneller' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$S_SOFORT $(cat /tmp/gbs-rumpf.txt)"
# Ein älterer Zeitpunkt mit der alten Signatur — so täte ein Roboter die Wartezeit vor.
S_ALT="$(( ${STEMPEL%%.*} - 60000 )).${STEMPEL#*.}"
S_FALSCH=$(rumpf_und_status -X POST "${BASIS}/api/anmeldung" -H 'Content-Type: application/json' -H 'X-Real-Ip: 203.0.113.82' \
  -d "$(mit_stempel "$S_ALT" "Stempel" "Falsch" "stempel.falsch@beispiel.de" "1990-01-01")")
pruefe "vorgetäuschter älterer Stempel abgewiesen (400)" \
  "$([ "$S_FALSCH" = "400" ] && grep -q 'nicht mehr aktuell' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$S_FALSCH $(cat /tmp/gbs-rumpf.txt)"
pruefe "die drei abgewiesenen Anmeldungen haben keine Akte angelegt" \
  "$(gleich "$($PSQL "select count(*) from personen where email like 'stempel.%@beispiel.de';")" "0")"
sleep 3
S_OK=$(rumpf_und_status -X POST "${BASIS}/api/anmeldung" -H 'Content-Type: application/json' -H 'X-Real-Ip: 203.0.113.83' \
  -d "$(mit_stempel "$STEMPEL" "Stempel" "Geduldig" "stempel.geduldig@beispiel.de" "1990-01-01")")
pruefe "nach der Mindestdauer mit demselben Stempel angenommen (200)" \
  "$([ "$S_OK" = "200" ] && grep -q 'eingereicht' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$S_OK $(cat /tmp/gbs-rumpf.txt)"
pruefe "die Abweisungen stehen mit Grund im Protokoll (FEHLT, UNGUELTIG, ZU_SCHNELL)" \
  "$(gleich "$($PSQL "select string_agg(distinct nachher->>'grund', ',' order by nachher->>'grund') from audit_log where aktion='ANMELDUNG_ABGEWIESEN_STEMPEL';")" "FEHLT,UNGUELTIG,ZU_SCHNELL")"
setze_einstellung ANMELDUNG_MINDESTDAUER_SEKUNDEN 0

# --- Gesamtgrenze je Stunde, Freigabe bei Fehlschlag, Warnung
EING=$(eingaenge_stunde)
pruefe "angenommene Anmeldungen dieses Laufs sind gezählt" "$([ "${EING:-0}" -ge 5 ] && echo 1 || echo 0)" "$EING"
setze_einstellung ANMELDUNG_MAX_GESAMT_STUNDE "$((EING + 1))"
G_UNGUELTIG=$(status_von -X POST "${BASIS}/api/anmeldung" -H 'Content-Type: application/json' -H 'X-Real-Ip: 203.0.113.84' \
  -d "$(anmeldung_rumpf "Grenze" "Ohne" "grenze.ohne@beispiel.de" "1990-01-01" | sed 's/"einwilligungen": \["DATENSCHUTZ", "GLAUBENSANGABEN"\]/"einwilligungen": []/')")
pruefe "eine abgelehnte Anmeldung (Pflichteinwilligung fehlt) verbraucht kein Kontingent" \
  "$([ "$G_UNGUELTIG" = "400" ] && [ "$(eingaenge_stunde)" = "$EING" ] && echo 1 || echo 0)" "$G_UNGUELTIG $(eingaenge_stunde)/${EING}"
G_LETZTE=$(rumpf_und_status -X POST "${BASIS}/api/anmeldung" -H 'Content-Type: application/json' -H 'X-Real-Ip: 203.0.113.85' \
  -d "$(anmeldung_rumpf "Grenze" "Letzte" "grenze.letzte@beispiel.de" "1990-01-01")")
pruefe "bis zur Stundengrenze angenommen (200)" "$(gleich "$G_LETZTE" "200")" "$G_LETZTE $(cat /tmp/gbs-rumpf.txt)"
G_DRUEBER=$(rumpf_und_status -X POST "${BASIS}/api/anmeldung" -H 'Content-Type: application/json' -H 'X-Real-Ip: 203.0.113.86' \
  -d "$(anmeldung_rumpf "Grenze" "Drueber" "grenze.drueber@beispiel.de" "1990-01-01")")
pruefe "über der Stundengrenze abgewiesen (429, „in einer Stunde“)" \
  "$([ "$G_DRUEBER" = "429" ] && grep -q 'in einer Stunde' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$G_DRUEBER $(cat /tmp/gbs-rumpf.txt)"
pruefe "die abgewiesene Anmeldung legt keine Akte an" \
  "$(gleich "$($PSQL "select count(*) from personen where email='grenze.drueber@beispiel.de';")" "0")"
pruefe "das Protokoll hält die Gesamtgrenze fest (Fenster STUNDE)" \
  "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='ANMELDUNG_GESAMT_GEDROSSELT' and nachher->>'art'='ANMELDUNG' and nachher->>'fenster'='STUNDE';")" "t")"
sleep 2
WARN=$($PSQL "select count(*) from email_versand where \"vorlageCode\"='ANMELDUNG_GEDROSSELT';")
pruefe "Schulleitung und Verwaltung werden gewarnt (Versandprotokoll)" "$([ "${WARN:-0}" -ge 1 ] && echo 1 || echo 0)" "$WARN"
pruefe "der Betreff der Warnung kommt aus der Vorlage, ohne Namen" \
  "$(gleich "$($PSQL "select count(*) from email_versand where \"vorlageCode\"='ANMELDUNG_GEDROSSELT' and betreff <> 'Anmeldeformular: ungewöhnlich viele Anmeldungen';")" "0")"
G_NOCHMAL=$(status_von -X POST "${BASIS}/api/anmeldung" -H 'Content-Type: application/json' -H 'X-Real-Ip: 203.0.113.87' \
  -d "$(anmeldung_rumpf "Grenze" "Nochmal" "grenze.nochmal@beispiel.de" "1990-01-01")")
sleep 2
pruefe "weitere Abweisungen lösen keine zweite Warnung aus (höchstens eine pro Stunde)" \
  "$([ "$G_NOCHMAL" = "429" ] && [ "$($PSQL "select count(*) from email_versand where \"vorlageCode\"='ANMELDUNG_GEDROSSELT';")" = "$WARN" ] && echo 1 || echo 0)" "$G_NOCHMAL"

# --- Gesamtgrenze je Tag
setze_einstellung ANMELDUNG_MAX_GESAMT_STUNDE 500
setze_einstellung ANMELDUNG_MAX_GESAMT_TAG "$($PSQL "select count(*) from rate_limit where schluessel='ANMELDUNG_EINGANG' and zeitpunkt > now() - interval '24 hours';")"
G_TAG=$(rumpf_und_status -X POST "${BASIS}/api/anmeldung" -H 'Content-Type: application/json' -H 'X-Real-Ip: 203.0.113.88' \
  -d "$(anmeldung_rumpf "Grenze" "Tag" "grenze.tag@beispiel.de" "1990-01-01")")
pruefe "über der Tagesgrenze abgewiesen (429, „morgen“)" \
  "$([ "$G_TAG" = "429" ] && grep -q 'morgen' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$G_TAG $(cat /tmp/gbs-rumpf.txt)"
setze_einstellung ANMELDUNG_MAX_GESAMT_TAG 2000

# --- Zwischenstände: das Dreifache der Stundengrenze, gezählt über neue Zeilen
ZEILEN=$($PSQL "select count(*) from anmeldungen where \"erstelltAm\" > now() - interval '1 hour';")
ZS_GRENZE=$(( ZEILEN / 3 )); [ "$ZS_GRENZE" -lt 1 ] && ZS_GRENZE=1
setze_einstellung ANMELDUNG_MAX_GESAMT_STUNDE "$ZS_GRENZE"
ZS_ERFUNDEN=$(rumpf_und_status -X POST "${BASIS}/api/anmeldung" -H 'Content-Type: application/json' -H 'X-Real-Ip: 203.0.113.89' \
  -d "{\"aktion\":\"speichern\",\"versionId\":\"${VERSION_ID}\",\"antworten\":{\"vorname\":\"Zwischen\"},\"fortsetzenToken\":\"$(neuer_token)\"}")
pruefe "Zwischenstand über der Grenze abgewiesen — auch mit erfundenem Token (429)" \
  "$([ "$ZS_ERFUNDEN" = "429" ] && grep -q 'Zwischenstand' /tmp/gbs-rumpf.txt && echo 1 || echo 0)" "$ZS_ERFUNDEN $(cat /tmp/gbs-rumpf.txt)"
setze_einstellung ANMELDUNG_MAX_GESAMT_STUNDE 500

# --- Betriebsansicht
KEKS_ADMIN50=$(anmelden_als "$ADMIN_ID")
BETRIEB50=$(curl -s "${BASIS}/verwaltung/betrieb" -H "Cookie: ${KEKS_ADMIN50}")
pruefe "die Betriebsansicht zeigt den Anmeldeschutz und dass die Gesamtgrenze gegriffen hat" \
  "$([ "$(enthaelt "$BETRIEB50" 'Anmeldeformular: angenommene Anmeldungen')" = "1" ] && [ "$(enthaelt "$BETRIEB50" 'Die Gesamtgrenze hat in den letzten 24 Stunden gegriffen')" = "1" ] && echo 1 || echo 0)"

echo
echo "=== 51. Abschluss-Sweep: keine IBAN, keine Art.-9-Angaben in Protokollen und Belegen ==="
# Frueher lief diese Suche in Abschnitt 19 — vor Honorar-Freigabe, Zeugnissen,
# Statuswechseln und Anonymisierung. Jetzt am Ende, ueber alle Stellen, die
# breiter lesbar sind als die Akte oder unloeschbar: Audit-Log, Versandprotokoll,
# Honorar-Abrechnungen samt Posten und Zeugnis-Snapshots.
# Woerter ohne Gross-/Kleinschreibung (ilike), IBAN-Stuecke als Regex
# (IBAN_MUSTER, siehe oben) — sonst traf '%DE89%' zufaellig UUIDs und Beleg-Nrn.
SWEEP="array['%FeG %','%Ueberzeugung%','%Kindergottesdienst%','%Glauben gekommen%','%Testgemeinde%','%Gemeinde am Test%']"
pruefe "Audit-Log: keine IBAN, keine Glaubens- oder Gemeindeangaben" \
  "$(gleich "$($PSQL "select count(*) from (select coalesce(vorher::text,'') || coalesce(nachher::text,'') as t from audit_log) x where t ilike any (${SWEEP}) or t ~ '${IBAN_MUSTER}';")" "0")"
pruefe "Versandprotokoll: ebenso" \
  "$(gleich "$($PSQL "select count(*) from (select betreff || ' ' || empfaenger || ' ' || coalesce(\"vorlageCode\",'') || ' ' || coalesce(fehler,'') as t from email_versand) x where t ilike any (${SWEEP}) or t ~ '${IBAN_MUSTER}';")" "0")"
pruefe "Honorar-Abrechnungen und Posten: ebenso" \
  "$(gleich "$($PSQL "select (select count(*) from honorar_abrechnungen a where to_jsonb(a)::text ilike any (${SWEEP}) or to_jsonb(a)::text ~ '${IBAN_MUSTER}') + (select count(*) from honorar_abrechnung_posten p where to_jsonb(p)::text ilike any (${SWEEP}) or to_jsonb(p)::text ~ '${IBAN_MUSTER}');")" "0")"
pruefe "Zeugnis-Snapshots: ebenso" \
  "$(gleich "$($PSQL "select count(*) from zeugnisse where snapshot::text ilike any (${SWEEP}) or snapshot::text ~ '${IBAN_MUSTER}';")" "0")"
pruefe "Gegenprobe: alle vier Stellen sind gefuellt" \
  "$(gleich "$($PSQL "select (select count(*) from audit_log) > 0 and (select count(*) from email_versand) > 0 and (select count(*) from honorar_abrechnung_posten) > 0 and (select count(*) from zeugnisse) > 0;")" "t")"

# 850 Pruefungen plus diese eine, die sich selbst mitzaehlt. Im Text stehen 835
# Aufrufe; der in der Protokoll-Schleife von Abschnitt 19 laeuft 17-mal
# (834 + 17 = 851). Kein Aufruf steht in einem if-Zweig — die Zahl ist fest.
SOLL=851
pruefe "alle ${SOLL} Pruefungen sind gelaufen" "$(gleich "$((ok + fehler + 1))" "${SOLL}")" "$((ok + fehler + 1))"

echo
echo "${ok} Pruefungen bestanden, ${fehler} fehlgeschlagen."
[ "$fehler" = "0" ] || exit 1
