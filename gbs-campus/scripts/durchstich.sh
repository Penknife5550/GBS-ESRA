#!/bin/bash
# =============================================================================
# GBS Campus — Durchstich fuer Semester, Teilnehmerliste und Excel-Export
#
# Laeuft gegen das gebaute Image und eine FRISCHE Datenbank. Prueft die Kette
# vom Semester ueber die Anmeldung und die Aufnahme bis zur Excel-Datei.
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

echo "=== Frische Datenbank ==="
docker exec -i gbs-campus-db-dev psql -U gbs -d postgres \
  -c "DROP DATABASE IF EXISTS ${DBNAME} WITH (FORCE);" \
  -c "CREATE DATABASE ${DBNAME} OWNER gbs;" > /dev/null

echo "=== Container starten (Migration + Seed laufen im Entrypoint) ==="
docker rm -f gbs-durchstich > /dev/null 2>&1
# APP_DB_PASSWORD/APP_DATABASE_URL gesetzt: der Entrypoint richtet gbs_app ein und
# der laufende Server verbindet sich als dieser rechtebeschraenkte Nutzer — der
# ganze Durchstich laeuft also gegen die App als gbs_app, nicht als Eigentuemer.
APP_PW=$(openssl rand -hex 24)
docker run -d --name gbs-durchstich -p ${PORT}:3000 \
  -e DATABASE_URL="postgresql://gbs:gbs_dev_2026@host.docker.internal:5434/${DBNAME}?schema=public" \
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
# macht dieses Semester zum Ziel der eingehenden Anmeldung in Abschnitt 5.
ANTWORT=$(curl -s -X POST "${BASIS}/api/semester" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d '{"code":"2099-H","bezeichnung":"Testsemester 2099","start":"2026-09-15","ende":"2027-02-28","anmeldungVon":"2026-06-01","anmeldungBis":"2026-09-14","istAktuell":true}')
SEMESTER_ID=$(echo "$ANTWORT" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
pruefe "Semester wird angelegt" "$([ -n "$SEMESTER_ID" ] && echo 1 || echo 0)" "$ANTWORT"
pruefe "Semester ist das laufende" \
  "$(gleich "$($PSQL "select count(*) from semester where \"istAktuell\" = true;")" "1")"

MANGEL=$(curl -s -X POST "${BASIS}/api/semester" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d '{"code":"2027-F","bezeichnung":"Fruehjahr","start":"2027-03-01","ende":"2026-01-01"}')
pruefe "Ende vor Beginn wird abgewiesen" "$(echo "$MANGEL" | grep -qc 'nach seinem Beginn' 2>/dev/null && echo 1 || echo 0)" "$MANGEL"

DOPPELT=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/semester" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' \
  -d '{"code":"2099-H","bezeichnung":"Noch einmal","start":"2026-09-15","ende":"2027-02-28"}')
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

S1=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/semester" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' -d '{"code":"X-1","bezeichnung":"Fremd","start":"2026-09-15","ende":"2027-02-28"}')
pruefe "Teilnehmer darf kein Semester anlegen (403)" "$(gleich "$S1" "403")" "$S1"
S2=$(curl -s -o /dev/null -w '%{http_code}' "${BASIS}/api/semester/${SEMESTER_ID}/export" -H "Cookie: ${KEKS2}")
pruefe "Teilnehmer darf nicht exportieren (403)" "$(gleich "$S2" "403")" "$S2"
S3=$(curl -s -o /dev/null -w '%{http_code}' "${BASIS}/api/semester/${SEMESTER_ID}/export")
pruefe "ohne Anmeldung kein Export (403)" "$(gleich "$S3" "403")" "$S3"

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

FALSCH=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "${BASIS}/api/meine-daten" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' \
  -d '{"telefon":"ruf mich an","iban":"DE00 1111"}')
pruefe "unsinnige Eingaben werden mit 400 abgewiesen" "$(gleich "$FALSCH" "400")" "$FALSCH"
OHNE=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "${BASIS}/api/meine-daten" -H 'Content-Type: application/json' -d '{"ort":"Fremd"}')
pruefe "ohne Anmeldung keine Selbstpflege (403)" "$(gleich "$OHNE" "403")" "$OHNE"

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
pruefe "die Schulleitung wird benachrichtigt" \
  "$(gleich "$($PSQL "select count(*) > 0 from email_versand where betreff like 'Kommt nicht ins Portal%';")" "t")"
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
pruefe "Anmeldelink laesst sich verschicken" "$(echo "$SCHICKEN" | grep -qc '"gesendet":true' 2>/dev/null && echo 1 || echo 0)" "$SCHICKEN"
pruefe "der Link geht an die hinterlegte Adresse" "$(echo "$SCHICKEN" | grep -qc 'petra.privat@beispiel.de' 2>/dev/null && echo 1 || echo 0)" "$SCHICKEN"
pruefe "ein neuer Anmeldelink ist entstanden" \
  "$([ "$($PSQL "select count(*) from magic_links;")" -gt "$LINKS_VORHER" ] && echo 1 || echo 0)"

# Endzustand: kein Anmeldelink, und das wird gesagt statt still geschluckt.
OHNE_ID=$($PSQL "select id from personen where email='ohne@beispiel.de';")
$PSQL "update personen set \"statusCode\"='ABGEBROCHEN' where id='${OHNE_ID}';" > /dev/null
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

# Also neu anmelden. Ohne das liefe der ganze Abschnitt in 403er.
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
# Eingriffe in ein fremdes Konto, wenn niemand angemeldet ist.
OHNE_SITZUNG_PUT=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "${BASIS}/api/meine-daten/passwort" \
  -H 'Content-Type: application/json' -d '{"passwort":"Der Herr ist mein Hirte"}')
pruefe "ohne Sitzung laesst sich kein Passwort setzen (403)" "$(gleich "$OHNE_SITZUNG_PUT" "403")" "$OHNE_SITZUNG_PUT"
OHNE_SITZUNG_DELETE=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "${BASIS}/api/meine-daten/passwort")
pruefe "ohne Sitzung laesst sich kein Passwort entfernen (403)" "$(gleich "$OHNE_SITZUNG_DELETE" "403")" "$OHNE_SITZUNG_DELETE"

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
# 403 — und zwar nicht immer, sondern je nach Sekundenbruchteil.
curl -s -D /tmp/gbs-h-pw.txt -o /dev/null -X PUT "${BASIS}/api/meine-daten/passwort" -H "Cookie: ${KEKS4}" \
  -H 'Content-Type: application/json' -d '{"passwort":"Sein Stecken und Stab"}'
KEKS4=$(grep -i '^set-cookie:' /tmp/gbs-h-pw.txt | head -1 | sed 's/^[^:]*: //' | cut -d';' -f1)
VORHER_OK=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/auth/passwort" -H 'Content-Type: application/json' \
  -H "X-Real-Ip: ${IP_HANS}" -d '{"email":"hans@beispiel.de","passwort":"Sein Stecken und Stab"}')
pruefe "zweites Konto kann sich mit Passwort anmelden" "$(gleich "$VORHER_OK" "200")" "$VORHER_OK"

# Endzustand: Wer das System verlassen hat, kommt auch mit RICHTIGEM Passwort
# nicht mehr herein. Sonst behielte ein ausgeschlossener Zugang genau den
# zweiten Anmeldeweg, den ihm niemand mehr wegnimmt.
$PSQL "update personen set \"statusCode\"='ABGEBROCHEN' where id='${HOERER_ID}';" > /dev/null
ENDZUSTAND=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/auth/passwort" -H 'Content-Type: application/json' \
  -H "X-Real-Ip: ${IP_HANS}" -d '{"email":"hans@beispiel.de","passwort":"Sein Stecken und Stab"}')
pruefe "ein Konto im Endzustand kommt auch mit richtigem Passwort nicht herein (401)" "$(gleich "$ENDZUSTAND" "401")" "$ENDZUSTAND"
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
$PSQL "update einwilligungs_texte set pflicht = false where code = 'GLAUBENSANGABEN';" > /dev/null
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
$PSQL "update einwilligungs_texte set pflicht = true where code = 'GLAUBENSANGABEN';" > /dev/null
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
  "$(gleich "$($PSQL "select count(*) from audit_log where (vorher::text || nachher::text) ilike '%DE89%' or (vorher::text || nachher::text) ilike '%AT61%';")" "0")"
pruefe "die Adressaenderung ist mit Alt- und Neuwert protokolliert" \
  "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='EIGENE_DATEN_GEAENDERT' and nachher::text like '%Neue Straße 7%';")" "t")"
pruefe "kein Passwort und kein Hash im Audit-Log" \
  "$(gleich "$($PSQL "select count(*) from audit_log where (coalesce(vorher::text,'') || coalesce(nachher::text,'')) ilike any (array['%Hirte%','%scrypt%','%Stecken%']);")" "0")"

# Dasselbe fuer das Versandprotokoll. Es wird in der Betriebsansicht angezeigt
# und ist damit fuer mehr Augen sichtbar als die Akte selbst — eine IBAN oder gar
# ein Passwort im Betreff waere genau die Weitergabe, gegen die die
# Verschluesselung antritt. Geprueft wird ueber alle Textspalten hinweg, damit
# eine neue Spalte nicht stillschweigend am Waechter vorbeilaeuft.
pruefe "keine IBAN im Versandprotokoll" \
  "$(gleich "$($PSQL "select count(*) from email_versand where (betreff || ' ' || empfaenger || ' ' || coalesce(\"vorlageCode\",'') || ' ' || coalesce(fehler,'')) ilike any (array['%DE89%','%AT61%']);")" "0")"
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
AUSK_VERBOTEN=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/personen/${TEILNEHMER_ID}/auskunft" -H "Cookie: ${KEKS2}")
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

echo
echo "=== 23. Semesterueberleitung: einladen, bestaetigen, erinnern ==="
# Quelle: eine aktive Teilnahme im laufenden Semester (2099-H). Ziel: das echte
# Folgesemester 2027-F (1. Lehrjahr, Fruehling).
$PSQL "insert into teilnahmen (id,\"personId\",\"semesterId\",teilnahmeform,\"erstelltAm\") values (gen_random_uuid(),'${TEILNEHMER_ID}','${SEMESTER_ID}','SCHUELER',now()) on conflict (\"personId\",\"semesterId\") do nothing;" > /dev/null
TARGET_ID=$($PSQL "select id from semester where code='2027-F';")

UEBER=$(curl -s -X POST "${BASIS}/api/semesterueberleitung/start" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${TARGET_ID}\"}")
pruefe "Ueberleitung starten ist erlaubt und meldet Eingeladene" "$(echo "$UEBER" | grep -qc '"eingeladen"' && echo 1 || echo 0)" "$UEBER"
pruefe "neue Teilnahme im Zielsemester mit Bestaetigungslink, noch unbestaetigt" \
  "$(gleich "$($PSQL "select count(*) from teilnahmen where \"personId\"='${TEILNEHMER_ID}' and \"semesterId\"='${TARGET_ID}' and \"bestaetigungTokenHash\" is not null and \"bestaetigtAm\" is null;")" "1")"
pruefe "die Ueberleitung ist protokolliert (SEMESTER_UEBERLEITUNG_GESTARTET)" \
  "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='SEMESTER_UEBERLEITUNG_GESTARTET' and \"objektId\"='${TARGET_ID}';")" "t")"

# Idempotenz: ein zweiter Start laedt niemanden doppelt ein.
curl -s -o /dev/null -X POST "${BASIS}/api/semesterueberleitung/start" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${TARGET_ID}\"}"
pruefe "ein zweiter Start legt keine zweite Teilnahme an" \
  "$(gleich "$($PSQL "select count(*) from teilnahmen where \"personId\"='${TEILNEHMER_ID}' and \"semesterId\"='${TARGET_ID}';")" "1")"

# Ein Teilnehmer darf die Ueberleitung nicht anstossen (kein SEMESTER_VERWALTEN).
UEBER_VERBOTEN=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/semesterueberleitung/start" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${TARGET_ID}\"}")
pruefe "ein Teilnehmer darf keine Ueberleitung starten (403)" "$(gleich "$UEBER_VERBOTEN" "403")" "$UEBER_VERBOTEN"

# „Ich bin dabei": bekannten Hash auf den Token der Ziel-Teilnahme setzen und einloesen.
DABEI_TOKEN=$(uuidgen | tr 'A-Z' 'a-z'); DABEI_HASH=$(printf %s "$DABEI_TOKEN" | shasum -a 256 | cut -d' ' -f1)
$PSQL "update teilnahmen set \"bestaetigungTokenHash\"='${DABEI_HASH}', \"bestaetigungLaeuftAb\"=now()+interval '30 days' where \"personId\"='${TEILNEHMER_ID}' and \"semesterId\"='${TARGET_ID}';" > /dev/null
DABEI=$(curl -s -X POST "${BASIS}/api/ueberleitung/bestaetigen" -H 'Content-Type: application/json' -d "{\"token\":\"${DABEI_TOKEN}\"}")
pruefe "bin-dabei setzt bestaetigtAm" \
  "$(gleich "$($PSQL "select count(*) from teilnahmen where \"personId\"='${TEILNEHMER_ID}' and \"semesterId\"='${TARGET_ID}' and \"bestaetigtAm\" is not null;")" "1")"
pruefe "bin-dabei zeigt die Faecher des Zielsemesters (2027-F: 1. Lehrjahr, Fruehling)" \
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
GEN_VERBOTEN=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/stundenplan/termine/generieren" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' -d "{\"semesterId\":\"${SEMESTER_ID}\"}")
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
pruefe "worker.js liegt im Image" "$(docker exec gbs-durchstich test -f worker.js && echo 1 || echo 0)"
VORHER=$($PSQL "select count(*) from audit_log where aktion='AUFRAEUMEN_GELAUFEN' and quelle='SYSTEM';")
docker exec -e WORKER_EINMAL=1 gbs-durchstich node worker.js > /tmp/gbs-worker.log 2>&1
WEXIT=$?
pruefe "der Worker-Einzellauf laeuft ohne Fehler durch (exit 0)" "$(gleich "$WEXIT" "0")" "$(tail -3 /tmp/gbs-worker.log)"
NACHHER=$($PSQL "select count(*) from audit_log where aktion='AUFRAEUMEN_GELAUFEN' and quelle='SYSTEM';")
pruefe "der Worker hat einen Aufraeumlauf ausgefuehrt (ein Audit-Eintrag mehr)" \
  "$([ -n "$NACHHER" ] && [ -n "$VORHER" ] && [ "$NACHHER" -gt "$VORHER" ] && echo 1 || echo 0)" "${VORHER} -> ${NACHHER}"

echo
echo "=== 27. Anonymisierung nach Art. 17 DSGVO ==="
# Klaus Ehemann (Abschnitt 20) wird anonymisiert — er hat eine Anmeldung mit
# echten Antworten und eine Ehepartner-Ermaessigung, also PII in mehreren Tabellen.
KLAUS_ID=$($PSQL "select id from personen where email='klaus@beispiel.de';")
pruefe "Klaus hat vor der Anonymisierung echte Anmelde-Antworten" \
  "$(enthaelt "$($PSQL "select antworten::text from anmeldungen where \"personId\"='${KLAUS_ID}';")" "Klaus")"
# Ein Teilnehmer darf nicht anonymisieren.
ANON_VERBOTEN=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/personen/${KLAUS_ID}/anonymisieren" -H "Cookie: ${KEKS2}")
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
# Die generierten 2099-H-Abende liegen am/nach dem 15.09.2026 und sind heute noch
# Zukunft — fuer die Selbstbestaetigung braucht es einen Abend in der
# Vergangenheit, deshalb hier per SQL angelegt.
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
AKTE=$(curl -s "${BASIS}/meine-daten" -H "Cookie: ${KEKS2}")
pruefe "die eigene Akte zeigt den Anwesenheits-Abschnitt" "$(enthaelt "$AKTE" "Meine Anwesenheit")"
pruefe "die eigene Quote nennt teilgenommen/gesamt" "$(enthaelt "$AKTE" "Teilgenommen:")"
pruefe "die eigene Quote steht auf 'Noch offen'" "$(enthaelt "$AKTE" "Noch offen")"
pruefe "die Quote nennt das verbleibende Fehl-Budget" "$(enthaelt "$AKTE" "Du darfst noch")"
# Ein Abend eines Semesters, in dem der Teilnehmer nicht eingeschrieben ist (404).
FREMD_SEM=$($PSQL "select id from semester where code='2027-H';")
SB_FREMD_T=$($PSQL "insert into unterrichtstermine (id,\"semesterId\",beginn,reihenfolge,\"erstelltAm\") values (gen_random_uuid(),'${FREMD_SEM}',now()-interval '1 day',0,now()) returning id;")
SB_FREMD=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/meine-daten/anwesenheit" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' -d "{\"terminId\":\"${SB_FREMD_T}\",\"status\":\"ANWESEND\"}")
pruefe "ein Abend aus einem fremden Semester wird abgewiesen (404)" "$(gleich "$SB_FREMD" "404")" "$SB_FREMD"
# Ohne Anmeldung keine Selbstbestaetigung (403).
SB_ANON=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/meine-daten/anwesenheit" -H 'Content-Type: application/json' -d "{\"terminId\":\"${SB_PAST}\",\"status\":\"ANWESEND\"}")
pruefe "ohne Anmeldung keine Selbstbestaetigung (403)" "$(gleich "$SB_ANON" "403")" "$SB_ANON"
# Die Selbstbestaetigung ist protokolliert.
pruefe "die Selbstbestaetigung ist protokolliert (ANWESENHEIT_SELBST_BESTAETIGT)" \
  "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='ANWESENHEIT_SELBST_BESTAETIGT' and \"objektId\"='${SB_PAST}';")" "t")"
# Die eigene Akte zeigt jetzt den Abschnitt „Meine Anwesenheit".
SB_SEITE=$(curl -s "${BASIS}/meine-daten" -H "Cookie: ${KEKS2}")
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
GEN=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/honorar/saetze" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"betrag":95,"gueltigAb":"2000-01-02","notiz":"Durchstich"}')
pruefe "die Schulleitung genehmigt einen Satz (200)" "$(gleich "$GEN" "200")" "$GEN"
pruefe "der genehmigte Satz (95) steht in der Historie" \
  "$(gleich "$($PSQL "select count(*) from honorar_saetze where betrag=95;")" "1")"
pruefe "die Genehmigung haelt den Genehmiger fest" \
  "$(gleich "$($PSQL "select count(*) > 0 from honorar_saetze where betrag=95 and \"genehmigtVonId\" is not null;")" "t")"
pruefe "nach der Genehmigung ist eine DMS-Beleg-Nr vergeben (HON-...)" \
  "$(enthaelt "$($PSQL "select \"dmsBelegNr\" from honorar_saetze where betrag=95;")" "HON-")"
pruefe "die Genehmigung steht im Audit-Log" \
  "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='HONORAR_SATZ_GENEHMIGT';")" "t")"
# Ein Teilnehmer darf keinen Satz genehmigen (403).
GEN_T=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/honorar/saetze" -H "Cookie: ${KEKS2}" -H 'Content-Type: application/json' -d '{"betrag":50,"gueltigAb":"2027-01-01"}')
pruefe "ein Teilnehmer darf keinen Satz genehmigen (403)" "$(gleich "$GEN_T" "403")" "$GEN_T"

# Dem Dozenten Abende zuordnen (ueber die Termin-PUT der Schulleitung): zwei
# vergangene und einen zukuenftigen. Der zukuenftige darf im Honorar NICHT als
# gehalten zaehlen (nur bereits stattgefundene Abende ergeben Honorar).
DT1=$($PSQL "select id from unterrichtstermine where \"semesterId\"='${SEMESTER_ID}' and beginn <= now() order by beginn asc limit 1;")
DT2=$($PSQL "select id from unterrichtstermine where \"semesterId\"='${SEMESTER_ID}' and beginn <= now() order by beginn asc limit 1 offset 1;")
DT_FUT=$($PSQL "select id from unterrichtstermine where \"semesterId\"='${SEMESTER_ID}' and beginn > now() order by beginn asc limit 1;")
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

# Abrechnung erstellen: der Dozent hat aus Abschnitt 29 zwei gehaltene Abende (je 95 EUR).
ABR=$(curl -s -X POST "${BASIS}/api/honorar/abrechnungen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d "{\"dozentId\":\"${DOZENT_ID}\",\"semesterId\":\"${SEMESTER_ID}\"}")
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

# Statusmaschine: eine OFFENE Abrechnung laesst sich nicht auszahlen (400).
AUS_OFFEN=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/honorar/abrechnungen/${ABR_ID}/auszahlen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"ausgezahltAm":"2026-11-01"}')
pruefe "Auszahlen einer OFFENEN Abrechnung ist verboten (400)" "$(gleich "$AUS_OFFEN" "400")" "$AUS_OFFEN"

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

# Dem Dozenten eine gueltige (verschluesselte) IBAN geben — die eines beliebigen
# vorhandenen Kontos uebernehmen (die Anmeldung hat welche verschluesselt angelegt).
$PSQL "update personen set \"ibanVerschluesselt\" = (select \"ibanVerschluesselt\" from personen where \"ibanVerschluesselt\" is not null limit 1), kontoinhaber='Dora Dozento' where id='${DOZENT_ID}';" > /dev/null
pruefe "der Dozent hat jetzt eine Bankverbindung" \
  "$(gleich "$($PSQL "select \"ibanVerschluesselt\" is not null from personen where id='${DOZENT_ID}';")" "t")"

# Freigabe durch die Verwaltung (200): Beleg-Nr gesetzt, Status FREIGEGEBEN, Audit.
FREI_V=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/honorar/abrechnungen/${ABR_ID}/freigeben" -H "Cookie: ${KEKS_V}")
pruefe "die Verwaltung gibt die Abrechnung frei (200)" "$(gleich "$FREI_V" "200")" "$FREI_V"
pruefe "die Abrechnung ist danach FREIGEGEBEN" \
  "$(gleich "$($PSQL "select status from honorar_abrechnungen where id='${ABR_ID}';")" "FREIGEGEBEN")"
pruefe "eine DMS-Beleg-Nr ist vergeben (HONA-...)" \
  "$(enthaelt "$($PSQL "select \"belegNr\" from honorar_abrechnungen where id='${ABR_ID}';")" "HONA-")"
pruefe "die Freigabe steht im Audit-Log" \
  "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='HONORAR_ABRECHNUNG_FREIGEGEBEN';")" "t")"

# Doppelfreigabe ist ausgeschlossen (atomarer Statuswechsel -> 400).
FREI_2=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/honorar/abrechnungen/${ABR_ID}/freigeben" -H "Cookie: ${KEKS_V}")
pruefe "eine zweite Freigabe wird abgewiesen (400)" "$(gleich "$FREI_2" "400")" "$FREI_2"

# Auszahlen (200) durch die Verwaltung.
AUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/honorar/abrechnungen/${ABR_ID}/auszahlen" -H "Cookie: ${KEKS_V}" -H 'Content-Type: application/json' -d '{"ausgezahltAm":"2026-11-01"}')
pruefe "eine freigegebene Abrechnung laesst sich auszahlen (200)" "$(gleich "$AUS" "200")" "$AUS"
pruefe "die Abrechnung ist danach AUSGEZAHLT" \
  "$(gleich "$($PSQL "select status from honorar_abrechnungen where id='${ABR_ID}';")" "AUSGEZAHLT")"
pruefe "das Auszahlungsdatum ist gesetzt (01.11.2026)" \
  "$(gleich "$($PSQL "select \"ausgezahltAm\"::date from honorar_abrechnungen where id='${ABR_ID}';")" "2026-11-01")"
pruefe "das Auszahlen steht im Audit-Log" \
  "$(gleich "$($PSQL "select count(*) > 0 from audit_log where aktion='HONORAR_ABRECHNUNG_AUSGEZAHLT';")" "t")"

# Ungueltiges Auszahlungsdatum wird abgewiesen (400).
AUS_BAD=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/honorar/abrechnungen/${ABR_ID}/auszahlen" -H "Cookie: ${KEKS}" -H 'Content-Type: application/json' -d '{"ausgezahltAm":"2026-02-30"}')
pruefe "ein ungueltiges Auszahlungsdatum wird abgewiesen (400)" "$(gleich "$AUS_BAD" "400")" "$AUS_BAD"

# Seiten: Uebersicht + Detail (Schulleitung 200, Teilnehmer weggeleitet 307).
UEB_S=$(curl -s -o /dev/null -w '%{http_code}' "${BASIS}/verwaltung/honorar/abrechnungen?semester=${SEMESTER_ID}" -H "Cookie: ${KEKS}")
pruefe "die Schulleitung sieht die Abrechnungs-Uebersicht (200)" "$(gleich "$UEB_S" "200")" "$UEB_S"
UEB_T=$(curl -s -o /dev/null -w '%{http_code}' "${BASIS}/verwaltung/honorar/abrechnungen" -H "Cookie: ${KEKS2}")
pruefe "ein Teilnehmer wird von der Abrechnungs-Uebersicht weggeleitet (307)" "$(gleich "$UEB_T" "307")" "$UEB_T"
DET_S=$(curl -s -o /dev/null -w '%{http_code}' "${BASIS}/verwaltung/honorar/abrechnungen/${ABR_ID}" -H "Cookie: ${KEKS}")
pruefe "die Schulleitung sieht die Abrechnungs-Detailseite (200)" "$(gleich "$DET_S" "200")" "$DET_S"

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
pruefe "ein vergangener eigener Abend bietet die Erfassung an" "$(enthaelt "$DZ_SEITE" 'Anwesenheit (')"
pruefe "ein kuenftiger eigener Abend ist markiert (noch nicht stattgefunden)" "$(enthaelt "$DZ_SEITE" 'noch nicht stattgefunden')"

# Anwesenheit fuer den EIGENEN vergangenen Abend erfassen (200) + Provenienz.
DZ_OK=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASIS}/api/dozent/anwesenheit" -H "Cookie: ${KEKS_DOZ}" -H 'Content-Type: application/json' -d "{\"terminId\":\"${DZ_TERMIN}\",\"eintraege\":[{\"teilnahmeId\":\"${TEILNAHME_ID}\",\"status\":\"ANWESEND\"}]}")
pruefe "die Dozentin erfasst Anwesenheit ihres eigenen Abends (200)" "$(gleich "$DZ_OK" "200")" "$DZ_OK"
pruefe "der Eintrag traegt die Dozentin als Erfasser" \
  "$(gleich "$($PSQL "select \"erfasstVonId\" from anwesenheiten where \"terminId\"='${DZ_TERMIN}' and \"teilnahmeId\"='${TEILNAHME_ID}';")" "${DOZENT_ID}")"

# Ueberschreib-Pfad (Autoritaet des Dozenten): DT2 traegt eine SELBSTBESTAETIGUNG der
# Teilnehmerin (NACHGEARBEITET, erfasstVonId = sie selbst, aus Abschnitt 28). Der Dozent
# DARF sie ueberschreiben — der Teilnehmer-Pfad darf einen fremden Eintrag gerade NICHT.
# Vorbedingung explizit sichern, damit der Test wirklich den UPDATE-Zweig prueft und
# nicht lautlos zum Insert-Zweig degradiert, falls sich die Abende-Reihenfolge aendert.
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
# Schema: Tabelle, Unique-Index (je Teilnahme x Kurseinheit), Enum, CASCADE.
pruefe "Tabelle leistungen existiert" \
  "$(gleich "$($PSQL "select count(*) from information_schema.tables where table_name='leistungen';")" "1")"
pruefe "Unique-Index (teilnahmeId, kurseinheitId) existiert" \
  "$(gleich "$($PSQL "select count(*) from pg_indexes where tablename='leistungen' and indexname='leistungen_teilnahmeId_kurseinheitId_key';")" "1")"
pruefe "Enum Leistungsergebnis existiert" \
  "$(gleich "$($PSQL "select count(*) from pg_type where typname='Leistungsergebnis';")" "1")"
pruefe "FK auf kurseinheiten loescht mit (CASCADE)" \
  "$(gleich "$($PSQL "select confdeltype from pg_constraint where conname='leistungen_kurseinheitId_fkey';")" "c")"

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

# Schueler-Selbstansicht: die eigene Note erscheint in /meine-daten (Klartext).
TN_NOTEN=$(curl -s "${BASIS}/meine-daten" -H "Cookie: ${KEKS2}")
pruefe "der Schueler sieht den Abschnitt Meine Noten" "$(enthaelt "$TN_NOTEN" 'Meine Noten')"
pruefe "der Schueler sieht sein Ergebnis im Klartext (erfolgreich teilgenommen)" "$(enthaelt "$TN_NOTEN" 'erfolgreich teilgenommen')"

# Schulleitungs-Notenseite rendert die Kurseinheit-Matrix (nicht nur die Ueberschrift).
SL_SEITE=$(curl -s "${BASIS}/verwaltung/noten" -H "Cookie: ${KEKS}")
pruefe "die Notenseite der Schulleitung rendert die Matrix" "$(enthaelt "$SL_SEITE" 'Noten (')"

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

# 375 Pruefungen plus diese eine, die sich selbst mitzaehlt.
SOLL=376
pruefe "alle ${SOLL} Pruefungen sind gelaufen" "$(gleich "$((ok + fehler + 1))" "${SOLL}")" "$((ok + fehler + 1))"

echo
echo "${ok} Pruefungen bestanden, ${fehler} fehlgeschlagen."
[ "$fehler" = "0" ] || exit 1
