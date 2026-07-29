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
docker run -d --name gbs-durchstich -p ${PORT}:3000 \
  -e DATABASE_URL="postgresql://gbs:gbs_dev_2026@host.docker.internal:5434/${DBNAME}?schema=public" \
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

# Soll-Anzahl, wie in den vier Fachlogik-Skripten. Ohne sie meldet ein Lauf, der
# unterwegs einen ganzen Block ueberspringt, weiterhin "0 fehlgeschlagen" — ein
# nicht gelaufener Test schlaegt nicht fehl, er fehlt nur. Beim Ergaenzen einer
# Pruefung gehoert diese Zahl mit angehoben.
# 193 Pruefungen plus diese eine, die sich selbst mitzaehlt.
SOLL=194
pruefe "alle ${SOLL} Pruefungen sind gelaufen" "$(gleich "$((ok + fehler + 1))" "${SOLL}")" "$((ok + fehler + 1))"

echo
echo "${ok} Pruefungen bestanden, ${fehler} fehlgeschlagen."
[ "$fehler" = "0" ] || exit 1
