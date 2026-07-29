# Übergabe — Stand 28.07.2026

Diese Datei ist der Einstieg in eine neue Arbeitssitzung. Sie enthält, was man wissen muss, ohne den
bisherigen Gesprächsverlauf zu kennen: was zuerst zu tun ist, wie man das Projekt zum Laufen bringt,
welche Entscheidungen feststehen, welche Fallen es gibt und was als Nächstes ansteht.

Fachliche Fragen beantwortet [`../1_Bauplan.html`](../1_Bauplan.html), technische das
[README](README.md). Die beiden Review-Berichte: [erstes Review](../2_Code-Review.html) (vormittags,
211 Befunde) und [zweites Review samt Komplettfix](../3_Code-Review-2.html) (abends, 160 Befunde).

---

## 🟢 Der Verifikationslauf ist erledigt (28.07.2026)

**Release 0.1 ist vollständig geprüft.** Der Lauf, der am 27.07. an der vollen Festplatte gescheitert
war, ist nachgeholt — Produktionsbuild grün (und damit die Typprüfung des ganzen Standes, den sechs
Agenten ohne mitlesenden Compiler geschrieben hatten: **kein einziger Typfehler**), **179**
Fachlogik-Prüfungen, **14** Mutationstests der Passwortlogik, **150** Durchstich-Prüfungen gegen das
gebaute Image. Alles grün. Zwei Lücken kamen heraus, **beide in den Prüfskripten, keine in der
Anwendung** — Einzelheiten im README-Abschnitt „Verifikationslauf vom 28.07.2026":

- Die Speichergrenze `MAXMEM` war von keiner Prüfung gedeckt (zwei Prüfungen ergänzt).
- „Ohne erkennbare Herkunft wird abgewiesen" konnte nie feuern, weil Next.js bei fehlendem Header
  selbst ein `X-Forwarded-For` einsetzt. Die Prüfung schickt ihn jetzt **leer** mit.

**Damit ist als Nächstes der Laientest fällig** — siehe „Was als Nächstes gebaut wird".

### So prüfst du den Stand nachvollziehbar

Erst Platz und Docker im Blick behalten: Am 27.07. war die Platte voll (433 von 460 GB), am 28.07.
belegte allein der **Build-Cache 29,9 GB**. Freigeben mit `docker builder prune -af` — **nicht** mit
`docker system prune -a --volumes`: In derselben Docker-Instanz liegen die Dev-Datenbanken anderer
Projekte, und die nimmt `--volumes` mit.

```bash
docker build --target builder -t gbs-campus-builder:local . > /tmp/build.log 2>&1; echo "Exit: $?"
```

Dieser Build **ist** die Typprüfung: `next build` prüft die Typen mit, und `ignoreBuildErrors` ist
nicht gesetzt. Lokal `npm run typecheck` zu versuchen, lohnt auf diesem Rechner nicht (Sync-Dienste,
siehe unten) — und ohne `prisma generate` prüft es ohnehin keine Prisma-Feldnamen.

```bash
docker run --rm gbs-campus-builder:local npm run pruefen
```

Soll: **179 Prüfungen** (43 Formular + 54 Semester + 46 Selbstpflege + 36 Passwort). Jedes Skript
meldet am Ende selbst, ob wirklich alle gelaufen sind.

```bash
docker build -t gbs-campus-test:local . > /tmp/build.log 2>&1 && bash scripts/durchstich.sh
```

Soll: **150 Prüfungen**. Der Durchstich braucht die Dev-Datenbank auf Port 5434 (`docker start
gbs-campus-db-dev`) und legt sich darin eine eigene Datenbank `gbs_durchstich` an. Auch er zählt jetzt
gegen eine Soll-Zahl (`SOLL=150` am Skriptende) — beim Ergänzen einer Prüfung mit anheben.

Drei Prüfungen sind maschinenabhängig und können auf einer belasteten Maschine ausschlagen: die
Laufzeitgrenzen im Durchstich (650 ms / 300 ms Abstand), der Faktor 2 bei der Laufzeitangleichung und
der Faktor 4 bei der Abweisung aufgeblasener Kostenparameter. Wenn sie rot werden: erst prüfen, ob
wirklich etwas kaputt ist, bevor die Grenzen aufgeweicht werden.

---

## Am Nachmittag des 28.07. dazugekommen

**Das Anmeldeformular bildet jetzt die Bewerbungs-Vorlage der Schule ab.** Aus der bisherigen schlanken
Fassung wurde ein vollständiges Bewerbungsformular: 6 Abschnitte, 30 Felder — persönliche Daten, Bildung
und Beruf, geistlicher Werdegang, Bewerbungshintergrund, Teilnahmeform, Bankverbindung. Die Definition
liegt seit dem 29.07. als gemeinsame Quelle in
[`prisma/anmeldeformular-definition.ts`](prisma/anmeldeformular-definition.ts) und ist der
**Seed-Standard** — ein frischer `db:seed` legt sie an. Das manuelle Nachtrag-Skript
[`scripts/anmeldeformular-bewerbung.ts`](scripts/anmeldeformular-bewerbung.ts) nutzt dieselbe Quelle und
spielt sie als neue Fassung gegen eine bereits laufende Instanz ein.

**Neuer IBAN-Prüfer** im öffentlichen Formular ([`oeffentliches-formular.tsx`](src/app/anmeldung/oeffentliches-formular.tsx),
Komponente `IbanEingabe`): Live-Formatierung in Vierergruppen, Prüfziffer-Check nach ISO 13616 über die
**geteilte** Funktion `istIbanGueltig` (`src/lib/pruefwerte.ts` — Client und Server prüfen identisch),
grün bei gültiger Prüfziffer, rot beim Verlassen eines falschen Felds. Der Cursor bleibt beim
Umformatieren an seiner Stelle.

**Mehr-Agenten-Code-Review** (`/engineering:code-review` als Workflow, 15 Agenten) fand 12 verifizierte
Befunde; die vier echten Fehler sind behoben und einzeln nachgemessen:

- **Art-9-Leck (schwer):** `motivation` und `ziele` trugen kein `istArt9` — glaubensoffenbarende
  Angaben wären über den Entwurf-Speicherpfad **ohne Einwilligung** in der Datenbank gelandet. Jetzt
  `istArt9=true`; beide Glaubens-Abschnitte sind vollständig bis zur Einwilligung verborgen.
- **Akte-Zuordnung:** „PLZ und Ort" war ein Feld ohne Aktenbezug, der Kontoinhaber fehlte ganz. Jetzt
  `plz`/`ort`/`kontoinhaber` getrennt mit `personFeld` — sonst blieben diese Stammdaten leer, und der
  SEPA-Einzug hätte keinen Kontoinhaber.
- **Leere Pflicht-IBAN:** Der Serverfehler wurde am Feld verschluckt. Behoben, per End-to-End-Test
  bestätigt (roter Rahmen + „Pflichtfeld"-Meldung + `aria-invalid`).
- **Barrierefreiheit:** `aria-describedby` zeigte ins Leere; jetzt auf die reale Statuszeile.

Dazu zwei Härtungen: Der Klartextschutz der IBAN hängt jetzt am **Feldtyp** `IBAN` (nicht nur an der
Akte-Zuordnung), und `IBAN_LAENGE` deckt die SEPA-Länder ab.

**Der Formular-Builder kann Pflicht/Optional schon.** Jedes Feld hat unter `/verwaltung/formulare` ein
Häkchen „Pflichtfeld" (und daneben „Art-9") — bearbeitbar aber nur an einer **Entwurfsfassung**, denn
veröffentlichte Fassungen sind unveränderlich. Zum Ändern: neue Entwurfsfassung anlegen, Häkchen setzen,
veröffentlichen.

### Lokale Testinstanz (zum Durchklicken)

Läuft als Docker-Container aus dem Produktions-Image gegen die Entwicklungsdatenbank — nicht als
`npm run dev` (das hängt hier an den Sync-Diensten). **Wegwerf-Testwerte, nicht für Produktion:**

```bash
docker run -d --name gbs-laientest -p 3000:3000 \
  -e DATABASE_URL="postgresql://gbs:gbs_dev_2026@host.docker.internal:5434/gbs_campus?schema=public" \
  -e SESSION_SECRET="$(printf '2%.0s' {1..64})" -e ENCRYPTION_KEY="$(printf '1%.0s' {1..64})" \
  -e APP_URL="http://127.0.0.1:3000" -e TZ=Europe/Berlin gbs-campus-test:local
```

`APP_URL` muss **`127.0.0.1`** sein, nicht `localhost`: Der Startprüfer verbietet `localhost` bei
`NODE_ENV=production`, und `NODE_ENV` ist im Standalone-Build fest einkompiliert (ein Runtime-Override
wirkt nicht). Folge: Magic-Links werden **nie** geloggt — in der Testinstanz meldet man sich per
**Passwort** an. Ein Schulleitungskonto anlegen (Passwort-Hash direkt in die DB, weil `testperson-anlegen.ts`
keins setzt) und mindestens ein Semester mit offenem Anmeldefenster (siehe `/verwaltung/semester`).

---

## Am 29.07. dazugekommen

**Absenderadresse für den Mailversand steht fest:** `no-reply@gbs-minden.de` (in `.env.example`).
**SPF/DKIM/DMARC gelten damit für `gbs-minden.de`**, nicht für `gbs.fes-credo.de`. `no-reply@` nimmt
keine Antworten an — sobald ein betreutes Postfach feststeht, in `MAIL_ANTWORT_AN` eintragen.

**Datenauskunft nach Art. 15 DSGVO — neu.** Verwaltung → Personen → „DSGVO-Auskunft senden" (Recht
`PERSON_EXPORTIEREN`) schickt der Person einen **persönlichen, 3 Tage gültigen Abruf-Link**; sie lädt
ihre vollständige Datenkopie (inkl. Glaubensangaben nach Art. 9 und IBAN im Klartext) selbst als **PDF**
herunter. Die sensiblen Daten verlassen bewusst **nicht** den Mailkanal — dieselbe Linie wie bei der
IBAN im Excel-Export. Der PDF-Erzeuger (`src/lib/pdf.ts`) ist **reiner Node-Code ohne neue
Abhängigkeit** (wegen `npm ci --ignore-scripts`, wie scrypt statt bcrypt). Kernstücke:
`src/lib/auskunft.ts` (Token/DB/PDF), `src/lib/auskunft-inhalt.ts` (reine, testbare Inhaltslogik),
Routen `api/personen/[id]/auskunft` (anstoßen) und `api/auskunft/abrufen` (POST-Einlösung), Abrufseite
`/auskunft/token`, Mail-Vorlage `AUSKUNFT_BEREIT`. Token nur als SHA-256-Hash gespeichert, Abruf
mehrfach bis Ablauf, abgelaufene Token werden im Aufräumlauf gelöscht.

**Token im Adressfragment (beide Links).** Anmelde- und Auskunftslink tragen den Token jetzt im
Fragment (`…#token=…`) statt im Query-String — er landet damit in keinem Proxy-Zugriffslog (siehe den
erledigten Punkt oben). Die Bestätigungsseiten lesen ihn clientseitig aus `location.hash`.

**Verifiziert (29.07.):** Produktionsbuild grün (Typprüfung des ganzen Standes), **227**
Fachlogik-Prüfungen (inkl. 32 für Auskunft/PDF und 16 für Beitrag), **30** DB-Prüfungen (inkl.
Token-Roundtrip, Verstorbenen-Sperre und IBAN-Fehlerpfad), **Durchstich 162/162** (Login-, Aufnahme-,
Ehepartner-Ermäßigungs- und Auskunft-Routen-Regression gegen das große Bewerbungsformular), Migration +
Tabellenstruktur
gegen `information_schema`/`pg_constraint`. Der Fragment-Login wurde zusätzlich **live im Browser**
gegen das Produktions-Image geprüft (Token im `#` → angemeldet → Portal; Auskunft-Abruf → 200 PDF).
Ein adversariales Mehr-Agenten-Review (11 Agenten) fand 5 Befunde für die Auskunft — alle behoben und
nachgemessen. Neue Prüfskripte: `scripts/pruefe-auskunft.ts`, `scripts/pruefe-beitrag.ts`
(`npm run pruefen`) und `scripts/pruefe-auskunft-db.ts` (`npm run pruefen:db`).

**GoLive-Review (7 Agenten, 29.07.):** Security, UI/UX, Performance, Architektur, Testing,
Error-Handling und Code-Qualität haben den ganzen Session-Stand geprüft — **0 CRITICAL, 3 MAJOR, 18
MINOR**. Die drei MAJOR sind behoben und nachgemessen: (1) die Ehepartner-Ermäßigung wird bei der
Aufnahme jetzt sichtbar gemeldet (vorher stumm gesetzt), (2) die Verstorbenen-Sperre beim Abruf liegt
jetzt in der testbaren Lib-Funktion `ruftAuskunftAb` und ist mutationssicher geprüft, (3) die
Auskunft-Routen sind im Durchstich abgedeckt (Sektion 21). Dazu vier günstige MINOR (freundliches
PDF-Statuslabel, lautes Logging bei IBAN-Decrypt-Fehler, try/catch+Audit beim Abruf, zentrale
`hashToken`). Der Report liegt in [`../4_Code-Review-3.html`](../4_Code-Review-3.html). Offen (optional,
kein Blocker): `PERSON_EXPORTIEREN` semantisch entkoppeln, 72-h-Frist als Einstellung, offene
Auskunftsverlangen in der Betriebsansicht sichtbar machen, Fragment-Leser-Hook, Rate-Limit auf den
Fehler-Audit-Pfad.

---

## In fünf Minuten lauffähig

```bash
docker start gbs-campus-db-dev || docker run -d --name gbs-campus-db-dev -e POSTGRES_DB=gbs_campus -e POSTGRES_USER=gbs -e POSTGRES_PASSWORD=gbs_dev_2026 -p 5434:5432 postgres:16-alpine
```

```bash
cd gbs-campus && export DATABASE_URL="postgresql://gbs:gbs_dev_2026@localhost:5434/gbs_campus?schema=public" && export ENCRYPTION_KEY="$(openssl rand -hex 32)" && export SESSION_SECRET="$(openssl rand -hex 32)" && export APP_URL="http://localhost:3000" && npm run dev
```

Ein Konto zum Anmelden gibt es noch nicht — es existiert keine Benutzerverwaltung. Für die Entwicklung:

```bash
npx tsx scripts/testperson-anlegen.ts peter@beispiel.de SCHULLEITER
```

Der Anmeldelink erscheint dann im Serverlog (nur außerhalb von `NODE_ENV=production` — in Produktion
wird er bewusst **nicht** geloggt, weil er ein vollwertiger Kontoschlüssel ist).

Wenn `npm run dev` mit einem Prisma-Fehler abbricht (`loadConfigFromFile is not a function` oder
`require_main is not a function`), ist nicht der Code kaputt, sondern die lokale `node_modules` —
siehe den nächsten Abschnitt. Prüfen und verifizieren lässt sich dann alles im Image.

---

## Fallen, die schon Zeit gekostet haben

**Der Rechner synchronisiert den Projektordner.** Synology Drive und iCloud Drive indizieren den
Desktop mitsamt `node_modules` — rund 50.000 Dateien. Folgen: `tsc` und `next build` bleiben bei 0 %
CPU hängen, und einmal wurde eine Paketdatei mit Nullbytes überschrieben. **Verifiziere im Docker-Build,
nicht lokal.** Besser noch: `node_modules` und `.next` von der Synchronisierung ausnehmen.

**`| tail` verschluckt den Exit-Code.** `docker build … | tail -20` meldet Erfolg, auch wenn der Build
gescheitert ist. Bei allem, wo der Exit-Code zählt: in eine Datei umleiten und `$?` prüfen.

**`prisma migrate dev` läuft hier nicht** (nicht-interaktive Umgebung). Migrationen so erzeugen:

```bash
docker exec gbs-campus-db-dev psql -U gbs -d postgres -c "DROP DATABASE IF EXISTS gbs_shadow;" -c "CREATE DATABASE gbs_shadow OWNER gbs;"
```

```bash
./node_modules/.bin/prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "postgresql://gbs:gbs_dev_2026@localhost:5434/gbs_shadow?schema=public" --script > /tmp/neu.sql
```

Erst **danach** den Migrationsordner anlegen und die Datei hineinkopieren — ein leerer Ordner bringt
`--from-migrations` zum Abbruch.

**`prisma migrate deploy` trägt eine Migration als angewendet ein, wenn die `migration.sql` beim Lesen
leer ist.** Passiert im Wettlauf mit einem noch schreibenden Prozess. Ergebnis: Die Datenbank meldet
„keine ausstehenden Migrationen", das Schema fehlt aber. **Nach jeder Migration gegen
`information_schema` gegenprüfen**, nicht der Erfolgsmeldung glauben. Reparatur: Zeile aus
`_prisma_migrations` löschen (`migrate resolve --rolled-back` greift nur bei *fehlgeschlagenen*), dann
erneut deployen.

**Die Lockfile muss mit der npm-Version des Images erzeugt werden**, sonst scheitert `npm ci` im Build
an `ajv`:

```bash
docker run --rm -v "$PWD":/app -w /app node:24-alpine npm install --package-lock-only
```

**Ein lokales `npm install` kann `node_modules/@prisma` zerlegen.** Am 27.07. hat ein
`npm install --no-save exceljs` die Prisma-Pakete in einen Mischzustand gebracht: Die CLI meldete
`(0 , Qke.loadConfigFromFile) is not a function`, danach `require_main is not a function`, am Ende
fehlte `node_modules/prisma` ganz und der Symlink in `.bin` zeigte ins Leere. Auch ein Bind-Mount des
Projektordners in einen Container hilft nicht: Docker bekommt beim Lesen `Unknown system error -35`
(EAGAIN) auf Dateien, die der Sync-Dienst gerade nicht bereitstellt.

Repariert hat es das gezielte Nachinstallieren — **ohne** `node_modules` zu löschen und ohne die
Lockfile anzufassen. Es dauert auf diesem Rechner allerdings 37 Minuten für 31 Pakete; nicht abbrechen,
nur weil nichts passiert:

```bash
npm install --no-save --no-audit --no-fund prisma@6.19.3 @prisma/client@6.19.3
```

**Was funktioniert: alles im Image prüfen.** Die Builder-Stufe enthält Quelltext und
Entwicklungsabhängigkeiten:

```bash
docker build --target builder -t gbs-campus-builder:local . > /tmp/build.log 2>&1; echo "Exit: $?"
```

```bash
docker run --rm gbs-campus-builder:local npm run pruefen
```

Damit laufen auch die Mutationstests, ohne die Arbeitskopie anzufassen — die Regel wird IM Container
entfernt:

```bash
docker run --rm gbs-campus-builder:local sh -c "sed -i 's/if (ende.getTime() <= start.getTime())/if (false)/' src/lib/semester.ts && npx tsx scripts/pruefe-semesterlogik.ts | grep -E 'FEHLT|fehlgeschlagen'"
```

Migrationen gegen die Entwicklungsdatenbank ebenso über das fertige Image:

```bash
docker run --rm --entrypoint sh -e DATABASE_URL="postgresql://gbs:gbs_dev_2026@host.docker.internal:5434/gbs_campus?schema=public" gbs-campus-test:local -c "prisma migrate deploy && node prisma/seed.js"
```

**`prisma migrate diff` lief gar nicht durch** (dieselbe Ursache). Die Migration
`20260727170000_anmeldung_semesterbezug` ist deshalb von Hand geschrieben — mit den Namen, die Prisma
selbst vergeben hätte (`anmeldungen_semesterId_idx`, `anmeldungen_semesterId_fkey`) — und anschließend
gegen `information_schema` und `pg_constraint` gegengeprüft.

---

## Entscheidungen, die feststehen

Nicht neu aufrollen — sie sind begründet und im Bauplan dokumentiert.

| Entscheidung | Begründung |
|---|---|
| **Kein Redis, kein Worker in 0.1** | Magic-Links sind über `benutztAm` in Postgres single-use, Rate-Limiting läuft über `rate_limit`. Bei 150 Konten reicht das und spart einen Container im Notfall-Runbook. |
| **Statusmaschine als Tabelle, nicht als Enum** | Muss sich ohne Deploy erweitern lassen. Die fünf Schalter je Zustand steuern, welche Automatik überhaupt feuern darf. |
| **Rechtematrix als Datensatz** | Ebenso. Codes stehen in `src/lib/constants.ts`, damit ein Tippfehler nicht zu lautlosem Rechteentzug führt. |
| **Kein Referenz-/Zulassungsgate** | der Schulleiter im Interview: „wir arbeiten halt nicht mit Referenzen". Bestätigung durch den Trägerkreis steht noch aus (E-02), blockiert aber nichts. |
| **Material bleibt in Teams** | Zweimal im Interview bestätigt. Keine Materialplattform in 0.1 oder 0.2. |
| **Formular-Builder wird gebaut** | Steht wörtlich im Interview. War kurzzeitig gestrichen — die Streichung beruhte auf einer zu engen Lesart und ist zurückgenommen. |
| **Ehepartner-Rabatt 50 %** | Existiert. Als konfigurierbare Tabelle umgesetzt, nicht als fest verdrahteter Satz. |
| **Keine automatische Absage-Mail** | Eine Absage an jemanden, der sich für eine Bibelschule beworben hat, formuliert der Schulleiter selbst. |

---

## Regeln, die aus Fehlern entstanden sind

Diese drei haben je einen echten Blocker verursacht. Sie gelten für alles Weitere.

**1. Eine Zusage gilt erst, wenn *alle* Schreibpfade dagegen geprüft sind.**
Die Art.-9-Sperre war korrekt implementiert — aber nur im Absende-Pfad. Der Zwischenspeichern-Pfad
wurde zwei Schritte später gebaut und nie gegen dieselbe Zusage gehalten. Ergebnis: Glaubensangaben
ohne jede Einwilligung in der Datenbank. Dasselbe Muster bei der IBAN: die verschlüsselte Spalte wurde
geprüft, die unverschlüsselte daneben übersehen.

**2. Ein grünes Prüfskript beweist nichts, bis gezeigt ist, dass es rot wird.**
Vier von 29 Prüfungen bestanden unabhängig von der geprüften Regel, weil der Testschlüssel ein
einzelnes Zeichen war und schon die Format-Regel verletzte. Bei jeder neuen Prüfung: Regel
auskommentieren, Skript laufen lassen, muss fehlschlagen.

**3. Was der Betrieb nicht sehen kann, ist kaputt.**
Das Backup lief nie und niemand hätte es gemerkt. Fehlgeschlagene Mails standen sauber in der
Datenbank, aber keine Oberfläche las sie. Bei Bus-Faktor 1 gilt: Jeder stille Ausfallpfad braucht
entweder einen Alarm oder eine Ansicht.

Dazu eine technische: **Row-Level-Trigger greifen nicht bei `TRUNCATE`** — dafür braucht es
zusätzlich Statement-Level-Trigger.

---

## Prüfen, ob noch alles steht

```bash
npm run pruefen
```

179 Prüfungen der Fachlogik (Formular, Semester, Selbstpflege, Zugang, Passwort), ohne Datenbank. Dann
der vollständige Durchstich mit 150 Prüfungen:

```bash
docker build -t gbs-campus-test:local . > /tmp/build.log 2>&1; echo "Exit: $?"
```

Danach Container gegen eine frische Datenbank starten und die Nachweise aus dem README-Abschnitt
„Verifiziert" nachvollziehen. Die wichtigsten vier:

| Prüfung | Erwartung |
|---|---|
| Entwurf mit Glaubensangabe ohne Einwilligung speichern | nur unverfängliche Felder landen in `anmeldungen.antworten` |
| Anmeldung absenden, dann `SELECT antworten->>'iban'` | leer — die IBAN steht nur verschlüsselt an der Person |
| `DELETE`/`TRUNCATE` auf `einwilligungen` und `audit_log` | alle vier abgewiesen |
| Backup-Container starten | erzeugt sofort einen Dump, `gzip -t` besteht |
| Teilnehmerliste als Excel-Datei herunterladen | enthält die Teilnehmer, **keine IBAN** |
| Unter `/meine-daten` speichern, IBAN-Feld leer lassen | Bankverbindung unverändert |
| Neue E-Mail-Adresse beantragen | Adresse in der Akte bleibt, bis der Link geklickt ist |

---

## Was seit dem Review dazugekommen ist

**Semester** (`/verwaltung/semester`, Recht `SEMESTER_VERWALTEN` bei Schulleitung und Verwaltung):
anlegen, bearbeiten, das laufende festlegen. Genau eines läuft — der partielle Unique-Index erzwingt
das, deshalb setzt das Umschalten in einer Transaktion erst alle zurück.

**Anmeldungen tragen ihr Semester** (`anmeldungen.semesterId`, Migration
`20260727170000_anmeldung_semesterbezug`). Zugeordnet wird beim Einreichen: erst ein Semester mit
offenem Anmeldefenster, sonst das laufende. Die Entscheidung steht in `src/lib/semester.ts` und ist
ohne Datenbank prüfbar.

**Teilnehmerliste „Aktive dieses Semester"** (`/verwaltung/teilnehmer`) mit **Excel-Export**
(`exceljs` wieder aufgenommen). Die Teilnahme entsteht bei der Aufnahme, in derselben Transaktion wie
der Statuswechsel. Wer schon vorher aufgenommen war, kommt über die Sammelübernahme dazu.

Drei Dinge, die man dabei wissen sollte:

- **Ohne Semester oder ohne Teilnahmeform entsteht keine Teilnahme** — und der Bildschirm sagt es
  ausdrücklich. Geraten wird nicht: an der Teilnahmeform hängen Prüfungspflicht, Zeugnis und ab 0.3
  der Beitrag.
- **In der Excel-Datei steht keine Bankverbindung.** Die Spalten stehen in `EXPORT_SPALTEN`; das
  Prüfskript wird rot, sobald jemand eine IBAN-Spalte ergänzt oder das Bankfeld in die Listenabfrage
  zurückholt.
- **Semesterdaten sind Kalendertage.** UTC für die Daten, örtliche Zeit für „heute" — sonst ist ein
  Anmeldeschluss je nach Zeitzone einen Tag zu früh vorbei.

**Schülerakte mit Selbstpflege** (`/meine-daten`): Adresse, Telefon und Bankverbindung ändern
Teilnehmer selbst, die Verwaltung wird per Mail informiert. Die E-Mail-Adresse läuft über einen
Bestätigungsweg — Antrag, Link an die neue Adresse, Hinweis an die alte, erst der Klick setzt sie.
Grund: Sie ist der einzige Kontoschlüssel, und es gibt keine Oberfläche, mit der die Verwaltung eine
vertippte Adresse korrigieren könnte. Teilnehmer landen nach dem Anmelden dort statt in einem leeren
Verwaltungsbereich.

Zwei Dinge, die man beim Weiterbauen nicht kaputtmachen darf:

- **Ein leeres IBAN-Feld löscht nichts.** Die Bankverbindung wird nie im Klartext angezeigt, das Feld
  ist deshalb immer leer. Gälte leer als „löschen", hätte jede Adressänderung den Beitragseinzug
  mitgelöscht.
- **Die Antwort verrät nicht, ob eine Adresse vergeben ist.** Sonst wäre der Endpunkt eine Auskunft
  darüber, wer die Bibelschule besucht (Art. 9 DSGVO).

**Zwei Wege ins Portal.** Der Anmeldelink ist der Regelweg. Dazu kommt ein **freiwilliges Passwort**
(`/anmelden/passwort`, scrypt) — aus genau einem Grund: Der Link hängt am Postfach. Damit deckt sich
jeder *einzelne* Verlust selbst ab:

| Verloren | Weg zurück |
|---|---|
| Passwort vergessen | Anmeldelink anfordern, im Portal ein neues setzen |
| Postfach nicht erreichbar | Mit Passwort anmelden, unter „Meine Daten" die Adresse ändern |
| Beides zugleich | Meldung über `/anmelden/hilfe` — hier muss ein Mensch erkennen, wer da schreibt |

Es gibt bewusst **kein eigenes Zurücksetzen-Verfahren**: Der Anmeldelink *ist* der Weg zurück. Ein
zweiter Token-Typ mit eigener Tabelle, eigener Frist und eigenem Missbrauchsweg wäre Verdopplung.

**Zugang wiederherstellen** für den Fall, dass beides fehlt:

- `/anmelden/hilfe` ist das öffentliche Meldeformular. Es **ändert nichts** und antwortet immer
  gleich, auch für Namen, die es nicht gibt. Die Meldung geht an Schulleitung *und* Verwaltung und
  trägt den Hinweis, dass die Angaben ungeprüft sind.
- `/verwaltung/personen` ist die Gegenseite: suchen, Anmeldeadresse ändern, Anmeldelink schicken
  (Recht `PERSON_BEARBEITEN_ALLE`, nicht der Administrator). Der Vorgang entwertet **den alten Zugang
  vollständig** — offene Änderungsanträge, offene Anmeldelinks und ein gesetztes Passwort. Beide
  Adressen werden benachrichtigt, alles steht im Audit-Log. Ein Konto mit weitergehenden Rechten als
  der Handelnde lässt sich nicht ändern, das eigene auch nicht.

Wer daran weiterbaut, drei Sätze zum Merken:

- **Die Adressänderung ist faktisch eine Kontoübernahme.** Sie darf nie automatisch aus einer Meldung
  folgen — es muss ein Mensch die Person erkannt haben.
- **Die Antwortzeit ist Teil der Zusage.** `/api/auth/anmelden` hat eine Mindestlaufzeit von 700 ms,
  der Passwort-Login rechnet auch bei unbekannter Adresse eine volle scrypt-Runde. Wer das als
  Trägheit missversteht und herausnimmt, macht beide Endpunkte zur Auskunftsstelle darüber, wer die
  Bibelschule besucht (Art. 9 DSGVO).
- **Sitzungen sind widerrufbar.** `person.passwortGeaendertAm` wird gegen den Ausstellungszeitpunkt
  des Sitzungstokens geprüft. Wer eine Passwort- oder Adressänderung schreibt, muss deshalb
  anschließend `sitzungAnlegen()` aufrufen, sonst sperrt sich der Handelnde selbst aus.

## Was als Nächstes gebaut wird

**Der Verifikationslauf ist am 28.07. grün durchgelaufen** — siehe ganz oben. Damit ist der Weg für
alles Weitere frei.

**Punkt (2) ist am 29.07. erledigt:** Die **vier Beträge liegen als Einstellungen** (Bereich BEITRAG,
20/120/30/180 €, konfigurierbar unter `/verwaltung/einstellungen`), und die **Ehepartner-50 %-Ermäßigung**
wird bei der Aufnahme am Konto gesetzt, wenn die Anmeldung die gemeinsame Anmeldung mit dem Ehepartner
bejaht (`ehepartner_gemeinsam`) — Logik in `src/lib/beitrag.ts`, geprüft in `scripts/pruefe-beitrag.ts`
(16 Prüfungen). Die eigentliche Beitragsberechnung/-einzug bleibt Release 0.3.

**Punkt (1) ist am 29.07. erledigt:** Das Bewerbungsformular (6 Abschnitte, 30 Felder) ist jetzt der
**Seed-Standard** — ein frischer `db:seed` legt es an. Die Definition liegt als **eine gemeinsame
Quelle** in `prisma/anmeldeformular-definition.ts`, die sowohl der Seed als auch das manuelle
Nachtrag-Skript `scripts/anmeldeformular-bewerbung.ts` nutzen (keine Doppelpflege mehr). Der Durchstich
ist gegen das größere Formular nachgezogen (Anmeldung mit allen neuen Pflichtfeldern, Feldcode
`gemeinde` → `gemeinde_mitglied`) und um eine End-to-End-Prüfung der Ehepartner-Ermäßigung erweitert —
jetzt **152 Prüfungen, 0 fehlgeschlagen**.

Damit sind beide Roadmap-Punkte des Nachmittags erledigt.

**Release 0.2 begonnen (29.07.): Semesterüberleitung & Kursraster.** Das Re-Enrollment ist gebaut:
`/verwaltung/semesterueberleitung` lädt den Jahrgang des laufenden Semesters ins Folgesemester ein;
jeder aktive Teilnehmer bekommt einen persönlichen „Ich bin dabei"-Link (`/dabei/token`, Token im
Fragment, ohne Login — er setzt nur `Teilnahme.bestaetigtAm`, meldet niemanden an). Erinnerungen
T−14/−7/−3 Tage vor Semesterstart laufen über `POST /api/cron/erinnerungen` (per `CRON_SECRET`
geschützt, idempotent, kein Doppelversand) — der externe Zeitgeber ist der einzige offene
Betriebspunkt (siehe „Bekannte Einschränkungen"). Dazu ein **Kursraster als Grundstein für den
Stundenplan (M3)**: sieben Fächer, dreizehn Kurseinheiten und die **sechs realen Semester**
(2026-H … 2029-F, Termine von gbs-minden.de) legt jetzt ein frischer `db:seed` an — die konkreten
Semester sind über `lehrjahr`/`halbjahr` ans Raster gekoppelt, sodass die „bin dabei"-Seite die Fächer
des Zielsemesters zeigt. Logik: `src/lib/ueberleitung.ts` (IO) und `src/lib/semester.ts` /
`src/lib/faecher.ts` (DB-frei).

Und der **Stundenplan (M3)**: `/verwaltung/stundenplan` legt die Unterrichtsabende eines Semesters an
(die zehn Dienstagabende ab Semesterbeginn per Knopf), ordnet jedem Abend eine Kurseinheit zu und
erfasst die **Anwesenheit** je Teilnahme × Termin (anwesend / entschuldigt / gefehlt / nachgearbeitet).
Die **Quote** zählt anwesend und nachgearbeitet als Teilnahme; unter der Schwelle
(`ANWESENHEIT_MINDEST_PROZENT`, Standard 80 %) wird sie markiert. DB-freie Kernlogik in
`src/lib/stundenplan.ts` (Quote + Dienstags-Generator), IO in `src/lib/stundenplan-io.ts`.

Verifiziert: **282 DB-freie Fachlogik-Prüfungen** (neu u. a. 20 zum Stundenplan, 18 zur Überleitung,
17 zum Kursraster) und **194 Durchstich-Prüfungen** gegen das gebaute Image — alles grün,
Produktionsbuild (`next build`) ohne einen Typfehler.

**Das Löschkonzept nach Art. 17 DSGVO** (anonymisieren statt löschen) bleibt Release 0.2 —
beschrieben unten unter „Bekannte Einschränkungen".

**Vor dem Livegang:** Laientest durch eine projektfremde Person, Restore-Drill, Break-Glass-Tresor
befüllen, Zustellbarkeit der Magic-Link-Mail gegen GMX, web.de, Gmail und Outlook prüfen. Das **erste
Semester ist durch den Seed gesetzt** (2026-H als laufend) — die Schulleitung muss nur bestätigen, dass
das die richtige Wahl ist, bzw. es unter `/verwaltung/semester` umstellen. **Neu für den Betrieb:**
`CRON_SECRET` setzen und einen täglichen Aufruf von `/api/cron/erinnerungen` einrichten, sonst gehen
die Überleitungs-Erinnerungen nicht raus.

Für den Laientest liegt ein fertiges **Drehbuch mit Aufgaben, Rückmeldebogen und der vollständigen
Go-Live-Checkliste** bereit: [`LAIENTEST.md`](LAIENTEST.md). Es führt den Betreuer durch die
Vorbereitung (Umgebung, Semester, Testkonto) und die Testperson durch elf Aufgaben entlang des echten
Wegs — von der öffentlichen Anmeldung über die Aufnahme durch die Schulleitung bis zur Selbstpflege.

### Entscheidungen, die niemand außer dir treffen kann

Sie stehen ausführlich im [zweiten Review-Bericht](../3_Code-Review-2.html), Abschnitt 07 (der
Token-im-Log-Punkt ist am 29.07. erledigt):

| Frage | Worum es geht |
|---|---|
| **Wer sieht die Betriebsansicht?** | Sie hängt an `SYSTEM_EINSTELLUNGEN` — nur der Administrator. Die neuen Warnungen (hängende Mails, Empfänger null, Aufräumlauf tot) sieht damit ein einziges Konto. Beim Protokoll ist die Schulleitung inzwischen dabei. |
| **Token im Zugriffsprotokoll des Proxy** — ✅ erledigt (29.07.) | Anmelde-, Bestätigungs- und Auskunftslink tragen den Token jetzt im **Adressfragment** (`…#token=…`), das der Browser nicht an den Server schickt — Traefik protokolliert ihn damit nicht mehr. Die Bestätigungsseiten lesen ihn clientseitig aus `location.hash`. |
| **Speichergrenze für den App-Container** | Ohne `mem_limit` holt sich der OOM-Killer im Zweifel die Datenbank statt der Anwendung. Empfehlung: 768 MB. |

---

## Bekannte Einschränkungen

- **Kein Off-Site-Backup.** Der Dump liegt auf demselben Host wie die Datenbank.
- **Benutzerverwaltung nur für den Zugang.** Unter `/verwaltung/personen` lassen sich Anmeldeadresse
  ändern und Anmeldelink schicken — mehr nicht. Konten entstehen weiterhin nur über die Anmeldung oder
  von Hand in der Datenbank; Rollen vergeben, Personen anlegen und Stammdaten fremder Personen ändern
  gibt es als Oberfläche noch nicht. `scripts/testperson-anlegen.ts` liegt nicht im Produktions-Image.
- **Der partielle Index `semester_genau_ein_aktuelles` ist Prisma unbekannt.** Partielle Indexe lassen
  sich im Schema nicht ausdrücken; `prisma migrate dev` nimmt deshalb ein `DROP INDEX` in die nächste
  erzeugte Migration auf und die Invariante „genau ein laufendes Semester" fiele lautlos weg.
  **Jede von `migrate dev` erzeugte Migration vor dem Committen ansehen.** Dasselbe gilt für die fünf
  Append-only-Trigger. Der Hinweis steht auch am Semester-Modell in `schema.prisma`.
- **Die Anwendung verbindet sich als Postgres-Eigentümer.** Der Append-only-Schutz ist damit nur so
  stark wie die Trennung der Datenbankrechte. Ein getrennter, rechtebeschränkter Datenbanknutzer ist
  der nächste Härtungsschritt.
- **Keine Content-Security-Policy.** Traefik setzt HSTS, `frameDeny`, `nosniff` und Referrer-Policy;
  CSP fehlt und gehört nachgezogen, bevor irgendwo Formulartexte als Markdown gerendert werden.
- **Eine Person lässt sich nicht mehr löschen** — der Verweis aus dem Audit-Log stößt auf den
  Append-only-Trigger. Für Release 0.1 richtig so. Wer ein Löschkonzept nach Art. 17 DSGVO baut, muss
  anonymisieren statt löschen; die Fehlermeldung der Datenbank weist darauf hin.
- **Semesterüberleitung: keine automatische Zeitsteuerung im Container.** Das Re-Enrollment
  („bin dabei", Einladung + Bestätigung) ist gebaut (0.2, siehe unten). Die Erinnerungen T−14/−7/−3
  laufen über den Endpunkt `POST /api/cron/erinnerungen`, der einen **externen Zeitgeber** braucht
  (systemd-Timer, Cron oder Uptime-Ping, einmal täglich, Header `x-cron-secret`). Ohne gesetztes
  `CRON_SECRET` (siehe `.env.example`) antwortet er mit 503 und es gehen keine Erinnerungen raus. Ein
  eigener Worker-Container, der das intern übernimmt, bleibt Release-0.2-Ausbaustufe.
- **Semester lassen sich nicht löschen** — bewusst kein Endpunkt dafür. Ein gelöschtes Semester
  risse alle Teilnahmen mit (`onDelete: Cascade`); die Anmeldungen blieben erhalten, verlören aber
  ihren Bezug.
