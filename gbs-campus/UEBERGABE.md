# Übergabe — Stand 27.09.2026

Diese Datei ist der Einstieg in eine neue Arbeitssitzung. Sie enthält, was man wissen muss, ohne den
bisherigen Gesprächsverlauf zu kennen: was zuerst zu tun ist, wie man das Projekt zum Laufen bringt,
welche Entscheidungen feststehen, welche Fallen es gibt und was als Nächstes ansteht.

Fachliche Fragen beantwortet [`../1_Bauplan.html`](../1_Bauplan.html), technische das
[README](README.md). Die Review-Berichte: [erstes Review](../2_Code-Review.html) (27.07. vormittags,
211 Befunde), [zweites Review samt Komplettfix](../3_Code-Review-2.html) (27.07. abends, 160 Befunde),
[drittes Review](../4_Code-Review-3.html) (29.07.) und [Code-Review 4](../10_Code-Review-4.md) (27.09.,
19 MAJOR, mit dem Abschnitt „Stand der Behebung“). Den Stand davor fasst
[`../9_Bestandsaufnahme-2026-09-26.md`](../9_Bestandsaufnahme-2026-09-26.md) zusammen.

---

## Neuester Stand (27.09.2026, spät): Empfehlungen für den Semesterbetrieb

Umgesetzt sind die sieben Empfehlungen für den laufenden Semesterbetrieb, die der Projektverantwortliche
freigegeben hat. Verifiziert mit Docker gegen PostgreSQL 16: Build mit **1341 Prüfungen in 20 Skripten** grün
(inkl. Produktionsbuild, 43 Seiten), **Durchstich 850/850**, `pruefen:db` 19 + 18. Die neue Migration
`20260928100000_zeugnis_storno` lief auf einer frischen Datenbank und als Aktualisierung einer bestehenden
Datenbank (mit gültigen und ersetzten Zeugnissen) fehlerfrei.

1. **Zusage von Hand.** Wer telefonisch oder persönlich zusagt, bekommt in der Überleitung unter „Noch ohne
   Antwort“ den Knopf „Zusage eintragen“ (`POST /api/semesterueberleitung/zusage`, Recht `SEMESTER_VERWALTEN`,
   also Schulleitung und Verwaltung). Das geht auch am Starttag noch, solange der Worker nicht abgemeldet hat.
   Audit `TEILNAHME_ZUSAGE_EINGETRAGEN`.
2. **Einladung erneut senden.** Die Überleitungsseite zählt je Zielsemester die nicht zugestellten Einladungen
   (offene Einladung ohne gesendete Einladungs- oder Erinnerungsmail seit der Einladung) und bietet „Erneut
   senden“ (`POST /api/semesterueberleitung/erneut-senden`, nur bis zum Tag vor Semesterbeginn). Es gibt einen
   neuen Link, der alte wird ungültig. Der Worker sendet nichts von selbst nach. Eine Sperre im App-Prozess
   verhindert einen Nachversand, solange ein Versand läuft; sie gilt je Container (bei mehreren Instanzen
   bräuchte es eine Sperre in der Datenbank). Audits `SEMESTER_EINLADUNG_ERNEUT_GESENDET` und
   `SEMESTER_UEBERLEITUNG_VERSENDET` mit `erneut: true`.
3. **Worker-Ausfall abgesichert.** Wer zum Semesterstart nicht geantwortet hat, aber schon eine Anwesenheit
   (anwesend oder nachgearbeitet) oder eine Leistung hat, gilt als zurückgemeldet und wird nicht abgemeldet.
   Audit `TEILNAHME_RUECKMELDUNG_DURCH_TEILNAHME` (Quelle SYSTEM).
4. **„Bin raus“ bei der Übernahme.** Die Sammelübernahme lässt Personen aus, deren jüngste Teilnahme vor dem
   Zielsemester abgemeldet ist („Ich bin raus“ oder keine Rückmeldung). Sie stehen auf der Teilnehmerseite
   gesondert und lassen sich einzeln übernehmen (`POST /api/semester/[id]/teilnehmer` mit `{ personId }`).
   Audit `SEMESTER_TEILNEHMER_EINZELN_UEBERNOMMEN`.
5. **Wiederaufnahme nach Abbruch.** ABGEBROCHEN ist kein Endzustand mehr: wie ABSOLVENT nicht aktiv und ohne
   Automatik-Mails, der Portalzugang bleibt. Die Schulleitung setzt die Person mit Grund zurück auf „Aktiv“
   (Verlassen von ABGEBROCHEN ohne Grund → 400). Endzustände sind AUSGESCHLOSSEN, VERSTORBEN und ANONYMISIERT.
6. **Hörer-Bescheinigung nur mit besuchtem Abend.** Die Teilnahmebescheinigung nennt nur Fächer mit mindestens
   einer Anwesenheit (anwesend oder nachgearbeitet). Ohne einen solchen Abend gibt es bei der Einzel-Ausstellung
   409, der Sammellauf überspringt die Person und zählt sie als `ohneAnwesenheit`. Eine 80-%-Pflicht gibt es
   bewusst nicht.
7. **Zeugnis-Storno ohne Ersatz.** `POST /api/zeugnisse/[id]/stornieren` mit Pflichtgrund (Recht
   `NOTEN_VERWALTEN`): Status `STORNIERT`; Zeitpunkt, Akteur und Grund bleiben als Nachweis. Die Person kann das
   Zeugnis nicht mehr abrufen (410), die Schulleitung bekommt es mit dem Vermerk „STORNIERT am …“. Der
   Sammellauf stellt für ein storniertes Dokument nichts still neu aus (zählt `storniert`), einzeln geht es.
   Die Anonymisierung überschreibt den Grund. Der Trigger erlaubt GUELTIG → STORNIERT nur mit Zeitpunkt und
   Grund, dazu kommt der CHECK `zeugnisse_storno_konsistent`. Stornieren geht auch in der Detailakte; dort
   stehen jetzt alle Zeugnisse der Person mit Status.

**Beim Einspielen beachten:** Die Migration fügt den Enum-Wert `STORNIERT` hinzu (rein additiv). Der Seed setzt
ABGEBROCHEN beim nächsten Start auf „kein Endzustand“. Container mit altem Image laufen weiter; beim
Neuerstellen spielt das neue Image die Migration ein.

**Zu bestätigen bzw. offen:**
- Ein storniertes **Abschlusszeugnis** blockiert den Sammellauf je Person (wie die bestehende Regel „ein
  Abschlusszeugnis je Person“), nicht je Semester.
- Bei **anonymisierten** Personen ist kein Storno mehr möglich (409), weil ein späterer Freitext-Grund nicht
  mehr anonymisiert würde.
- Bekannter Altfehler, nicht Teil dieser Runde: `bereinigen()` in `src/lib/audit.ts` schreibt `Date`-Werte als
  `{}` ins Protokoll (z. B. `SEMESTER_GEAENDERT`). Die neuen Einträge schreiben Zeitpunkte deshalb als ISO-Text.
- Die Bash 3.2 von macOS zerlegt `"{\"…\"}}"` innerhalb von `"$( … )"` in mehrere Argumente. Im Durchstich ist
  die eine betroffene Stelle über eine vorab gesetzte Variable gelöst und kommentiert.

Neue Durchstich-Abschnitte: 23b (Zusage von Hand), 26 (+6, Worker mit Anwesenheit), 26b (Erneut senden),
36 (+1), 36b (Hörer ohne Anwesenheit, Storno), 41b (zuletzt abgemeldet), dazu in Abschnitt 39 der Block
„Wiederaufnahme nach Abbruch“.

---

## Stand 27.09.2026, abends: Anrede „Sie“ und Schutz vor Massenanmeldungen

Auf dem Branch **`feat/anmeldung-sie-massenschutz`** (in `main` gemergt) sind zwei Wünsche des
Projektverantwortlichen umgesetzt.
Verifiziert mit Docker: Build mit **1229 Prüfungen in 20 Skripten** grün (inkl. Produktionsbuild),
**Durchstich 787/787** gegen das gebaute Image, `pruefen:db` 19 + 18.

**1. Durchgängig „Sie“ (Entscheidung E-22).** Alle Texte, die Menschen lesen — öffentliches Formular, Portal,
Mails, Meldungen, Verwaltungstexte — sprechen mit „Sie“ an (78 Dateien). Die Einwilligungstexte standen schon in
der Ich-Form („Ich willige ein …“) und bleiben so; die neue **Fassung 2** von DATENSCHUTZ und GLAUBENSANGABEN
korrigiert nur die Tippfehler („fuer“, „ausdruecklich“). Der Seed legt Fassung 2 an und setzt bei der älteren
Fassung `aktivBis` — das Einzige, was der Trigger erlaubt. Wer Fassung 1 bestätigt hat, bleibt wirksam eingewilligt
(ausgewertet wird je Code über alle Fassungen). Mailvorlagen und Einwilligungstexte stellen sich beim nächsten
Containerstart selbst um. **Das Anmeldeformular einer bestehenden Installation nicht:** Die veröffentlichte
Fassung in der Datenbank behält ihre Du-Einleitung. Zwei Wege: `scripts/anmeldeformular-bewerbung.ts`
veröffentlicht eine neue Fassung aus der aktualisierten Definition (überschreibt Änderungen aus dem Cockpit) —
oder im Formular-Builder die Einleitung und die Beschreibung „Persönlich-Geistlicher Werdegang“ ändern und neu
veröffentlichen. Offen: Mails beginnen mit „Hallo {{vorname}},“ und siezen danach; für „Guten Tag Frau/Herr …“
müsste jede Versandstelle Anrede und Nachnamen mitgeben.

**2. Schutz vor Massenanmeldungen (Entscheidung E-23).** Jede Einreichung legt eine nicht löschbare Akte an und
schreibt an die eingegebene Adresse — eine Flut automatisierter Anmeldungen hinterließe Datenmüll und ruinierte den
Ruf der Absenderdomain, an der der Anmeldelink hängt. Die Schichten (`src/lib/anmelde-schutz.ts`, angewendet in
`src/app/api/anmeldung/route.ts`):

- **Drossel je Anschluss** und **Fangfeld** — wie bisher.
- **Mindestdauer:** Die Seite liefert einen signierten Zeitstempel aus. Wer schneller absendet als
  `ANMELDUNG_MINDESTDAUER_SEKUNDEN` (Standard 3, 0 = aus), bekommt eine sichtbare Meldung und kann erneut absenden.
- **Gesamtgrenze über alle Anschlüsse:** `ANMELDUNG_MAX_GESAMT_STUNDE` (Standard 10) und
  `ANMELDUNG_MAX_GESAMT_TAG` (30). Gezählt werden nur angenommene Einreichungen — ein Pflichtfeld-Fehler gibt den
  reservierten Platz wieder frei. Zwischenstände dürfen das Dreifache und werden über neu angelegte Anmeldezeilen
  gezählt, damit ein erfundener Fortsetzen-Token nicht an der Grenze vorbeiführt.
- **Warnung** an Schulleitung und Verwaltung (Vorlage `ANMELDUNG_GEDROSSELT`), höchstens einmal pro Stunde.
- **Betriebsansicht:** neue Kachel mit den angenommenen Anmeldungen gegen die Grenzen und den Abweisungen der
  letzten 24 Stunden je Schicht.

Die drei Werte stehen unter Verwaltung → Einstellungen im Bereich „Anmeldung“. Die Schule erwartet 20–60
Anmeldungen im Jahr; die Standardwerte fangen Roboter ab, nicht Bewerber. Der Durchstich lockert sie zu Beginn des
Laufs (500/2000/0) und prüft sie in Abschnitt 50 einzeln; Prüfskript: `scripts/pruefe-anmelde-schutz.ts` (52).

---

## Stand 27.09.2026: Code-Review 4 ist behoben

Alle 19 MAJOR-Befunde aus [`../10_Code-Review-4.md`](../10_Code-Review-4.md) und der größte Teil der
MINOR-Befunde sind behoben — in drei Fix-Runden, jede gegengeprüft. Die Änderungen liegen auf dem Branch
**`fix/code-review-4`** und sind **committet und in `main` gemergt**. Verifiziert (27.09.2026):
`tsc` 0 Fehler, **1177 DB-freie Prüfungen in 19 Skripten** grün, `next build` grün (41 Seiten), alle
**24 Migrationen** gegen PGlite fehlerfrei und ohne Drift zum Schema — und mit Docker: **Durchstich
766/766 grün** gegen das gebaute Image und eine frische Datenbank, **`pruefen:db` 19 + 18 grün**.

### Der Durchstich ist grün (27.09.2026) — so wiederholst du ihn

> **Durchstich 766/766 grün** gegen das gebaute Image und eine frische Datenbank. `scripts/durchstich.sh`
> ist kalenderunabhängig umgebaut (M19), hat die neuen Abschnitte 37–50 und zählt gegen **`SOLL=766`**
> (vorher 414). Im ersten echten Lauf waren 4 von 764 Prüfungen rot — alle vier ein Fehler **im Test**:
> Die Rechte-Gegenproben „ein Teilnehmer darf … nicht (403)“ benutzten Petras Sitzung `KEKS2`, die
> Abschnitt 13 durch den Adresswechsel absichtlich entwertet. Früher antwortete die App darauf pauschal
> 403, seit der 401/403-Trennung korrekt 401. Die vier Prüfungen nutzen jetzt eine frische Sitzung
> (`KEKS_TN`), zwei neue Prüfungen halten fest, dass die entwertete Sitzung 401 liefert. Danach: 766/766.

```bash
docker start gbs-campus-db-dev
```

```bash
cd gbs-campus && docker build -t gbs-campus-test:local . > /tmp/build.log 2>&1; echo "Exit: $?"
```

Der Build führt in der Stufe `builder` jetzt selbst `npm run pruefen` aus (in `TZ=Europe/Berlin`), ein
rotes Prüfskript bricht ihn also ab.

```bash
bash scripts/durchstich.sh > /tmp/durchstich.log 2>&1; echo "Exit: $?"
```

Soll: **787 Prüfungen, 0 fehlgeschlagen** (seit dem Schutz vor Massenanmeldungen; davor 766). Voraussetzungen: die Dev-Datenbank auf Port 5434 **ohne eigene
Zeitzone** (sie rechnet in UTC wie die Produktion; Abschnitt 0 prüft das zusammen mit der Container-Zeitzone
und legt alle Daten relativ zum heutigen Berliner Kalendertag an) und das Image `gbs-campus-test:local`.
Rote Zeilen erst verstehen, dann beheben — und die Grenzen der drei maschinenabhängigen Laufzeitprüfungen
nicht vorschnell aufweichen (siehe unten „So prüfst du den Stand nachvollziehbar“). Die zwei Zeilen
„Rest (bekannt)“ in Abschnitt 49 müssen grün sein: Sie halten fest, dass `docker exec` und der Healthcheck
das Eigentümer-Passwort weiter sehen (Entscheidung E-betrieb-migrationsdienst). Wird diese umgesetzt, sind
beide Prüfungen umzudrehen.

Danach die DB-Prüfungen gegen die Dev-Datenbank (Soll **19 + 18**, am 27.09.2026 grün gegen `gbs_durchstich`; das Skript für die Einstellungen lehnt
alles außer `localhost`, `127.0.0.1` und `host.docker.internal` ab):

```bash
docker run --rm --entrypoint sh -e DATABASE_URL="postgresql://gbs:gbs_dev_2026@host.docker.internal:5434/gbs_campus?schema=public" gbs-campus-test:local -c "prisma migrate deploy && node prisma/seed.js"
```

```bash
docker build --target builder -t gbs-campus-builder:local . > /tmp/build-builder.log 2>&1; echo "Exit: $?"
```

```bash
docker run --rm -e DATABASE_URL="postgresql://gbs:gbs_dev_2026@host.docker.internal:5434/gbs_campus?schema=public" -e ENCRYPTION_KEY="$(openssl rand -hex 32)" gbs-campus-builder:local npm run pruefen:db
```

Ebenfalls vor dem Livegang, aber nicht vor dem Merge: den **ganzen Stack auf einem Staging-Server** mit TLS
durchspielen (siehe „Traefik und Deploy“ unten und die Go-Live-Checkliste in [`LAIENTEST.md`](LAIENTEST.md)).

### Was behoben ist

Einzelheiten je Befund stehen in [`../10_Code-Review-4.md`](../10_Code-Review-4.md), Abschnitt „Stand der
Behebung“. In Kürze:

| Befund | Behoben durch |
|---|---|
| **M1** Traefik-Netz | Netz fest `gbs_edge`, Traefik doppelt darauf festgelegt, Header aus `docker/traefik-dynamisch.yml` |
| **M2** `APP_DATABASE_URL` | Umschalten auf `gbs_app` nur bei gesetztem `APP_DB_PASSWORD`, Passwortregel beim Start geprüft |
| **M3** Seed setzt Semester zurück | Semester nur bei leerer Tabelle, Kürzel danach fest |
| **M4** Abmelden | Cookie mit denselben Attributen gelöscht, Knopf wertet das Ergebnis aus |
| **M5** CSRF | Herkunftsprüfung in `src/middleware.ts` / `src/lib/herkunft.ts` |
| **M6** Anonymisierung | Zeugnis-Snapshots, Versandprotokoll, Audit nur Feldnamen, Rollen, Sitzungen |
| **M7** offene Anmeldung Anonymisierter | Anmeldung wird geschlossen, Entscheidung antwortet 409 |
| **M8** Einwilligungstexte | Trigger, kein UPDATE für `gbs_app`, Seed legt nur an |
| **M9** Statusmaschine | Statusroute, Ausbildungsdaten, `wechsleStatus` als einziger Schreibweg |
| **M10** „bin raus“ | Rückmeldung an der Teilnahme, Abmeldung ohne Antwort, Filter `TEILNAHME_ZAEHLT` |
| **M11** abgerechnete Abende | Dozentenwechsel gesperrt, Storno OFFENER Abrechnungen |
| **M12** DMS-Beleg | Nachversand für Zahlungs-, Satz- und Zeugnisbeleg |
| **M13** Anmeldeantworten | Seite `/verwaltung/anmeldungen/[id]` |
| **M14** Zeugnis-Sammellauf | Rückfrage mit Zahlen, ABSCHLUSS nur im letzten Semester, ersetzte Zeugnisse gekennzeichnet |
| **M15–M17** Formular-Builder | stabile Schlüssel, Beschriftungen, Antwortmöglichkeiten tippbar, Zuordnung geladen |
| **M18** Noten-Leeroption | Anzeige folgt nach dem Speichern der Datenbank |
| **M19** Durchstich-Kalender | relative Daten, Abschnitt 0 — **Lauf steht aus** |

Von den MINOR- und INFO-Befunden ist der größte Teil erledigt. Was eine fachliche Wahl braucht, steht unten
unter „Offene Entscheidungen“; was bewusst bleibt, steht im Review-Bericht.

### Fachentscheidungen vom 27.09.2026 (verbindlich)

1. **Die Anonymisierung anonymisiert auch Zeugnis-Snapshots.** Name und Geburtsdatum im eingefrorenen
   Snapshot werden überschrieben; das Zeugnis bleibt mit Beleg-Nr., Typ, Fächern und Ergebnissen als
   Nachweis stehen. Eine Neuausstellung für ANONYMISIERT wird abgewiesen (409). Damit ist auch der Verweis
   „siehe Backlog“ im Kommentar der Migration `20260730150000_zeugnisse` erledigt.
2. **„Bin raus“ oder keine Rückmeldung bis Semesterstart meldet die Teilnahme ab, der Personenstatus
   bleibt.** Gespeichert an der Teilnahme (`abgemeldetAm`, `abmeldeGrund` = `BIN_RAUS` bzw.
   `KEINE_RUECKMELDUNG`). Jede Liste eines Semesters filtert mit `TEILNAHME_ZAEHLT`.
3. **ABSOLVENT ist kein Endzustand:** `istTerminal = false`, `istAktiv = false`, `automatikMails = false`.
   Der Portalzugang bleibt (Abschlusszeugnis, eigene Daten), aus Semesterlisten und Automatik-Mails fällt die
   Person heraus. Endzustände waren damit ABGEBROCHEN, AUSGESCHLOSSEN, VERSTORBEN und ANONYMISIERT; seit dem
   27.09. spät ist auch ABGEBROCHEN kein Endzustand mehr (siehe ganz oben).
4. **Die Gemeindezugehörigkeit bleibt im Excel-Export und in der Oberfläche unverändert.** Befunde dazu
   (Art.-9-Angabe im Export, für den Administrator sichtbar) gelten als **bewusst** und werden nicht erneut
   gemeldet.

Dazu eine Hausregel, die ab jetzt für jeden neuen `protokolliere()`-Aufruf gilt: **Das Audit enthält bei
Personendaten nur Feldnamen, keine Werte** (`geaenderteFeldnamen` in `src/lib/anonymisierung.ts`). Statuscodes,
Rollen und Zähler dürfen mit alt/neu hinein, Namen, Adressen, E-Mail-Adressen und Freitext-Gründe nicht (beim
Statuswechsel nur `grundAngegeben`). Das Audit-Log ist unlöschbar, und die Anonymisierung erreicht es nicht.
`scripts/pruefe-anonymisierung.ts` (Abschnitt 8, Liste `AUDIT_DATEIEN`) prüft das für die Personen- und
Selbstpflege-Dateien; eine neue Datei mit Personendaten im Audit gehört in diese Liste. Ein fehlgeschlagener
Passwort-Login protokolliert keine Adresse mehr, die Meldung aus dem Hilfeformular nur die Zahl der Empfänger
(`empfaengerAnzahl`).

### Neue Regeln für Betrieb und Weiterbau

**`APP_URL` muss genau die Adresse sein, unter der der Browser das Portal öffnet** — gleiches Schema, gleicher
Host, gleicher Port. Sonst lehnt die neue Herkunftsprüfung jede Änderung mit 403 ab („Diese Anfrage kam
nicht von der Seite des Portals …“), und im Server-Log steht `[HERKUNFT] … abgewiesen (fremder-origin)`. Das
gilt auch lokal: Die Testinstanz unten läuft mit `APP_URL=http://127.0.0.1:3000` und muss im Browser unter
genau **`http://127.0.0.1:3000`** geöffnet werden, nicht unter `localhost:3000`; bei `npm run dev` mit
`APP_URL=http://localhost:3000` ist es umgekehrt. Der Startprüfer lehnt eine `APP_URL` ab, aus der sich keine
Herkunft ergibt (etwa `https://`). In Produktion mit gesetztem `APP_DOMAIN` muss sie außerdem mit `https://`
beginnen und denselben Host haben wie `APP_DOMAIN` (Traefik-Regel); sonst startet der Container nicht, und
im Log steht `[START] … APP_URL: passt nicht zu APP_DOMAIN …`.

**Herkunftsprüfung (CSRF).** `src/middleware.ts` (Matcher `/api/:path*`, Edge-Laufzeit, Begründung im
Dateikopf) ruft die reine Regel `pruefeHerkunft()` aus `src/lib/herkunft.ts`: GET/HEAD/OPTIONS frei; sonst
muss ein vorhandenes `Origin` exakt der Herkunft aus `APP_URL` entsprechen und ein vorhandenes
`Sec-Fetch-Site` `same-origin` oder `none` sein. Ohne beide Header (curl, Cron, Durchstich) geht die Anfrage
durch; ein externer Zeitgeber für `/api/cron/erinnerungen` schickt deshalb keinen `Origin` mit, oder genau
den aus `APP_URL`. Bewusst **nicht** gebaut: ein Zwang zu `Content-Type: application/json` (POSTs ohne Rumpf
schicken keinen) und eine Pfad-Ausnahme für `/api/cron/*` (neue Angriffsfläche über Pfad-Normalisierung).
Die **Referrer-Policy darf nie `no-referrer`** lauten, sonst schicken Browser `Origin: null`, und jede
Änderung scheitert; Traefik setzt `strict-origin-when-cross-origin`. Next puffert für die Middleware
Anfragerümpfe bis 10 MB — bei einem künftigen Datei-Upload unter `/api` bedenken.

**Traefik und Deploy.** Traefik ist auf das Netz **`gbs_edge`** festgelegt (fester Name, unabhängig vom
Ordnernamen; `--providers.docker.network` und Label `traefik.docker.network` an `app`). Die
Sicherheits-Header kommen aus dem Datei-Provider: **`docker/traefik-dynamisch.yml` gehört auf den Server
neben `docker-compose.yml`** (Middleware `gbs-sicherheit@file`). Der traefik-Container hat keine Labels mehr,
es entsteht kein Default-Router mehr. Beim ersten Deploy nach dieser Änderung legt Compose `gbs_edge` neu an,
das alte Netz (`gbs-campus_edge`) bleibt verwaist: `docker compose up -d --force-recreate`, danach
`docker network rm gbs-campus_edge`. **Vor dem Livegang auf Staging:** `docker compose config` ohne Fehler,
den Stack fünfmal neu starten, `/api/health` über Traefik darf dabei nie 502/504 liefern, und das Traefik-Log
muss sauber sein.

**Getrennter App-Nutzer `gbs_app`.** Der Entrypoint schaltet **nur bei gesetztem `APP_DB_PASSWORD`** um
(vorher genügte die immer gesetzte `APP_DATABASE_URL`, M2). Das Passwort braucht **mindestens 16 Zeichen und
nur Buchstaben und Ziffern** (`openssl rand -hex 24`), weil es unkodiert in einer Verbindungs-URL steht;
alles andere lehnt der Start mit einer Meldung ab. **Upgrade-Hinweis:** Wer schon ein kürzeres Passwort oder
eines mit Sonderzeichen gesetzt hat, muss es vor dem Deploy ersetzen. Dasselbe gilt sinngemäß für
`DB_PASSWORD`. Nach dem Umschalten entfernt der Entrypoint `DB_PASSWORD` aus der Umgebung des Serverprozesses —
nur dort: In der Container-Konfiguration bleibt es stehen, `docker exec` und die Healthcheck-Prozesse sehen es
(offene Entscheidung E-betrieb-migrationsdienst). Der **Worker bleibt bewusst Eigentümer** (startet nicht
über den Entrypoint, nicht web-exponiert).

**Der Seed legt Semester und Einwilligungstexte nur an.** Semester nur bei **leerer Tabelle**; danach gehören
Datum, Bezeichnung, Lehrjahr/Halbjahr dem Betrieb und überleben jeden Neustart, gepflegt unter
`/verwaltung/semester` (das Kürzel ist nach dem Anlegen fest). Einwilligungstexte legt der Seed nur an; weicht
eine Fassung in der Datenbank vom Seed ab, schreibt er eine **WARNUNG** ins Log und ändert nichts. Weiterhin
bei jedem Start nachgezogen werden Statusschalter, Rechtematrix (aus `RECHT` in `src/lib/constants.ts`),
Mailvorlagen, Kursraster und die Beschreibung der Einstellungen (offene Entscheidung
ARCH-seed-ueberschreibt-konfiguration). Deshalb wirken die neuen Vorlagen-Betreffs ohne Namen, der neue Text
von `BANKVERBINDUNG_GEAENDERT` und die Beitragsbeschreibung „Wird derzeit nicht eingezogen.“ nach dem nächsten
Container-Start von selbst; der Altbestand im Versandprotokoll ist durch die Migration
`20260927130000_versandprotokoll_betreff_ohne_namen` einmalig bereinigt.

**Einwilligungstexte sind eingefroren** (Migration `20260927100000`, drei Trigger
`einwilligungs_text_nur_aktiv_bis`, `…_kein_delete`, `…_kein_truncate`). Nur `aktivBis` ist änderbar, `gbs_app`
hat kein UPDATE, DELETE oder TRUNCATE. **Ein geänderter Text ist eine neue Fassung mit `version + 1`**, nie
eine Korrektur der alten — sonst änderte sich rückwirkend der Text aller erteilten Einwilligungen (Art. 7
Abs. 1). Die Tippfehler in Fassung 1 („fuer“, „ausdruecklich“) sind deshalb in **Fassung 2** korrigiert
(27.09.2026, abends); der Seed setzt beim Anlegen einer neuen Fassung `aktivBis` der älteren.

**Belege sind auf DB-Ebene eingefroren** (Migration `20260927160000_belege_unveraenderlich`, 14 Trigger):
`honorar_saetze` — nur `dmsBelegNr`/`dmsGesendetAm` nachtragen, kein DELETE; `honorar_abrechnungen` — Status
nur vorwärts, Beleg-, Freigabe-, Auszahlungs- und DMS-Felder einmalig, DELETE (Storno) nur bei OFFEN;
Abrechnungsposten — INSERT nur zu OFFENEN Abrechnungen, kein UPDATE, weg nur per Storno-Cascade, und beim
Commit muss die Summe der Abrechnung der Summe ihrer Posten entsprechen (verzögerte Constraint-Trigger);
`zeugnisse` — nur GUELTIG → ERSETZT, DMS-Datum einmalig und der Scrub durch die Anonymisierung. TRUNCATE ist
überall gesperrt; `gbs_app` fehlen zusätzlich DELETE auf Sätzen, Posten und Zeugnissen sowie UPDATE auf
Posten. **Wer an diesen Tabellen eine Spalte ergänzt oder einen neuen Schreibweg baut, passt die
Trigger-Funktion per neuer Migration an (`CREATE OR REPLACE FUNCTION`)**; beim Nachfüllen einer neuen Spalte
die Trigger per `DISABLE/ENABLE TRIGGER` umklammern. Ändert sich `scrubbeZeugnisSnapshot`, muss
`zeugnis_ist_eingefroren` mitgehen — `scripts/pruefe-betrieb.ts` koppelt beides. Kurseinheiten werden nie
gelöscht, nur deaktiviert (`aktiv = false`); Leistungen hängen mit `ON DELETE RESTRICT` daran (Migration
`20260927160500`). `prisma migrate dev` kennt weder Trigger noch CHECKs noch partielle Indexe (siehe
„Bekannte Einschränkungen“).

**Worker.** Er wartet beim Start, bis jede Migration aus `prisma/migrations` in `_prisma_migrations`
abgeschlossen ist, höchstens 10 Minuten; danach endet er mit Exit 1, und Docker startet ihn neu. Auf den Seed
wartet er nicht eigens (dafür gibt es die Rückfallwerte). Nach jedem Lauf, in dem mindestens ein Teillauf
gelungen ist, schreibt er `/tmp/gbs-worker-lebenszeichen`; der Docker-Healthcheck verlangt die Datei jünger als
130 Minuten (`start_period` 15 min). Bei einem Totalausfall (etwa Datenbank nicht erreichbar) bleibt das
Lebenszeichen aus, und der Healthcheck wird rot. Ein gescheiterter Teillauf schreibt
`WORKER_LAUF_FEHLGESCHLAGEN` (nur die Namen der Teilläufe). Die Betriebsansicht zeigt „Worker zuletzt
gelaufen“ und warnt ab 26 Stunden.

**Logs ohne Adressen.** Das Container-Log nennt keine Empfängeradressen mehr, sondern die Protokoll-ID
(`email_versand.id`) und die Vorlage. Die Adresse steht nur in `email_versand`, das die Anonymisierung
erreicht: `select * from email_versand where id='<Protokoll-ID>';`. Ausnahme ist die Konsolenausgabe im
Entwicklungsmodus ohne SMTP. Fehlt `DMS_EMAIL`, warnt der Start; die Betriebsansicht hat eine Kachel „Belege
noch nicht im DMS“ (Zahlungsbelege, Satz-Belege, Zeugnis-Archivkopien).

**Prüfen gatet Build und CI.** `npm run pruefen` (und `npm test`) startet `scripts/pruefe-alle.ts`: alle 19
DB-freien Skripte, jedes in eigenem Prozess mit `TZ=Europe/Berlin`, am Ende Zusammenfassung und Gesamtsumme,
Exit 1 bei einem roten Skript. Ein `scripts/pruefe-*.ts`, das dort nicht eingetragen ist, macht den Lauf rot —
**neue Prüfskripte dort eintragen.** Die Docker-Stufe `builder` läuft in `TZ=Europe/Berlin` und führt
`npm run pruefen` vor `next build` aus. Neu ist die CI `.github/workflows/pruefen.yml` (`npm ci`,
`prisma generate`, `tsc --noEmit`, `npm run pruefen`). **Offen:** den Job „Typpruefung und Pruefskripte“ in
GitHub unter Branch-Schutz als Pflicht-Check für `main` eintragen — eine Einstellung im Repo, nicht im Code.
`npm run pruefen:db` und der Durchstich laufen weiter von Hand vor jedem Release.

**API-Konventionen.** 401 heißt „nicht oder nicht mehr angemeldet“ (die Oberfläche sagt „Ihre Sitzung ist
abgelaufen …“ und leitet bewusst nicht um — man meldet sich im neuen Tab an, damit Eingaben nicht verloren
gehen). 403 heißt „angemeldet, aber ohne Recht“. Routen prüfen über `pruefeZugriff(RECHT.X)`, `ladeMitRecht`
nur noch in Seiten; beide nehmen nur noch `RechtCode`. Download-Routen (Zeugnis-PDF, Seriendruck,
Excel-Export) antworten beim Browser-Klick mit einer HTML-Fehlerseite bzw. 303 zur Anmeldung statt mit rohem
JSON. Weiter gilt: `erfolg()`/`fehler()`, Auth → Recht → Zod.

**Bewusst keine `loading.tsx`.** Sie würde die `redirect()`/`notFound()`-Antworten der
`force-dynamic`-Seiten bei direktem Aufruf zu HTTP 200 mit Meta-Refresh machen. Rückmeldung beim Seitenwechsel
gibt `<LadeHinweis />` (`useLinkStatus`) in Kachel und Zurück-Leiste; weitere Links können ihn in ihren
`<Link>` setzen. **Die Fehlerseite zeigt jetzt einen Fehlercode** (`digest`), wenn es einen gibt. Wer einen
Fehler meldet, nennt ihn; der Betrieb findet ihn im Server-Log (`docker compose logs app`).

**Rechte ohne Funktion.** Der Seed legt die Rechte aus `RECHT` an; vier tragen „(noch ohne Funktion)“:
`MAIL_VERTEILER_SENDEN`, `MAIL_VORLAGEN_BEARBEITEN`, `FINANZ_DATEN_LESEN`, `IMPERSONATION`. Die Prüfung
erzwingt das Entfernen der Kennzeichnung, sobald eine Route eines davon prüft.

### Löschkonzept: Umfang und Grenzen der Anonymisierung

„Anonymisieren“ (Verwaltung → Personen → Akte, abgesetzt unter „Löschung nach Art. 17 DSGVO“, Recht
`PERSON_ANONYMISIEREN`) erfasst jetzt in einer Transaktion:

- alle personenbezogenen Felder der Person und die Antworten ihrer Anmeldungen;
- **Zeugnis-Snapshots** (Name und Geburtsdatum, Fachentscheidung 1);
- das **Versandprotokoll**: Betreffs, die Namen oder Adresse enthalten (unabhängig davon, an wen die Mail
  ging), Empfängeradressen und Fehlertexte;
- Freitext-Gründe früherer Statuswechsel (Systemgründe bleiben);
- **Rollen** (werden entfernt), Sitzungen (`passwortGeaendertAm` = jetzt), Anmelde-, Bestätigungs-,
  Auskunfts- und Überleitungs-Tokens sowie `rate_limit`-Einträge zur Adresse;
- **offene Anmeldungen** (ENTWURF/EINGEREICHT → ABGELEHNT mit Grund `[anonymisiert]`, keine Mail).

Die Sperrreihenfolge ist dieselbe wie bei „Annehmen“ und Adressänderung (erst Anmeldungen und Tokens, dann die
Person); ein gleichzeitiger Zugriff ergibt 409 statt Deadlock. Das letzte Administratorkonto lässt sich nicht
anonymisieren (409). Die Rückfrage nennt Zeugnisse, geschlossene Anmeldungen und Rollen.

**Grenzen, bewusst:** Audit-Einträge **vor** dem 27.09.2026 enthalten noch Namen und Adressen (append-only,
nicht bereinigbar); IP-Adressen in `audit_log` und `einwilligungen` bleiben; `ausgestelltVon` (Name des
Ausstellers) in fremden Zeugnissen bleibt, wenn ein Mitarbeiter anonymisiert wird; Honorar-Belege eines
Dozenten (Name/IBAN, auch im DMS) werden wegen der Aufbewahrungspflicht nicht angefasst; bereits ans DMS
gesendete Kopien liegen außerhalb der Software. Der DMS-Nachversand erfasst Zeugnisse Anonymisierter mit
bereinigtem Snapshot (offene Entscheidung ZEUG-dms-anonymisierte).

**Echtes Löschen** einer Person gibt es im Code nicht. Auf Datenbankebene (als Eigentümer per SQL, etwa bei
einer Testbereinigung) nimmt es ihre **Zeugnisse per `ON DELETE CASCADE` mit** — bewusst so gelassen: Das
`REVOKE DELETE` für `gbs_app` sperrt nur das direkte Löschen von Zeugnissen, nicht den Weg über die Person.
Ein `RESTRICT` wäre eine Aufbewahrungsentscheidung (E-betrieb-zeugnis-person-cascade); gelöscht werden
dürfte eine Person mit Zeugnissen ohnehin erst nach Ablauf einer noch festzulegenden Aufbewahrungsfrist.

### Personen: Statuswechsel, Ausbildungsdaten, Rollen

Die Statusmaschine ist bedienbar: `POST /api/personen/[id]/status` und `PUT /api/personen/[id]/ausbildungsdaten`,
beide mit Recht `PERSON_STATUS_WECHSELN` (nur Schulleitung), in der Detailakte als Block „Ausbildungsdaten &
Status“. Die Regeln stehen DB-frei in `src/lib/status.ts` (Endzustand → 409; Ziel ANONYMISIERT oder
INTERESSENT → 400; Grund Pflicht bei ABGEBROCHEN, AUSGESCHLOSSEN, VERSTORBEN und beim Verlassen von ABGEBROCHEN;
höchstens 500 Zeichen). **Einziger
Schreibweg für Statuswechsel ist `src/lib/status-io.ts`** (`wechsleStatus`, `erfasseErstenStatus`);
`pruefe-benutzerverwaltung.ts` wird rot, sobald `statusWechsel.create` woanders steht. Der **letzte
Administrator** ist in Statusroute, Anonymisierung und Rollenroute geschützt (409); gezählt werden nur andere
Administratoren **ohne** Endzustand.

- **ABSOLVENT** (Fachentscheidung 3): Zugang bleibt, fällt aus Teilnehmer-, Anwesenheits- und Notenlisten und
  aus allen Automatik-Mails; Zeugnisse bleiben ausstellbar (Zeugnisübersicht und Sammellauf schließen ABSOLVENT
  ein), Noten gehen nur noch in der Akte. Empfohlene Reihenfolge: erst das Abschlusszeugnis, dann der Status.
- **BEURLAUBT** und andere nicht aktive Ziele: kein Endzustand, aber die Person fällt aus allen Semesterlisten
  — Noten und Zeugnis vorher erledigen. Die Rückfragen in der Oberfläche sagen das.
- **Ausbildungsdaten:** Geburtsdatum, Gemeinde, Teilnahmeform. Die Gemeinde (Art. 9) lässt sich nur setzen,
  wenn wirksame Einwilligungen in **alle** Art.-9-Texte vorliegen; leeren geht immer. Ein **Formwechsel** gilt
  für die Teilnahmen des laufenden und der kommenden Semester, auch für abgemeldete; vergangene Semester
  bleiben unverändert (offene Entscheidung PER-formwechsel-rueckwirkend). Audit nur mit Feldnamen.
- **Rollen speichern** fragt mit „Entzogen/Hinzu“ nach, mit eigener Warnung beim Selbst-Entzug der Rolle
  Administrator. „Anmeldelink schicken“ meldet jetzt echte Zustellfehler und nennt die richtige Drossel.
- Die Personenliste zeigt die Quote wie die Akte (✓ erfüllt / • offen / ✕ nicht erreichbar); „Person
  anlegen“ führt zur neuen Akte.

### Semesterüberleitung: Rückmeldung, Frist, Erinnerungen

**Datenvertrag.** `Teilnahme.eingeladenAm`, `abgemeldetAm`, `abmeldeGrund` (Migration
`20260927110000_teilnahme_rueckmeldung`, rein additiv, mit CHECK `teilnahmen_abmeldung_konsistent`: Grund
genau dann, wenn `abgemeldetAm` gesetzt ist; nur `BIN_RAUS` oder `KEINE_RUECKMELDUNG`). Das Nachtragen von
`eingeladenAm` betraf nur Semester, die noch nicht begonnen hatten. **Regel für jede neue Abfrage auf die
Teilnahmen eines Semesters: `TEILNAHME_ZAEHLT` (aus `src/lib/teilnahme-filter.ts`) einmischen** — nach Regel 1
unten gilt eine Zusage erst, wenn alle Lesepfade sie einhalten; die Prüfskripte zählen die bekannten Stellen.

- Der Link bietet **„Ich bin dabei“ und „Ich bin raus“** (mit Rückfrage). Die Antwort ist bis zum **Vortag
  des Semesterstarts** änderbar, ab dem Starttag (Europe/Berlin) geschlossen (409). Eine eigene Absage hebt
  ein späteres „dabei“ auf; eine `KEINE_RUECKMELDUNG` hebt nur die Schulleitung auf („Wieder aufnehmen“ auf
  der Überleitungsseite).
- **Ab Semesterstart** meldet `schliesseRueckmeldungen` jede Einladung ohne Antwort ab. Worker und
  `/api/cron/erinnerungen` rufen es stündlich **vor** dem Erinnerungslauf auf; die Cron-Antwort lautet
  `{ laeufe, abgemeldet }`, bei einem gescheiterten Teillauf 500 mit den Namen der Teilläufe. Weil
  `eingeladenAm` den Aufräumlauf überlebt, holt es auch nach einem Worker-Ausfall nach. Teilnahmen mit einer
  Anwesenheit (anwesend oder nachgearbeitet) oder einer Leistung gelten dabei als zurückgemeldet und werden
  bestätigt statt abgemeldet (seit 27.09. spät).
- **Antwortfrist:** Mail und Seite nennen „bis einschließlich {{frist}}“, den Vortag des Semesterstarts
  (`rueckmeldeFrist`). Wird der Start verschoben, wandert die Linkfrist in derselben Transaktion mit (Audit
  `SEMESTER_GEAENDERT` mit `linksNachgezogen`). Ein Vorziehen auf heute oder früher bei offenen Einladungen
  wird mit 409 abgewiesen.
- **Versand:** Die Start-Route legt die Teilnahmen an und antwortet sofort mit `{ eingeladen }`; die Mails
  gehen danach per `after()` raus, höchstens drei gleichzeitig (der Klartext-Token existiert nur in diesem
  Prozess). Bricht der Prozess mitten im Versand ab, bekommen die Übrigen keine Einladung; ihr Link bleibt
  gültig, die nächste Erinnerung bringt einen frischen.
- **Link- und Erinnerungssemantik:** Jede **zugestellte** Erinnerung trägt einen frischen Link und löst ältere
  ab („Link aus der neuesten E-Mail“). Eine **gescheiterte** Erinnerung wird nicht wiederholt: Die Stufenmarke
  bleibt stehen, der alte Link gültig, die nächste Stufe versucht es erneut — genau ein Versuch je Person und
  Stufe. Jeder Stichtag (T-14/-7/-3), der am Tag der Einladung schon erreicht ist, gilt als erledigt; es geht
  nie eine zweite Mail am selben Tag. Parallele Starts laden jeden nur einmal ein. **Wird am letzten Stichtag
  (T-3) oder später gestartet, folgt keine Erinnerung mehr.** Eine nicht zugestellte Einladung lässt sich
  seit dem 27.09. spät über „Erneut senden“ auf der Überleitungsseite nachschicken (bis zum Tag vor
  Semesterbeginn, neuer Link); automatisch geschieht das nicht.
- Die Sammelübernahme legt eine abgemeldete Teilnahme im selben Semester nicht neu an. Im Folgesemester lässt
  sie Personen aus, deren jüngste Teilnahme abgemeldet ist; sie stehen auf der Teilnehmerseite unter „Zuletzt
  abgemeldet“ und lassen sich einzeln übernehmen (seit 27.09. spät). Eine telefonische Zusage trägt die
  Schulleitung oder Verwaltung mit „Zusage eintragen“ ein.
- **Semesterverwaltung:** Lehrjahr und Halbjahr sind pflegbar (nur 3/2 erlaubt den gesammelten
  Abschluss-Zeugnislauf), das Kürzel ist nach dem Anlegen fest (PUT mit anderem Kürzel → 400).
- **Audit-Aktionen:** `SEMESTER_UEBERLEITUNG_GESTARTET` (mit `erledigteStufen`),
  `SEMESTER_UEBERLEITUNG_VERSENDET`, `TEILNAHME_BESTAETIGT` (mit `vorher`), `TEILNAHME_ABGEMELDET`,
  `TEILNAHME_OHNE_RUECKMELDUNG_ABGEMELDET` (Quelle SYSTEM, mit `teilnahmeIds`), `TEILNAHME_WIEDER_AUFGENOMMEN`,
  `TEILNAHME_ZUSAGE_EINGETRAGEN`, `TEILNAHME_RUECKMELDUNG_DURCH_TEILNAHME` (Quelle SYSTEM),
  `SEMESTER_EINLADUNG_ERNEUT_GESENDET`, `SEMESTER_TEILNEHMER_EINZELN_UEBERNOMMEN`,
  `SEMESTER_ERINNERUNG_GELAUFEN` nur bei `gesendet > 0`, `AUFRAEUMEN_GELAUFEN` mit `objektId` = Herkunft
  (WORKER/APP; ein Lauf mit Löschungen steht immer im Protokoll, sonst spätestens alle 12 h je Herkunft),
  `WORKER_LAUF_FEHLGESCHLAGEN` (objektTyp System, objektId WORKER oder CRON).

**Stundenplan (Verwaltung):** Die Quote folgt Modell A wie in Personen- und Schülerakte. Die Semesterwahl
wechselt erst mit „Anzeigen“. Abgerechnete Abende sind gekennzeichnet (Dozent gesperrt, kein Löschen, Link zur
Abrechnung). Auf der Dozentenseite springen „Offene Aufgaben“ per „Jetzt erfassen“ zum Abend.

### Honorar

- **Storno** OFFENER Abrechnungen: `DELETE /api/honorar/abrechnungen/[id]` (Recht `HONORAR_ABRECHNEN`), Posten
  per Cascade, Audit `HONORAR_ABRECHNUNG_STORNIERT` mit allen Posten. Der **Dozentenwechsel** an einem
  abgerechneten Abend ist gesperrt (409); Korrekturweg: stornieren → umhängen → neu abrechnen. **Eine
  freigegebene oder ausgezahlte Abrechnung ist bewusst nicht korrigierbar** (kein Storno nach Freigabe);
  Korrektur außerhalb, per Gegenbuchung.
- **„Abrechnen“ schreibt nur fest, was die Rückfrage genannt hat** (Abende und Summe; sonst 409 „bitte neu
  laden“). Genehmigen und Abrechnen fragen mit Betrag, Gültig-ab bzw. Dozent, Abenden und Betrag nach. Die
  Honorarübersicht zeigt für abgerechnete Abende den eingefrorenen Betrag; ein rückdatierter Satz wirkt nur
  auf noch offene Abende (offene Entscheidung E-honorar-rueckwirkender-satz).
- **Freigeben** ist ohne Bankverbindung gesperrt; die IBAN trägt der Dozent selbst unter „Meine Daten“ ein,
  die Serverfehlermeldung sagt das.
- **Nachversand** eines nicht angekommenen DMS-Belegs: Zahlungsbeleg per `POST
  /api/honorar/abrechnungen/[id]/beleg-senden` (Rechte `HONORAR_ABRECHNEN` + `BANKVERBINDUNG_LESEN`),
  Satz-Beleg per `POST /api/honorar/saetze/[id]/beleg-senden` (`HONORAR_SATZ_GENEHMIGEN`), jeweils mit
  derselben Beleg-Nr. Das PDF trägt „NACHVERSAND – Kopie des Belegs <Nr>, nicht erneut anweisen“ bzw. beim
  Satz-Beleg „NACHVERSAND – Kopie des Belegs <Nr>“. **Der Nachversand trägt die dann hinterlegte IBAN** — die
  Abrechnung speichert keine; die Mail sagt das (offene Entscheidung HON-iban-abgleich-nachversand). Ohne
  `DMS_EMAIL` zeigen Abrechnung und Sätze-Seite statt des Knopfs einen Hinweis. Freigabe und Genehmigung
  melden `dmsVersand` (`GESENDET | KEINE_ADRESSE | FEHLGESCHLAGEN | LAEUFT`).
- **DMS-Versand unter Sperre:** Jeder Belegversand läuft unter einem Postgres-Advisory-Lock je Beleg in einer
  Transaktion, die während des SMTP-Versands eine Verbindung hält (Zeitlimit 60 s); ein zweiter gleichzeitiger
  Versand bekommt 409. Log-Meldung „Beleg gesendet, Festhalten unter der Sperre gescheitert — wird
  nachgetragen“: Der Beleg ist beim DMS, `dmsGesendetAm` wurde außerhalb der Sperre nachgetragen. Folgt
  „dmsGesendetAm nicht nachgetragen“, steht der Beleg fälschlich auf „Versand steht aus“; ein Nachversand
  trägt dann den Kopie-Vermerk.
- **Statuscodes:** `POST /api/honorar/abrechnungen` 400 bei keinen offenen Abenden, 409 wenn ein Abend
  zwischenzeitlich abgerechnet oder umgehängt wurde; `…/[id]/freigeben` 404 (gibt es nicht bzw. storniert),
  409 (nicht OFFEN oder keine IBAN), 500 (IBAN nicht entschlüsselbar); `…/[id]/auszahlen` 400 (ungültiges
  Datum), 404, 409 (nicht FREIGEGEBEN). Bisher lieferten diese Routen pauschal 400.
- **Beleg-Nummern** (`HON-`, `HONA-`, `ZEU-`, `BESCH-`, eine Regel in `src/lib/beleg-nr.ts`) tragen den
  **Berliner Kalendertag**. Früher zwischen 0 und 2 Uhr vergebene Belege tragen den Vortag (nur die Referenz,
  keine Migration) — wichtig für die Suche im DMS.

### Noten und Zeugnisse

- **Hörer werden nicht benotet:** Sie stehen nicht in Notenmatrix und Noten-Editor; Noten für Hörer → 400, für
  abgemeldete Teilnahmen → 409. Das Abschlusszeugnis zählt nur Schüler-Semester, die zählen. Das Zod-Schema der
  Noten-Routen liegt in `src/lib/leistung-schema.ts`; `leistung.ts` bleibt frei von zod, weil
  Client-Komponenten sie importieren.
- In der Detailakte ist „— nicht bewertet“ bei bewerteten Fächern gesperrt, nach dem Speichern zeigt die Akte
  den Stand der Datenbank. Die Semesterwahl (Noten) bzw. Semester + Art (Zeugnisse) wechselt erst mit
  „Anzeigen“; hat die Notenmatrix ungespeicherte Noten, fragt der Browser vor dem Wechsel bzw. Neuladen nach.
- **„Alle ausstellen“** fragt mit konkreten Zahlen nach: neue Zeugnisse und Bescheinigungen, Teilnehmer mit
  unbewerteten Fächern, Teilnehmer **ganz ohne Bewertung** (das Zeugnis enthielte keine Fächer) und beim
  Abschluss Teilnehmer mit weniger als 6 Schüler-Semestern (Quereinsteiger). Der Knopf ist gesperrt, solange
  eine geänderte Auswahl noch nicht angezeigt ist. **Abschlusszeugnisse gibt es gesammelt nur im letzten
  Rastersemester** (Lehrjahr 3, Halbjahr 2; einzeln weiterhin jederzeit); ein Semester ohne Lehrjahr/Halbjahr
  hat einen eigenen Sperrtext mit Verweis auf Verwaltung → Semester. Antwort des Sammellaufs:
  `{ ausgestellt, vorhanden, storniert, ohneAnwesenheit, fehlgeschlagen, gesamt }`; ABSCHLUSS außerhalb des
  letzten Semesters → 400, unbekanntes Semester → 404.
- **Teilnahmebescheinigung (Hörer)** nur mit mindestens einem besuchten Abend und nur mit den besuchten Fächern
  (seit 27.09. spät); sonst Einzel-Ausstellung 409 und im Sammellauf `ohneAnwesenheit`.
- **Storno ohne Ersatz** (seit 27.09. spät): `POST /api/zeugnisse/[id]/stornieren` mit Pflichtgrund, Status
  `STORNIERT`, für die Person 410, für die Schulleitung PDF mit Vermerk und Dateiname `<BelegNr>-STORNIERT.pdf`.
  Seriendruck, DMS-Nachversand und „Meine Daten“ erfassen nur gültige Zeugnisse. Audit `ZEUGNIS_STORNIERT` ohne
  Grundtext; ist `DMS_EMAIL` gesetzt, geht ein Storno-Vermerk ohne Namen und Grund ans DMS.
- Keine (Neu-)Ausstellung für ANONYMISIERT, Endzustände oder abgemeldete Teilnahmen (409).
- **Ein durch „Neu ausstellen“ ersetztes Zeugnis** liefert dem Schüler über die alte Id **410** (mit Hinweis
  auf „Meine Daten“). Die Schulleitung bekommt es weiterhin als PDF, aber mit dem Kopfvermerk „UNGÜLTIG –
  ersetzt durch Beleg … am …“ und dem Dateinamen `<BelegNr>-UNGUELTIG.pdf`. Der Snapshot bleibt unverändert.
- **DMS-Archivkopie:** Beim Ausstellen (einzeln und im Sammellauf) geht sie nach der Antwort raus (`after()`),
  die Oberfläche wartet nicht auf den Mailserver. Frisch ausgestellte Zeugnisse erscheinen erst nach
  **2 Minuten** als „noch nicht im DMS archiviert“ (nur mit `DMS_EMAIL`), damit der laufende Erstversand nicht
  doppelt nachgesendet wird. Der **Nachversand** (Knopf auf der Zeugnisseite bzw. `POST
  /api/zeugnisse/dms-nachsenden`, Recht `NOTEN_VERWALTEN`) sendet nur GÜLTIGE Zeugnisse, höchstens 4 Mails zu
  je 50 Zeugnissen je Klick, gruppiert nach Abschnitt, bricht beim ersten SMTP-Fehler ab und ist gesperrt (ein
  zweiter gleichzeitiger Klick → 409; ohne `DMS_EMAIL` → 409). Versandläufe haben ein Zeitbudget von 20 s;
  wirft die Sperr-Transaktion nach gesendeten Kopien, gilt der Stand (kein 500). Audit
  `ZEUGNIS_DMS_NACHGESENDET`. Bekanntes Restrisiko: Klickt jemand in den Sekunden des Erstversands
  „Nachsenden“, kann eine Kopie doppelt im DMS liegen (Entscheidung ZEUG-dms-erstversand-vs-nachversand,
  Empfehlung: hinnehmen).
- **PDF-Zeichen:** Namen mit Zeichen außerhalb von Latin-1 werden über WinAnsi abgebildet (Š, Ž, Œ …) oder
  transliteriert (ł→l, ř→r, ş→s, İ→I). Nicht-lateinische Schriften (Kyrillisch, Griechisch) erscheinen weiter als
  „?“ (Entscheidung E-betrieb-pdf-nichtlateinische-schrift).

### Anmeldung, Antwortansicht und Formular-Builder

- **Antwortansicht** `/verwaltung/anmeldungen/[id]` („Antworten ansehen“): Antworten nach den Abschnitten der
  verwendeten Formularfassung, Link „Akte öffnen“ (mit `PERSON_LESEN_ALLE`), darunter die Entscheidung.
  Schulleitung: alle Antworten, Art. 9 nur bei wirksamer Einwilligung; Verwaltung: alle Nicht-Art.-9-Antworten;
  Administrator: kein Zugriff. Die IBAN steht nie in der Ansicht; die Bankverbindung erscheint als „hinterlegt“,
  der Klartext nur über „vollständig anzeigen“ (POST, protokolliert, `Cache-Control: no-store`). Jeder Abruf
  schreibt `ANMELDUNG_ANTWORTEN_ANGESEHEN` (nur `personId` und `art9Angezeigt`). Nach Aufnehmen/Ablehnen bleibt
  die Meldung stehen, bis „Ansicht aktualisieren“ geklickt wird. Anmeldungen Anonymisierter stehen nicht mehr in
  der Arbeitsliste.
- **Zwischenstand:** Der Link lautet `/anmeldung#fortsetzen=<token>`; das Formular lädt per
  `POST /api/anmeldung {aktion:"laden"}`. `ANMELDUNG_MAX_PRO_IP` gilt je Aktion (speichern, absenden, laden) als
  eigenes Kontingent. Alte `?fortsetzen=`-Links funktionieren weiter und werden beim ersten Aufruf ins Fragment
  umgeschrieben (dieser eine Aufruf steht noch im Zugriffslog). Die Oberfläche nennt vorher, was nicht
  gespeichert wird (Titel der Art.-9-Abschnitte und die IBAN), zeigt den Link mit Kopier-Knopf und sagt beim
  Fortsetzen, dass die Zustimmungen neu zu setzen sind. Beim Verlassen mit ungesicherten Eingaben warnt der
  Browser (Art.-9-Freitexte und IBAN gelten immer als ungesichert).
- **Fangfeld:** Die öffentliche Anmeldung hat ein verstecktes Feld `hp_feld` (vorher `website`, das
  Passwortmanager ausfüllten). Ist es gefüllt, antwortet der Server wie bei Erfolg, legt aber keine Akte an und
  schickt keine Mail; Audit `ANMELDUNG_VERWORFEN_FANGFELD` ohne Werte. **Die Verwaltung sollte diese Aktion im
  Protokoll beobachten** — jeder Eintrag ist ein Roboter oder eine still verworfene echte Anmeldung.
- **Barrierefreiheit:** Pflichtangaben sind für Vorlesesoftware als „(Pflichtangabe)“ markiert; die
  Art.-9-Einwilligung steht zusätzlich im Platzhalter, mit Live-Ansage und Fokus beim Freischalten; die
  IBAN-Bestätigung steht in Textfarbe auf grüner Tönung.
- **Formular-Builder:** Schlüssel und IDs laufen über eine clientseitige `uid`, die Abschnittsköpfe sind
  beschriftet. Antwortmöglichkeiten werden erst beim Verlassen des Felds bereinigt; eine umbenannte Antwort muss
  neu Schüler/Hörer zugeordnet werden. Die Zuordnung wird beim Laden übernommen (`alsBuilderAbschnitte` in
  `lib/formular.ts`), die PUT-Route bereinigt Antworten und Zuordnung selbst, das Veröffentlichen prüft die
  Felddefinition und nennt Mängel mit Feldschlüssel. **Das Aktenfeld Gemeinde ist immer „Besonders geschützt
  (Art. 9)“** — das Häkchen wird gesetzt und gesperrt, der Server prüft es beim Speichern und beim
  Veröffentlichen, und zur Laufzeit gilt die Gemeinde auch in älteren Fassungen ohne Häkchen als Art. 9. Die
  gemeinsame, DB-freie Logik von Builder und Prüfskript liegt in `src/lib/formular-optionen.ts` (inkl.
  `ART9_AKTENFELDER`), getrennt von `formular.ts` wegen des Prisma-Imports — dasselbe Muster wie `pruefwerte.ts`.
- **Bestandsinstallationen:** Die veröffentlichte Formularfassung trägt den Satz „Mit * gekennzeichnete Felder
  sind Pflichtangaben.“ weiter doppelt in der Einleitung (der Seed überschreibt keine Fassung). Für die
  Schulleitung: Formulare → Entwurf öffnen → den Satz aus „Einleitung über dem Formular“ löschen → veröffentlichen.

### Datenauskunft, Selbstpflege, Anmelden

- Die **Auskunfts-PDF** enthält jetzt auch die Rückmeldung zur Semesterüberleitung (eingeladen, bestätigt,
  abgemeldet mit Grund), Anwesenheit samt Selbstbestätigung, Leistungen und Noten, Zeugnisse (auch ersetzte,
  mit DMS-Datum), Unterrichtsabende als Dozent und Honorarabrechnungen mit Posten. Freitext-Vermerke der Schule
  werden nur benannt. Die Begleitangaben (Zwecke, Kategorien, Herkunft) sind erweitert, nennen einen
  vorhandenen Ablehnungsgrund (gesondert herauszugeben, nicht abgedruckt) und die DMS-Übermittlung von
  Zahlungsbelegen; der Zeugnis-Hinweis verweist auf die Schulverwaltung. Offen: DMS als Empfänger,
  Protokolldaten, Speicherdauer, Art. 22 (siehe unten).
- Ein **Adresswechsel** (durch die Verwaltung oder selbst bestätigt) entwertet auch offene Auskunftslinks
  (Audit `entwerteteAuskunftslinks`); ein selbst bestätigter Wechsel zusätzlich offene Anmeldelinks
  (`entwerteteAnmeldelinks`). Mails nach dem Commit laufen über `sendeNachVorlage` (kein 500 mehr bei Vorlagen-
  oder SMTP-Fehler).
- Eine **IBAN- oder Kontoinhaber-Änderung** unter „Meine Daten“ schickt die Hinweis-Mail
  `BANKVERBINDUNG_GEAENDERT` an die hinterlegte Adresse (Rat: „ein (neues) Passwort setzen, damit fremde
  Sitzungen enden“; offene Entscheidung E1-iban-freigabesperre). Der Klartext-Abruf der Bankverbindung läuft
  per POST und nie aus einem Cache.
- **Token im Fragment** gilt jetzt für alle Links: Anmeldung, Auskunft, Überleitung, Zwischenstand
  (`#fortsetzen=`) und E-Mail-Bestätigung (`/meine-daten/email#token=…`). Alte `?token=`-Links werden bis zum
  Ablauf noch gelesen und clientseitig ins Fragment verschoben.
- **`/anmelden`** zeigt eine noch laufende Sitzung samt Abmelde-Knopf, verlinkt auf die Anmeldung zur
  Bibelschule, zeigt Fehler rot getrennt vom Erfolg und bietet nach dem Senden „Andere Adresse eingeben“.
  **Abmelden** löscht das `__Host-`-Cookie jetzt mit `Secure`/`Path`/`HttpOnly`/`SameSite` und `Max-Age=0`; der
  Knopf leitet nur bei Erfolg weiter. Einen serverseitigen Widerruf gibt es nicht (Entscheidung
  AUTH-serverseitiger-widerruf).
- Die **Drosseln** zählen atomar per `pg_advisory_xact_lock` je Schlüssel; bei IPv6 ist der Anschluss das
  /64-Netz.

### Prüfen ohne Docker (Sandbox + PGlite)

So lässt sich der Stand ohne Docker verifizieren (so geschah es am 27.09., bevor Docker wieder lief) — ohne die Sync-Fallen. Alles läuft
in einer **Kopie außerhalb des synchronisierten Ordners**; das Repo wird nur gelesen. Exit-Codes immer über eine
`EXIT=`-Zeile am Log-Ende lesen, nie über `| tail`.

```bash
SBR="$HOME/gbs-sandbox"; REPO="<Repo-Wurzel>"
mkdir -p "$SBR/gbs-campus" && rsync -a --delete --exclude node_modules --exclude .next --exclude prisma/compiled --include .env.example --exclude '.env' --exclude '.env.*' --exclude '*.tsbuildinfo' "$REPO/gbs-campus/" "$SBR/gbs-campus/"
```

`.env.example` muss mit (`pruefe-betrieb.ts` liest es), jede echte `.env` bleibt draußen. Dann in
`$SBR/gbs-campus` — `npm ci` nur, wenn sich `package-lock.json` geändert hat:

```bash
npm ci --ignore-scripts > ../npm-ci.log 2>&1; echo "EXIT=$?" >> ../npm-ci.log
npx prisma generate > ../generate.log 2>&1; echo "EXIT=$?" >> ../generate.log
DATABASE_URL="postgresql://x:x@127.0.0.1:5432/x" npx prisma validate > ../validate.log 2>&1; echo "EXIT=$?" >> ../validate.log
npx tsc --noEmit > ../tsc.log 2>&1; echo "EXIT=$?" >> ../tsc.log
npm run pruefen > ../pruefen.log 2>&1; echo "EXIT=$?" >> ../pruefen.log
env -i PATH="$PATH" HOME="$HOME" TZ=Europe/Berlin npm run pruefen > ../pruefen-wie-docker.log 2>&1; echo "EXIT=$?" >> ../pruefen-wie-docker.log
env -i PATH="$PATH" HOME="$HOME" NEXT_TELEMETRY_DISABLED=1 npm run build > ../build.log 2>&1; echo "EXIT=$?" >> ../build.log
bash -n scripts/durchstich.sh; echo "EXIT=$?"
```

`prisma validate` braucht eine `DATABASE_URL`, baut aber keine Verbindung auf — ein Platzhalter genügt. Der
Build läuft in leerer Umgebung wie die Stufe `builder` (dort ist keine Build-Umgebung gesetzt). Die drei
esbuild-Bundles (`prisma/seed.ts`, `scripts/worker.ts`, `prisma/setup-app-nutzer.ts`) baut man mit denselben
Flags wie im `Dockerfile` (`--bundle --platform=node --target=node24 --format=cjs --tsconfig=tsconfig.json
--external:@prisma/client`).

**Migrationen gegen PGlite** (PostgreSQL als WASM, kein Server nötig). In einem eigenen Ordner neben der Kopie
`npm install @electric-sql/pglite @electric-sql/pglite-socket`, dann zwei kleine Node-Skripte:

- **Migrationstest:** eine In-Memory-`PGlite`-Instanz, jede `prisma/migrations/*/migration.sql` in
  lexikografischer Reihenfolge einzeln mit `db.exec()` (wie `prisma migrate deploy`), danach gezielte
  SQL-Prüfungen, jede in einer Transaktion, die zurückgerollt wird (Trigger, Append-only, CHECKs, partielle
  Indexe, Nachtragen, Idempotenz).
- **Drift-Prüfung:** je Lauf eine frische `PGlite`-Instanz hinter `PGLiteSocketServer` auf `127.0.0.1:<Port>`
  als Shadow-Datenbank, dann in der Kopie
  `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "postgresql://postgres:postgres@127.0.0.1:<Port>/postgres?sslmode=disable&connection_limit=1" --script`.
  Soll: `-- This is an empty migration.`

Grenzen: PGlite ist PostgreSQL 18, die Produktion 16. Prisma 6.19 sieht weder Trigger noch CHECKs noch
partielle Indexe — die deckt nur der Migrationstest, nicht der Drift-Diff. Ergebnis am 27.09.: 24 Migrationen,
65 SQL-Prüfungen OK, kein Drift. Die Hilfsskripte liegen nicht im Repo; wer sie dauerhaft braucht, legt sie als
`scripts/pruefe-migrationen-pglite.mjs` o. ä. an (dann mit eigener `package.json`, damit die Abhängigkeit nicht
ins Image wandert).

### Prüfzahlen (Soll, Stand 27.09.2026, spät)

| Skript | Soll | Skript | Soll |
|---|---:|---|---:|
| formularlogik | 65 | selbstbestaetigung | 15 |
| semesterlogik | 184 | honorar | 68 |
| eigene-daten | 58 | honorar-abrechnung | 70 |
| passwort | 38 | benutzerverwaltung | 97 |
| auskunft | 55 | anonymisierung | 47 |
| beitrag | 16 | herkunft | 42 |
| faecher | 17 | anmeldung-antworten | 58 |
| stundenplan | 45 | betrieb | 117 |
| quote-schueler | 53 | anmelde-schutz | 52 |
| | | **`npm run pruefen` gesamt** | **1341 in 20 Skripten** |
| leistung | 67 | `npm run pruefen:db` (einstellungen + auskunft-db) | 19 + 18 |
| zeugnis | 177 | `bash scripts/durchstich.sh` | **850** (grün 27.09. spät) |

`pruefe-stundenplan.ts` muss in Europe/Berlin laufen (Abschnitt 8 prüft feste UTC-Zeitpunkte über die
Zeitumstellung) und wird in UTC absichtlich rot; `pruefe-alle.ts` setzt die Zeitzone je Skript selbst. Jedes
Skript prüft seine Soll-Zahl (`ERWARTET`), der Durchstich `SOLL` am Skriptende — beim Ergänzen mit anheben.

### Offene Entscheidungen

Nicht umgesetzt, weil sie eine fachliche oder organisatorische Wahl verlangen. Kürzel wie im Bericht der
Fix-Runden; die Empfehlung ist ein Vorschlag, keine Festlegung.

| Kürzel | Frage | Empfehlung |
|---|---|---|
| **Rechte und Sicherheit** | | |
| SEC-admin-selbstvergabe, ARCH-rollen-obergrenze | Ein Administrator kann sich selbst fachliche Rollen geben; es gibt keine Obergrenze beim Vergeben. | Selbsterweiterung 403, Obergrenze (ADMIN vergibt alles außer an sich selbst), Mail an die Schulleitung bei Vergabe von ADMIN/SCHULLEITER/VERWALTUNG |
| SEC-honorar-selbstabrechnung | Verwaltung und Dozent in einer Person können sich selbst abrechnen, freigeben, auszahlen und vergangene Abende selbst zuordnen. | Selbstbegünstigung 409, Selbstzuordnung vergangener Abende sperren; Vier-Augen erst ab zwei Berechtigten |
| E1-iban-freigabesperre | Reicht nach einem IBAN-Wechsel die Hinweis-Mail? | Freigabe zeigt „Bankverbindung seit letzter Abrechnung geändert“ und verlangt eine Bestätigung (Rückruf) |
| AUTH-serverseitiger-widerruf | Ein kopiertes Sitzungscookie bleibt bis Max-Age gültig. | Knopf „Überall abmelden“ in „Meine Daten“ |
| E-betrieb-migrationsdienst | Eigentümer-Passwort ganz aus dem App-Container nehmen? | eigener Init-Dienst `migrate`, `app` nur mit `gbs_app` (macht `gbs_app` zur Pflicht); danach Abschnitt 49 umdrehen |
| E3-rechte-ohne-funktion | Vier Rechte ohne Prüfstelle | behalten und kennzeichnen (umgesetzt); über das Entfernen von `IMPERSONATION` vor dem GoLive entscheiden |
| E5-ipv6-praefix | IPv6-Anschluss als /64 | /64 belassen |
| ERR-anmeldelink-ip-drossel, PER-ip-drossel-anmeldelink | Der Anmeldelink der Verwaltung zählt gegen das IP-Kontingent des Büros (am Semesterstart drohen 429). | eigenes Kontingent je Akteur bzw. IP-Drossel für den Verwaltungsweg aussetzen |
| **Datenschutz** | | |
| LUECKE-art9-widerruf | Widerruf der Art.-9-Einwilligung wird versprochen, ist aber nicht umsetzbar. | Aktion für die Schulleitung (Einwilligung erteilt=false, Gemeinde leeren, Art.-9-Antworten „[widerrufen]“) |
| LUECKE-loeschfrist-abgelehnte | Keine Löschfrist für abgelehnte Bewerber | Fälligkeitsliste mit Knopf, später automatisch |
| ANM-art9-nach-entscheidung | Art.-9-Antworten bleiben nach der Entscheidung sichtbar. | nur bei EINGEREICHT anzeigen |
| ZEUG-dms-anonymisierte | DMS-Nachversand erfasst Zeugnisse Anonymisierter | `ANONYMISIERT` ausschließen |
| E-betrieb-zeugnis-person-cascade | Zeugnisse verschwinden beim echten Löschen der Person per Cascade. | `RESTRICT` auf `zeugnisse_personId_fkey` plus `REVOKE DELETE ON personen FROM gbs_app`; Aufbewahrungsfrist getrennt festlegen |
| E-auskunft-empfaenger-dms | DMS als Empfänger bzw. Auftragsverarbeiter nennen? | Satz zum DMS des Trägers ergänzen, bei externem Dienstleister diesen nennen |
| E-auskunft-protokolldaten | Protokolldaten in die Auskunft? | Versandprotokoll und eine Zusammenfassung der Audit-Einträge aufnehmen |
| E-auskunft-speicherdauer | Konkrete Aufbewahrungsfristen nennen? | ja, nachdem der Träger sie festgelegt hat (z. B. Honorarabrechnungen 10 Jahre nach § 147 AO) |
| E-auskunft-art22 | Widerspricht „keine automatisierte Entscheidung“ der automatischen Abmeldung ohne Rückmeldung? | Satz präzisieren (regelbasiert, jederzeit durch die Schulleitung umkehrbar) |
| BETR-einwilligung-tippfehler | Einwilligungstexte v1 mit „fuer“/„ausdruecklich“ | **erledigt 27.09.:** Fassung 2 korrigiert, Fassung 1 abgelöst |
| E2-personenname-im-seitentitel | Name der Person im Tab-Titel? | nein, feste Titel beibehalten (umgesetzt) |
| **Betrieb und Architektur** | | |
| ARCH-seed-ueberschreibt-konfiguration | Seed überschreibt Statusschalter, Rechtematrix, Vorlagen, Raster; Kommentare versprechen Änderbarkeit. | jetzt Kommentare korrigieren (Code-Konfiguration offiziell), mit einem Editor „Seed nur anlegen“ |
| ARCH-status-schalter-tot | `anwesenheitZaehlt`/`beitragLaeuft` werden nicht gelesen; ANGENOMMEN zählt entgegen dem Schalter. | Schalter nutzen (Verhalten gleich), `beitragLaeuft` kommentieren |
| PERF-belegdaten-ungebunden | Was soll der Satz-Beleg dokumentieren? | nur die Abende, deren Betrag dieser Satz bestimmt |
| E-betrieb-pdf-nichtlateinische-schrift | Kyrillisch/Griechisch im PDF als „?“ | belassen, lateinische Ausweisschreibweise erfassen |
| E-SEM-dozent-semesterfenster | Dozenten-Startseite lädt die ganze Historie. | laufendes, künftige und Vorsemester voll laden, ältere eingeklappt |
| ENT-version-package | `package.json` steht auf 0.1.0, die Commits auf 0.4. | 0.4.0 mit ausdrücklichem Auftrag |
| **Semester und Überleitung** | | |
| PER-abgebrochen-endzustand | ABGEBROCHEN ist Endzustand ohne Rückweg. | **umgesetzt 27.09. spät:** kein Endzustand mehr, Rückweg nach AKTIV mit Pflichtgrund |
| PER-formwechsel-rueckwirkend | Formwechsel stellt die laufende Teilnahme auch kurz vor Semesterende um. | Wahl „ab sofort“ oder „ab nächstem Semester“ |
| SEM-nachholen-nach-ausfall | Nachholen nach Worker-Ausfall meldet auch aktiv Teilnehmende ab. | **umgesetzt 27.09. spät:** Teilnahmen mit Anwesenheit oder Leistung gelten als zurückgemeldet |
| SEM-bin-raus-sammeluebernahme | „Bin raus“ wird im Folgesemester per Übernehmen still aufgehoben. | **umgesetzt 27.09. spät:** getrennt ausgewiesen, nur einzeln übernehmbar |
| SEM-zusage-von-hand | Telefonische Zusage nicht eintragbar | **umgesetzt 27.09. spät:** Knopf „Zusage eintragen“ (Schulleitung und Verwaltung) |
| SEM-einladung-erneut-senden, E-ueberleitung-nachversand | Kein „Einladung erneut senden“; nach T-3 keine Wiederholung | **umgesetzt 27.09. spät:** Sammelknopf für nicht zugestellte Einladungen, kein automatischer Nachversand |
| E-semester-start-vorziehen-heute | Beginn auf heute vorziehen ist bei offenen Einladungen gesperrt, ohne Ausweg. | Meldung nennt den frühesten möglichen Tag |
| E-semester-start-vorziehen-zukunft | Vorziehen in der Zukunft verkürzt die Antwortfrist still. | Rückfrage mit Zahl der Betroffenen |
| SEM-zahlweise-excel | Zahlweise fehlt im Excel-Export. | Spalte aus der jüngsten angenommenen Anmeldung, falls Lastschriften aus dem Export laufen |
| **Honorar, Zeugnisse, Anmeldung** | | |
| HON-iban-abgleich-nachversand | Nachversand nutzt die aktuelle IBAN ohne Abgleich. | IBAN-Fingerabdruck bei der Freigabe, Abweichung 409 |
| E-honorar-rueckwirkender-satz | Soll ein rückwirkender Satz für abgerechnete Abende etwas auslösen? | nein; Rückfrage warnt bei Gültig-ab in der Vergangenheit |
| LUECKE-bescheinigung-ohne-anwesenheit | Teilnahmebescheinigung bestätigt alle Fächer auch ohne Anwesenheit. | **umgesetzt 27.09. spät:** nur Fächer mit mindestens einer Anwesenheit; Sammellauf überspringt Personen ohne Anwesenheit |
| ZEUG-storno-ohne-ersatz | Kein Zeugnis-Storno ohne Ersatz | **umgesetzt 27.09. spät:** Status STORNIERT mit Pflichtgrund, bleibt als Nachweis; Aufbewahrungsfrist weiter offen |
| ZEUG-dms-erstversand-vs-nachversand | Doppelte Archivkopie möglich, wenn der Nachversand in den Erstversand fällt | hinnehmen |
| LUECKE-anmeldung-gesamtdrossel, E-ANM-missbrauchsschutz | Reicht Fangfeld plus IP-Drossel? | **entschieden und umgesetzt 27.09. (E-23):** Gesamtgrenze 10/Stunde und 30/Tag, Mindestdauer 3 s, Warnung an die Verwaltung — siehe ganz oben |
| ANM-du-sie, E-ANM-anrede | Das Formular mischt Du und Sie. | **entschieden und umgesetzt 27.09. (E-22):** überall „Sie“; Bestand im Builder angleichen (siehe ganz oben) |
| E4-anmeldestatus-begriff | Stand einer angenommenen Anmeldung heißt überall „Angenommen“. | so belassen (umgesetzt) |

---

## Stand 29.07.2026, abends

Release **0.2 ist inhaltlich komplett** — alle vier Bausteine (Semesterüberleitung, Kursraster,
Stundenplan/Anwesenheit, Worker, Löschkonzept nach Art. 17 und zuletzt **#4 Selbstbestätigung der
Anwesenheit + Dozentenhonorar**). Danach am selben Tag zusätzlich:

- **7-Agenten-Code-Review** von #4 (1 MAJOR + Härtungen behoben, u. a. WCAG-3.2.2-Auswahlfelder auf
  Knöpfe/expliziten Speichern-Knopf, TOCTOU beim Anwesenheits-Write, Honorar zählt keine künftigen Abende).
- **GoLive-Härtungen** (aus „Bekannte Einschränkungen"): **CSP** (`next.config.ts`), **Speichergrenzen**
  (`mem_limit` 768/256 MB), **getrennter, rechtebeschränkter DB-Nutzer `gbs_app`** (nur DML, audit_log/
  einwilligungen append-only per Recht; opt-in über `APP_DB_PASSWORD`, nicht-brechend).
- **Benutzerverwaltung vollständig in der Oberfläche**: Rollen verwalten, Person anlegen (beide Recht
  `BENUTZER_VERWALTEN`), fremde Stammdaten ändern (Recht `PERSON_BEARBEITEN_ALLE`).

Alles grün und auf `origin/main`: Produktionsbuild ohne Typfehler, **351** DB-freie Fachlogik-Prüfungen,
**269** Durchstich-Prüfungen gegen das gebaute Image, dazu die Browser-/Markup-Gegenproben.

**Morgen als Nächstes:** die **0.3-Grundlage** planen und beginnen (Optigem-Anbindung,
Leistungserfassung, Beitragslauf, Honorar-Abrechnung). Ein konkreter, gut abgegrenzter erster Baustein
liegt schon fest: den **Honorarsatz je Abrechnungsperiode/Termin fixieren** (Snapshot), damit ein
geleistetes Honorar nicht nachträglich umbepreisbar ist (siehe „Was als Nächstes gebaut wird").
Unabhängig davon bleiben vor dem Livegang am **20.08.** die menschlichen/externen Punkte: Laientest
([`LAIENTEST.md`](LAIENTEST.md)), SPF/DKIM/DMARC für `gbs-minden.de` (Show-Stopper, extern),
Restore-Drill und Mail-Zustellbarkeit.

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

Soll (Stand 27.09.2026, abends): **1229 Prüfungen in 20 Skripten** — die Liste steht oben unter „Prüfzahlen“.
`npm run pruefen` startet `scripts/pruefe-alle.ts`, das jedes Skript in `TZ=Europe/Berlin` laufen lässt und
am Ende die Gesamtsumme nennt. Jedes Skript meldet am Ende selbst, ob wirklich alle gelaufen sind, und prüft
eine eigene Soll-Zahl. Seit Code-Review 4 führt schon `docker build --target builder` diese Prüfungen aus.

```bash
docker build -t gbs-campus-test:local . > /tmp/build.log 2>&1 && bash scripts/durchstich.sh
```

Soll (Stand 27.09.2026, abends): **787 Prüfungen** (grün). Der Durchstich braucht die Dev-Datenbank auf Port 5434
(`docker start gbs-campus-db-dev`, ohne eigene Zeitzone, also UTC) und legt sich darin eine eigene Datenbank
`gbs_durchstich` an. Auch er zählt gegen eine Soll-Zahl (`SOLL=787` am Skriptende) — beim Ergänzen einer
Prüfung mit anheben. Seit M19 ist er kalenderunabhängig und läuft an jedem Tag gleich.

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
**Passwort** an. **Im Browser dann auch genau `http://127.0.0.1:3000` öffnen**, nicht `localhost:3000`:
Seit Code-Review 4 weist die Herkunftsprüfung sonst jede Änderung mit 403 ab (siehe „Neue Regeln für Betrieb
und Weiterbau“). Ein Schulleitungskonto anlegen (Passwort-Hash direkt in die DB, weil `testperson-anlegen.ts`
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

Das Portal dann unter genau dieser Adresse öffnen (`http://localhost:3000`, nicht `127.0.0.1`), sonst weist
die Herkunftsprüfung jede Änderung mit 403 ab.

Eine frische Datenbank hat noch kein Konto. Weitere Konten legt man später in der Oberfläche an
(Verwaltung → Personen → „Person anlegen“, Recht `BENUTZER_VERWALTEN`, Rollen ebenda) — das **erste** Konto
entsteht für die Entwicklung per Skript:

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
nicht lokal** — oder, ohne Docker, in einer Kopie außerhalb des synchronisierten Ordners (siehe oben „Prüfen
ohne Docker“). Besser noch: `node_modules` und `.next` von der Synchronisierung ausnehmen.

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
| **Anonymisierung erfasst auch Zeugnis-Snapshots** (27.09.2026) | Name und Geburtsdatum werden überschrieben, das Zeugnis bleibt als namenloser Nachweis. Name + Bibelschule ist eine Angabe mit Art.-9-Bezug. |
| **„Bin raus“ / keine Rückmeldung meldet die Teilnahme ab, nicht die Person** (27.09.2026) | Ein Semester auszusetzen ist kein Abbruch. Gespeichert an der Teilnahme, alle Semesterlisten filtern mit `TEILNAHME_ZAEHLT`. |
| **ABSOLVENT ist kein Endzustand** (27.09.2026) | Absolventen brauchen den Zugang für Abschlusszeugnis und eigene Daten; sie zählen nicht als aktiv und bekommen keine Automatik-Mails. |
| **Gemeindezugehörigkeit bleibt in Excel-Export und Oberfläche** (27.09.2026) | Abgewogen: Die Angabe ist Art.-9-relevant und verlässt mit dem Export das System; entschieden ist, Export und Anzeige unverändert zu lassen. Schutz bleibt: Erfassung nur mit Einwilligung, jeder Export im Audit-Log, keine IBAN im Export. Befunde dazu gelten als bewusst. |
| **Art.-9-Antworten nur mit Recht und Einwilligung sehen** (Code-Review 4) | Die Antwortansicht zeigt Art.-9-Antworten nur mit `ANMELDUNG_ENTSCHEIDEN` **und** wirksamer Einwilligung. Es gilt die jüngste Einwilligungszeile, Gleichstand gilt als nicht erteilt; Antworten zu unbekannten Codes werden wie Art. 9 behandelt; die IBAN steht nie darin. Gespeichert werden Art.-9-Antworten nur, wenn **alle** aktiven Art.-9-Texte erteilt sind — dieselbe Regel, nach der das Formular freischaltet (`art9Eingewilligt` in `lib/anmeldung-antworten.ts`); ein mitgeschickter Code ohne gültigen Text erteilt nichts. Ob sie nach der Entscheidung sichtbar bleiben, ist offen (ANM-art9-nach-entscheidung). |
| **Audit nur mit Feldnamen** (Code-Review 4) | Das Audit-Log ist unlöschbar, die Anonymisierung erreicht es nicht. Personenwerte gehören deshalb nicht hinein. |

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

Aus Code-Review 4 kommen drei weitere dazu:

- **Nachweisdaten auf DB-Ebene sichern, nicht per Konvention.** Einwilligungstexte, Honorarsätze,
  Abrechnungen samt Posten und Zeugnisse sind jetzt per Trigger eingefroren. Ein neuer Schreibweg an diesen
  Tabellen braucht eine Migration, die die Trigger-Funktion anpasst.
- **Eine Semester-Zusage gilt für alle Lesepfade.** Wer Teilnahmen eines Semesters abfragt, mischt
  `TEILNAHME_ZAEHLT` ein — sonst stehen Abgemeldete wieder in Liste, Export, Anwesenheit, Noten oder
  Zeugnislauf.
- **Ins Audit gehören Feldnamen, keine Personenwerte** (siehe „Fachentscheidungen“ oben).

---

## Prüfen, ob noch alles steht

```bash
npm run pruefen
```

1229 Prüfungen der Fachlogik in 20 Skripten (Stand 27.09.2026, abends), ohne Datenbank, jedes Skript in
Europe/Berlin. Dann der vollständige Durchstich mit 787 Prüfungen (`bash scripts/durchstich.sh` nach dem
Build):

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

## Was als Nächstes gebaut wird (Stand 29.07.2026)

> Dieser Abschnitt beschreibt den Ausbau bis zum 29.07.2026. Was heute ansteht, steht ganz oben unter
> „Neuester Stand (27.09.2026)“; die Releases 0.3 und 0.4 (Honorar-Abrechnung, Dozenten- und Schülerbereich,
> Noten, Zeugnisse, UI-Umbau) beschreibt das README.

**Der Verifikationslauf ist am 28.07. grün durchgelaufen** — siehe weiter oben. Damit ist der Weg für
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

Dazu der **Worker-Container** (docker-compose-Dienst `worker`, gleiches Image, Einstieg
`node worker.js`): er führt die Erinnerungen und den Aufräumlauf **stündlich und idempotent** aus
(`scripts/worker.ts`) — damit entfällt der externe Zeitgeber. Der HTTP-Endpunkt bleibt fürs manuelle
Auslösen.

Dazu das **Löschkonzept nach Art. 17 DSGVO**: `/verwaltung/personen` → „Anonymisieren" (Recht
`PERSON_ANONYMISIEREN`, nur Schulleitung). Weil Audit-Log und Einwilligungen als Nachweis erhalten
bleiben müssen, wird nicht gelöscht, sondern **anonymisiert** — alle personenbezogenen Felder der
Person und die Anmelde-Antworten werden überschrieben, transiente Token gelöscht, der Status auf
`ANONYMISIERT` gesetzt. Das Audit protokolliert das **ohne** die alten Werte. Logik in
`src/lib/anonymisierung.ts` (DB-frei) und `src/lib/anonymisierung-io.ts`.

Verifiziert: **351 DB-freie Fachlogik-Prüfungen** (neu u. a. 20 Stundenplan, 18 Überleitung, 17
Kursraster, 15 Selbstbestätigung, 16 Honorar, 14 Anonymisierung) und **269 Durchstich-Prüfungen** gegen
das gebaute Image (inkl. Worker-Einzellauf, Art.-17-Scrub, Selbstbestätigung und Dozentenhonorar) —
alles grün, Produktionsbuild (`next build`) ohne einen Typfehler.

**#4 ist erledigt (29.07.) — beide Teile:**

- **Selbstbestätigung:** Der Teilnehmer bestätigt in `/meine-daten` → „Meine Anwesenheit" selbst die
  Anwesenheit bzw. Nacharbeit je Unterrichtstermin (nur ANWESEND/NACHGEARBEITET, nur die eigene
  Teilnahme, nur vergangene Termine). Baut ohne Migration auf `Unterrichtstermin`/`Anwesenheit` auf;
  ein von der Verwaltung erfasster Abend bleibt schreibgeschützt (Regel über `erfasstVonId`, DB-frei in
  [`src/lib/selbstbestaetigung.ts`](src/lib/selbstbestaetigung.ts)).
- **Dozentenhonorar:** DOZENT-Rolle scharfgeschaltet; Dozent je Unterrichtstermin zuordenbar (neues
  Feld `dozentId` → Person, `SetNull`, additive Handmigration `20260729150000_dozent_honorar`);
  Honorarsatz je Abend als Einstellung (`HONORAR_SATZ_PRO_ABEND`, ganzzahlig, Bereich FINANZEN);
  read-only Honorar-Übersicht `/verwaltung/honorar` (Recht `HONORAR_LESEN`, nur **bereits gehaltene**
  Abende × Satz). Abrechnung/Einzug bleibt Release 0.3.

**Für die 0.3-Abrechnung vormerken (aus dem Code-Review):** Der Honorarsatz wirkt heute *aktuell* auf
alle Semester. Die Übersicht zählt bewusst nur bereits gehaltene Abende, aber ein einmal geleistetes
Honorar darf bei der echten Abrechnung nicht nachträglich umbepreisbar sein — vor 0.3 muss der Satz je
Abrechnungsperiode (oder je Termin) **fixiert/gesnapshottet** werden (weder FK noch Einstellung erfassen
das heute). Ebenso ist die Dozenten-Zuordnung (`dozentId`) nicht an die DOZENT-Rolle gekoppelt: verliert
eine bereits zugeordnete Person die Rolle, zählt die Übersicht ihre Abende weiter — fachlich gewollt
(„wer gehalten hat, hat gehalten"), für die Abrechnung aber explizit zu bestätigen.

Damit ist Release 0.2 inhaltlich komplett. Was bleibt, ist Scharfschalten vor dem Livegang.

**Vor dem Livegang:** Laientest durch eine projektfremde Person, Restore-Drill, Break-Glass-Tresor
befüllen, Zustellbarkeit der Magic-Link-Mail gegen GMX, web.de, Gmail und Outlook prüfen. Das **erste
Semester ist durch den Seed gesetzt** (2026-H als laufend) — die Schulleitung muss nur bestätigen, dass
das die richtige Wahl ist, bzw. es unter `/verwaltung/semester` umstellen. Die
Überleitungs-Erinnerungen laufen jetzt **automatisch im `worker`-Container** — kein externer Zeitgeber
mehr nötig (`CRON_SECRET` ist nur noch für das optionale manuelle Auslösen über den HTTP-Endpunkt da).

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
| **Token im Zugriffsprotokoll des Proxy** — ✅ erledigt (29.07., ergänzt 27.09.) | Anmelde-, Bestätigungs- und Auskunftslink tragen den Token jetzt im **Adressfragment** (`…#token=…`), das der Browser nicht an den Server schickt — Traefik protokolliert ihn damit nicht mehr. Die Bestätigungsseiten lesen ihn clientseitig aus `location.hash`. Seit Code-Review 4 gilt das auch für den E-Mail-Bestätigungslink (`/meine-daten/email#token=…`) und den Zwischenstand der Anmeldung (`/anmeldung#fortsetzen=…`); alte Links mit `?token=` bzw. `?fortsetzen=` werden noch gelesen und clientseitig ins Fragment verschoben. |
| **Speichergrenze für den App-Container** — ✅ erledigt (29.07.) | `mem_limit: 768m` für die App und `256m` für den Worker sind im `docker-compose.yml` gesetzt — ohne sie holt sich der OOM-Killer im Zweifel die Datenbank statt der Anwendung. |

---

## Bekannte Einschränkungen

- **Kein Off-Site-Backup.** Der Dump liegt auf demselben Host wie die Datenbank.
- **Benutzerverwaltung jetzt vollständig in der Oberfläche (29.07.).** Unter `/verwaltung/personen`:
  **Rollen verwalten** (Recht `BENUTZER_VERWALTEN`, Administrator) — inkl. `DOZENT`, so wird die
  #4-Zuordnung im Stundenplan nutzbar; der letzte Administrator lässt sich nicht entziehen. **Person
  anlegen** (ebenfalls `BENUTZER_VERWALTEN`) — für Konten, die nicht über die Anmeldung entstehen
  (Dozenten, Mitarbeiter): startet als aktives Konto mit Rolle Teilnehmer, Anmeldelink schickt man
  danach von Hand. **Stammdaten fremder Personen ändern** (Recht `PERSON_BEARBEITEN_ALLE`,
  Verwaltung/Schulleitung) — Name und Kontaktdaten; E-Mail und Bankverbindung laufen weiter über ihre
  eigenen, abgesicherten Wege. Damit ist die Benutzerverwaltung als Oberfläche komplett.
  `scripts/testperson-anlegen.ts` (Skript) liegt weiterhin nicht im Produktions-Image.
- **Der partielle Index `semester_genau_ein_aktuelles` ist Prisma unbekannt.** Partielle Indexe lassen
  sich im Schema nicht ausdrücken; `prisma migrate dev` nimmt deshalb ein `DROP INDEX` in die nächste
  erzeugte Migration auf und die Invariante „genau ein laufendes Semester" fiele lautlos weg.
  **Jede von `migrate dev` erzeugte Migration vor dem Committen ansehen.** Dasselbe gilt für alle Trigger
  (Append-only, Einwilligungstexte, eingefrorene Belege — `migrate dev` kennt keine Trigger), für die
  CHECK-Constraints (`teilnahmen_abmeldung_konsistent`, Ehepartner) und die übrigen partiellen Indexe
  (`zeugnis_*`). Prisma lässt sie stehen, erzeugt sie aber auch nicht; der Drift-Diff sieht sie nicht. Der
  Hinweis steht auch am Semester-Modell in `schema.prisma`.
- **Getrennter Anwendungs-Datenbanknutzer (29.07., opt-in; nachgeschärft 27.09.).** Sobald
  `APP_DB_PASSWORD` gesetzt ist, verbindet sich der laufende Server als `gbs_app` — nur DML, kein DDL, und
  auf `audit_log`/`einwilligungen` nur INSERT (kein UPDATE/DELETE, per Recht entzogen); seit 27.09. zusätzlich
  kein UPDATE/DELETE/TRUNCATE auf `einwilligungs_texte`, kein DELETE auf Honorarsätzen, Posten und Zeugnissen
  und kein UPDATE auf Posten. Der Append-only-Schutz hängt damit nicht mehr allein am Trigger, den ein
  Eigentümer entfernen könnte. Migration, Setup der Rolle und Seed laufen weiter als Eigentümer (sie brauchen
  DDL); der Entrypoint schaltet erst danach auf `gbs_app` um — **nur, wenn `APP_DB_PASSWORD` nicht leer ist**
  (bis Code-Review 4 genügte die immer gesetzte `APP_DATABASE_URL`, und ein leeres Passwort legte den Server
  lahm, M2). Das Passwort braucht mindestens 16 Zeichen, nur Buchstaben und Ziffern, sonst bricht der Start ab;
  nach dem Umschalten entfernt der Entrypoint `DB_PASSWORD` aus dem Serverprozess (nicht aus der
  Container-Konfiguration, siehe E-betrieb-migrationsdienst). Eingerichtet wird die Rolle idempotent von
  `prisma/setup-app-nutzer.ts`. Im Durchstich läuft die **ganze App als `gbs_app`**; ohne die Variable bleibt
  es beim Eigentümer-Zugang (nicht-brechend). Der `worker` läuft bewusst weiter als Eigentümer — er startet
  nicht über den Entrypoint, ist nicht web-exponiert, und seine Operationen sind eine Teilmenge der (als
  `gbs_app` geprüften) App-Schreibvorgänge. Eine Härtung wäre ein eigener Init-Dienst mit getrennten
  env-Dateien.
- **Content-Security-Policy gesetzt (29.07.).** `next.config.ts` liefert eine CSP direkt am
  App-Container (`default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, keine fremden
  Skript-Hosts) — im Durchstich gegen die laufende Instanz geprüft, die Seite hydratisiert ohne
  CSP-Verstöße. Die übrigen Sicherheits-Header (HSTS, `frameDeny`, `nosniff`, Referrer-Policy) setzt
  weiterhin Traefik, seit 27.09. aus dem Datei-Provider (`docker/traefik-dynamisch.yml`, Middleware
  `gbs-sicherheit@file`). Die Referrer-Policy darf nie `no-referrer` werden, sonst scheitert die
  Herkunftsprüfung. `'unsafe-inline'` für Skripte bleibt vorerst nötig (Next bettet den Bootstrap
  inline ein); ein **nonce-basiertes Verschärfen** ist der nächste Schritt, bevor irgendwo
  Formulartexte als Markdown gerendert werden.
- **Eine Person wird nicht gelöscht, sondern anonymisiert** — echtes Löschen stößt bewusst auf den
  Append-only-Trigger (der Audit- und Einwilligungsnachweis muss bleiben). Das Löschkonzept nach
  Art. 17 DSGVO ist seit 0.2 gebaut und seit 27.09. vollständig: „Anonymisieren“ in der Personenakte
  überschreibt alle personenbezogenen Felder, Zeugnis-Snapshots und Versandprotokoll (Umfang und Grenzen oben
  unter „Löschkonzept“). Einen Löschpfad im Code gibt es nicht. Wo Postgres das Löschen einer Person doch
  zulässt (per SQL, etwa bei Testbereinigungen), nimmt es ihre Zeugnisse per Cascade mit — bewusst so
  gelassen, siehe E-betrieb-zeugnis-person-cascade.
- **Semester lassen sich nicht löschen** — bewusst kein Endpunkt dafür. Ein gelöschtes Semester
  risse alle Teilnahmen mit (`onDelete: Cascade`); die Anmeldungen blieben erhalten, verlören aber
  ihren Bezug.
