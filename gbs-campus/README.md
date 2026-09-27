# GBS Campus

Verwaltungssoftware der Gemeindebibelschule Minden · Christliches Werk Esra e.V.

Der fachliche Bauplan steht in [`../1_Bauplan.html`](../1_Bauplan.html) — dieses README beschreibt nur,
wie man den Code startet und was bereits steht.

**Neu hier?** [`UEBERGABE.md`](UEBERGABE.md) ist der Einstieg: in fünf Minuten lauffähig, die Fallen
dieser Umgebung, die feststehenden Entscheidungen und was als Nächstes gebaut wird.

**Aktueller Baustand (Release 0.1 bis 0.4, Stand 27.09.2026 nach Code-Review 4):**

- **M0 Fundament** — Datenmodell, Statusmaschine, Rollen/Rechte, Audit-Log, Docker-Stack
- **M0 Auth** — Anmeldung per Magic-Link, Sitzungen, serverseitige Rechteprüfung
- **M2 Formular-Builder** — versionierte Anmeldeformulare, Feldzuordnung in die Akte, Art.-9-Kennzeichnung
- **M2 Öffentliche Anmeldung** — `/anmeldung` ohne Login, Consent-Protokoll, Fortsetzen-Link,
  Aufnahme in die Akte, Entscheidung durch die Schulleitung
- **Einstellungen** — Gültigkeit der Anmeldelinks, Drosselschwellen, Sitzungsdauer
- **M1 Semester und Teilnehmerliste** — Semester anlegen und das laufende festlegen, Anmeldungen
  bekommen einen Semesterbezug, Liste „Aktive dieses Semester" mit Excel-Export
- **M1 Schülerakte mit Selbstpflege** — `/meine-daten`: eigene Akte ansehen, Kontakt und
  Bankverbindung selbst pflegen, E-Mail-Adresse über einen Bestätigungsweg ändern; die Verwaltung wird
  über jede Änderung informiert
- **Zugang wiederherstellen** — `/anmelden/hilfe` für „Ich komme nicht mehr rein" und
  `/verwaltung/personen`, wo Schulleitung und Verwaltung eine Anmeldeadresse ändern und einen
  Anmeldelink verschicken können
- **Passwort als zweiter Anmeldeweg** — freiwillig, scrypt, `/anmelden/passwort`; damit deckt sich
  jeder einzelne Verlust selbst ab (Passwort vergessen → Anmeldelink; Postfach verloren → Passwort)
- **Betriebssichtbarkeit** — `/verwaltung/protokoll` (Audit-Log), Betriebsansicht mit hängenden Mails,
  Empfängerzahl für Verwaltungsmeldungen und letztem Aufräumlauf
- **DSGVO-Auskunft (Art. 15)** — `/verwaltung/personen` → „DSGVO-Auskunft senden" (Recht
  `PERSON_EXPORTIEREN`): die Person erhält einen persönlichen, 3 Tage gültigen Abruf-Link und lädt ihre
  vollständige Datenkopie (Glaubensangaben nach Art. 9, IBAN im Klartext) selbst als PDF herunter —
  sensible Daten verlassen nie den Mailkanal. PDF-Erzeuger ohne externe Abhängigkeit (`src/lib/pdf.ts`).
  Alle Links tragen ihren Token im URL-Fragment (nicht im Query-String, kein Log-Leak): Anmeldung,
  Auskunft, Überleitung, E-Mail-Bestätigung (`/meine-daten/email#token=…`) und Zwischenstand der Anmeldung
  (`/anmeldung#fortsetzen=…`); alte `?token=`-/`?fortsetzen=`-Links werden bis zum Ablauf noch gelesen und
  clientseitig ins Fragment verschoben. Die Auskunft enthält seit 27.09. auch Überleitungs-Rückmeldung,
  Anwesenheit, Noten, Zeugnisse (auch ersetzte, mit DMS-Datum), Unterrichtsabende als Dozent und
  Honorarabrechnungen; ein Adresswechsel entwertet offene Auskunftslinks
- **Semesterüberleitung / Re-Enrollment (Release 0.2, „bin raus“ seit 27.09.)** —
  `/verwaltung/semesterueberleitung`: den Jahrgang des laufenden Semesters ins Folgesemester einladen.
  Jeder aktive Teilnehmer bekommt einen persönlichen Link (`/dabei/token`, Token im Fragment, ohne Login)
  mit **„Ich bin dabei“ oder „Ich bin raus“**; die Antwort ist bis zum Vortag des Semesterstarts änderbar.
  Wer „bin raus“ sagt oder bis Semesterstart nicht antwortet, dessen **Teilnahme** wird abgemeldet
  (`abgemeldetAm`, `abmeldeGrund`), der Personenstatus bleibt. Alle Listen eines Semesters (Teilnehmer,
  Excel, Anwesenheit, Noten, Zeugnislauf, Quote) filtern mit `TEILNAHME_ZAEHLT`. Offene Einladungen werden
  T−14/−7/−3 Tage vor Semesterstart erinnert (konfigurierbar, Bereich SEMESTER), je Stufe genau ein
  Versuch; Mail und Seite nennen die Frist „bis einschließlich“ Vortag des Starts. Die Einladungen gehen nach
  der Antwort per `after()` raus. „Wieder aufnehmen“ hebt eine Abmeldung auf. Seit dem 27.09.2026 (spät):
  Eine telefonische Zusage tragen Schulleitung oder Verwaltung mit „Zusage eintragen“ ein; nicht zugestellte
  Einladungen lassen sich bis zum Vortag des Starts per „Erneut senden“ nachschicken (neuer Link, kein
  automatischer Nachversand); wer zum Start nicht geantwortet hat, aber schon eine Anwesenheit oder Leistung
  hat, gilt als zurückgemeldet. Erinnerungs- und Abmeldelauf
  laufen im `worker`-Container; der HTTP-Endpunkt `POST /api/cron/erinnerungen` (per `CRON_SECRET`, ohne
  `Origin`-Header aufrufen) bleibt fürs manuelle Auslösen und antwortet `{ laeufe, abgemeldet }`. Logik in
  `src/lib/ueberleitung.ts`, DB-freie Kernlogik in `src/lib/semester.ts` und `src/lib/ueberleitung-regel.ts`,
  Filter in `src/lib/teilnahme-filter.ts`.
- **Worker-Container (Release 0.2)** — eigener docker-compose-Dienst `worker` (gleiches Image, Einstieg
  `node worker.js`), der die Abmeldung ohne Rückmeldung, die Überleitungs-Erinnerungen und den
  DSGVO-Aufräumlauf **stündlich und idempotent** ausführt (`scripts/worker.ts`). Damit braucht es keinen
  externen Zeitgeber mehr. Der Worker wartet beim Start, bis jede Migration aus `prisma/migrations` in
  `_prisma_migrations` abgeschlossen ist, höchstens 10 Minuten; danach endet er mit Exit 1, und Docker
  startet ihn neu (auf den Seed wartet er nicht eigens, dafür gibt es die Rückfallwerte). Nach jedem Lauf,
  in dem mindestens ein Teillauf gelungen ist, schreibt er `/tmp/gbs-worker-lebenszeichen`, das ein
  Docker-Healthcheck prüft. Ein gescheiterter Teillauf schreibt `WORKER_LAUF_FEHLGESCHLAGEN` ins Audit (nur
  die Teillauf-Namen). Bei `SIGTERM` fährt er sauber herunter.
- **Löschkonzept nach Art. 17 DSGVO (Release 0.2, vervollständigt 27.09.)** — Personenakte →
  „Anonymisieren“, abgesetzt unter „Löschung nach Art. 17 DSGVO“ (Recht `PERSON_ANONYMISIEREN`, nur
  Schulleitung). Weil Audit-Log und Einwilligungen append-only sind und als Nachweis (Art. 7 Abs. 1)
  erhalten bleiben müssen, wird **nicht gelöscht, sondern anonymisiert**: alle personenbezogenen Felder der
  Person UND die Anmelde-Antworten (`antworten`-JSON, inkl. Name/Adresse/IBAN/Art.-9-Angaben) werden
  überschrieben, dazu **Zeugnis-Snapshots** (Name, Geburtsdatum), Betreffs, Empfängeradressen und
  Fehlertexte im **Versandprotokoll** und Freitext-Gründe früherer Statuswechsel. Rollen werden entfernt,
  Sitzungen beendet, Token-Datensätze und Drosselzähler gelöscht, offene Anmeldungen geschlossen, der Status
  auf den Endzustand `ANONYMISIERT` gesetzt. Teilnahmen/Anwesenheiten/Einwilligungen bleiben ohne
  Personenbezug. Das Audit protokolliert die Anonymisierung **ohne** die alten Werte; das letzte
  Administratorkonto lässt sich nicht anonymisieren (409). Grenzen: Audit-Einträge vor dem 27.09.2026,
  IP-Adressen, Honorar-Belege und bereits ans DMS gesendete Kopien (Einzelheiten in `UEBERGABE.md`). Logik
  in `src/lib/anonymisierung.ts` (DB-frei) und `src/lib/anonymisierung-io.ts` (Transaktion).
- **Statusmaschine bedienbar (seit 27.09.)** — in der Personenakte der Block „Ausbildungsdaten & Status“
  (Recht `PERSON_STATUS_WECHSELN`, nur Schulleitung): Status wechseln (VERSTORBEN als echter Not-Aus,
  Pflichtgrund bei Endzuständen) und Geburtsdatum, Gemeinde und Teilnahmeform nachträglich ändern. Routen
  `POST /api/personen/[id]/status` und `PUT /api/personen/[id]/ausbildungsdaten`; einziger Schreibweg für
  Statuswechsel ist `src/lib/status-io.ts`, die Regeln stehen DB-frei in `src/lib/status.ts`
- **Antwortansicht der Anmeldungen (seit 27.09.)** — `/verwaltung/anmeldungen/[id]` zeigt die Bewerbung
  nach der verwendeten Formularfassung, bevor die Schulleitung entscheidet; Art.-9-Antworten nur mit Recht
  `ANMELDUNG_ENTSCHEIDEN` und wirksamer Einwilligung, jeder Abruf protokolliert
- **Fächer & Kursraster (Release 0.2, Grundstein Stundenplan M3)** — die sieben Fächer und das feste
  3-Jahres-Raster (13 Kurseinheiten) aus der Kursübersicht von gbs-minden.de als Seed
  (`prisma/kursraster-definition.ts`), sichtbar unter `/verwaltung/faecher`. Konkrete Semester sind
  über `lehrjahr`/`halbjahr` ans Raster gekoppelt — die „bin dabei"-Seite zeigt so die Fächer des
  Zielsemesters; beides ist unter `/verwaltung/semester` pflegbar. Die **sechs realen Semester**
  (2026-H … 2029-F) legt der Seed nur in eine **leere** Semestertabelle; danach gehören Semesterdaten dem
  Betrieb und überleben jeden Neustart.
- **Stundenplan & Anwesenheit (Release 0.2, M3)** — `/verwaltung/stundenplan`: die Unterrichtsabende
  eines Semesters (die zehn Dienstagabende ab Semesterbeginn per Knopf), jeder optional einer
  Kurseinheit zugeordnet. **Anwesenheit** je Teilnahme × Termin (anwesend / entschuldigt / gefehlt /
  nachgearbeitet) und die **Quote**: anwesend und nachgearbeitet zählen als teilgenommen, unter der
  Schwelle (`ANWESENHEIT_MINDEST_PROZENT`, Standard 80 %) wird sie markiert. DB-freie Kernlogik in
  `src/lib/stundenplan.ts` (Quote + Dienstags-Generator), IO in `src/lib/stundenplan-io.ts`.
- **Honorar (Release 0.2/0.3)**, **Dozenten- und Schülerbereich (0.3)**, **Noten und Zeugnisse (0.4)** —
  siehe die Abschnitte weiter unten.

> ### 🟢 Stand 27.09.2026: Code-Review 4 behoben, Anrede „Sie“, Schutz vor Massenanmeldungen, Semesterbetrieb
>
> Alle 19 MAJOR-Befunde aus [`../10_Code-Review-4.md`](../10_Code-Review-4.md) und der größte Teil der
> MINOR-Befunde sind behoben (Branch `fix/code-review-4`, in `main` gemergt). Am Abend kamen durchgängig „Sie“
> und der Schutz vor Massenanmeldungen dazu (Branch `feat/anmeldung-sie-massenschutz`, in `main` gemergt), spät
> die sieben Empfehlungen für den Semesterbetrieb (Zusage von Hand, Einladung erneut senden, Worker-Ausfall,
> „bin raus“ bei der Übernahme, Wiederaufnahme nach Abbruch, Hörer-Bescheinigung nur mit Anwesenheit,
> Zeugnis-Storno). Verifiziert mit Docker gegen PostgreSQL 16: **1341 DB-freie Prüfungen in 20 Skripten**,
> `next build` grün, alle 25 Migrationen fehlerfrei, **Durchstich 850/850 grün** gegen das gebaute Image,
> `pruefen:db` 19 + 18 grün (alles am 27.09.2026). Einzelheiten, Fachentscheidungen vom
> 27.09. und offene Entscheidungen in [`UEBERGABE.md`](UEBERGABE.md).

> ### ✅ Der Stand vom 27.07. ist verifiziert (28.07.2026)
>
> Der Verifikationslauf, der am 27.07. an der vollen Festplatte gescheitert war, ist nachgeholt:
> Produktionsbuild grün (und damit die Typprüfung des gesamten Standes, den sechs Agenten ohne
> mitlesenden Compiler geschrieben hatten), **179 Fachlogik-Prüfungen**, **14 Mutationstests** der
> Passwortlogik, **150 Durchstich-Prüfungen** gegen das gebaute Image — alles grün. Zwei Lücken kamen
> dabei heraus, beide in den Prüfskripten, keine in der Anwendung:
>
> - Die Speichergrenze `MAXMEM` war von keiner Prüfung gedeckt. Zwei Prüfungen ergänzt.
> - „Ohne erkennbare Herkunft wird abgewiesen" konnte nie feuern: Fehlt der Herkunftsheader ganz,
>   setzt Next.js selbst ein `X-Forwarded-For` mit der TCP-Gegenstelle ein. Die Prüfung schickt den
>   Header jetzt **leer** mit und pinnt die Ursache über das Audit-Log.
>
> Einzelheiten in [`UEBERGABE.md`](UEBERGABE.md), Begründung jedes Fixes in
> [`../3_Code-Review-2.html`](../3_Code-Review-2.html).

Als Nächstes: den Durchstich mit Docker laufen lassen und `fix/code-review-4` mergen, den Stack auf
Staging mit TLS durchspielen, dann Laientest durch eine projektfremde Person (siehe
[`LAIENTEST.md`](LAIENTEST.md)).

---

## Entwicklung starten

```bash
docker start gbs-campus-db-dev || docker run -d --name gbs-campus-db-dev -e POSTGRES_DB=gbs_campus -e POSTGRES_USER=gbs -e POSTGRES_PASSWORD=gbs_dev_2026 -p 5434:5432 postgres:16-alpine
```

```bash
cd gbs-campus && export DATABASE_URL="postgresql://gbs:gbs_dev_2026@localhost:5434/gbs_campus?schema=public" && export ENCRYPTION_KEY="$(openssl rand -hex 32)" && export SESSION_SECRET="$(openssl rand -hex 32)" && export APP_URL="http://localhost:3000" && npm run dev
```

Port 5434 ist bewusst gewählt — 5433 ist anderweitig belegt.

`DATABASE_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY` und `APP_URL` sind Pflicht; fehlt eine, startet der Server
nicht (`[START] Die Konfiguration ist unvollständig`). Das Portal im Browser **genau unter der Adresse aus
`APP_URL`** öffnen — hier also `http://localhost:3000`, nicht `127.0.0.1:3000` —, sonst weist die
Herkunftsprüfung jede Änderung mit 403 ab.

Für einen dauerhaften Entwicklungsstand die `.env.example` nach `.env` kopieren und ausfüllen; ein
frisch erzeugter `ENCRYPTION_KEY` macht bereits verschlüsselte Felder unlesbar.

| Befehl | Wirkung |
|---|---|
| `npm run dev` | Entwicklungsserver auf Port 3000 |
| `npm run build` | Produktionsbuild (Standalone) |
| `npm run typecheck` | TypeScript ohne Emit prüfen |
| `npm run db:migrate` | Migration erzeugen und einspielen |
| `npm run db:deploy` | Migrationen einspielen (Produktion) |
| `npm run db:seed` | Grunddaten setzen — idempotent, mehrfach ausführbar. Semester nur bei leerer Tabelle, Einwilligungstexte nur anlegen (bei Abweichung WARNUNG; bei einer neuen Fassung setzt er `aktivBis` der älteren), Statusschalter, Rechte, Vorlagen und Kursraster werden nachgezogen |
| `npm run db:studio` | Prisma Studio |
| `npm run pruefen` | **1341 Prüfungen in 20 DB-freien Skripten** (Stand 27.09.2026, spät): startet `scripts/pruefe-alle.ts`, jedes Skript in eigenem Prozess mit `TZ=Europe/Berlin`, am Ende Zusammenfassung und Gesamtsumme, Exit 1 bei einem roten Skript. Ein nicht eingetragenes `scripts/pruefe-*.ts` macht den Lauf rot. Läuft auch im Docker-Build vor `next build` und in der CI |
| `npm test` | dasselbe wie `npm run pruefen` |
| `bash scripts/durchstich.sh` | **850 Prüfungen** gegen das gebaute Image und eine frische Datenbank, kalenderunabhängig (braucht Docker) |
| `npm run pruefen:db` | 19 + 18 Prüfungen (Einstellungen + Auskunft-Roundtrip inkl. Verstorbenen-Sperre), **braucht** eine örtliche Datenbank |

Die Soll-Zahlen je Skript stehen in [`UEBERGABE.md`](UEBERGABE.md) unter „Prüfzahlen“; jedes Skript prüft
seine eigene (`ERWARTET`), der Durchstich `SOLL` am Skriptende. Neue Prüfskripte in `scripts/pruefe-alle.ts`
eintragen. Die CI (`.github/workflows/pruefen.yml`) führt `npm ci`, `prisma generate`, `tsc --noEmit` und
`npm run pruefen` bei jedem Push aus; der Job „Typpruefung und Pruefskripte“ ist in GitHub noch als
Pflicht-Check für `main` einzutragen (Branch-Schutz).

> Die Typprüfung und der Build hängen auf diesem Rechner regelmäßig, weil Synology Drive und iCloud
> den Projektordner samt `node_modules` synchronisieren. Im Zweifel über den Docker-Build verifizieren.
> Einzelheiten in [`UEBERGABE.md`](UEBERGABE.md).

---

## Produktivbetrieb

```bash
cp .env.example .env && docker compose up -d --build
```

Der Stack besteht aus **traefik** (TLS, Let's Encrypt), **app** (Next.js Standalone), **worker**
(zeitgesteuerte Läufe), **db** (PostgreSQL 16) und **backup** (nächtlicher Dump). Zwei Netze: `edge` mit
Internetzugang — fest benannt **`gbs_edge`** —, `data` mit `internal: true`: Die Datenbank hat weder
Internetzugang noch einen Port nach außen. Traefik ist über `--providers.docker.network=gbs_edge` und das
Label `traefik.docker.network` an `app` auf `gbs_edge` festgelegt; ohne das nahm es je nach Neustart die IP
aus `data`, und alle Anfragen liefen in einen 504 (Code-Review 4, M1).

**Die Sicherheits-Header** (HSTS, `frameDeny`, `nosniff`, Referrer-Policy `strict-origin-when-cross-origin`)
kommen aus dem Traefik-Datei-Provider: **`docker/traefik-dynamisch.yml` gehört auf den Server neben
`docker-compose.yml`** (Middleware `gbs-sicherheit@file`). Der traefik-Container hat keine Labels mehr, es
entsteht kein Default-Router. Die Referrer-Policy darf nie `no-referrer` lauten, sonst scheitert die
Herkunftsprüfung.

**Erster Deploy nach Code-Review 4:** `docker compose up -d --force-recreate` (Compose legt `gbs_edge` neu an),
danach das verwaiste alte Netz entfernen (`docker network rm gbs-campus_edge`). Vor dem Livegang auf Staging:
`docker compose config` ohne Fehler, den Stack fünfmal neu starten, `/api/health` über Traefik darf nie
502/504 liefern, das Traefik-Log muss sauber sein.

Die Anwendung läuft unter **`gbs.fes-credo.de`** (in `.env.example` eingetragen).

**Vor dem ersten Start noch auszufüllen:** `ACME_EMAIL`, `DB_PASSWORD`, `SESSION_SECRET`,
`ENCRYPTION_KEY` sowie die SMTP-Zugangsdaten samt Absenderadresse, dazu `DMS_EMAIL` (sonst warnt der Start,
und Belege bleiben als „noch nicht im DMS“ stehen). Ohne korrekte `APP_URL` erzeugt die Anwendung Magic-Links
auf `localhost` — und da der Magic-Link der einzige Kontoschlüssel ist, kommt dann niemand mehr hinein.
**`APP_URL` muss exakt die Adresse sein, unter der Browser das Portal öffnen** (Schema, Host, Port), sonst
lehnt die Herkunftsprüfung jede Änderung mit 403 ab (Log `[HERKUNFT] … fremder-origin`). Der Startprüfer lehnt
eine `APP_URL` ab, aus der sich keine Herkunft ergibt, und in Produktion mit gesetztem `APP_DOMAIN` auch eine
ohne `https://` oder mit anderem Host als `APP_DOMAIN` (Log `[START] … APP_URL: passt nicht zu APP_DOMAIN …`,
der Container startet nicht).

**Datenbank-Passwörter nur aus Buchstaben und Ziffern** (`openssl rand -hex 24`): docker-compose setzt sie
unkodiert in Verbindungs-URLs ein. Für den rechtebeschränkten Anwendungsnutzer `gbs_app` (optional, empfohlen)
`APP_DB_PASSWORD` setzen — mindestens 16 Zeichen, sonst bricht der Start ab. Nur mit gesetztem Passwort
schaltet der Entrypoint nach Migration und Seed auf `gbs_app` um und entfernt `DB_PASSWORD` aus dem
Serverprozess; der Worker bleibt Eigentümer. Einzelheiten und die bekannte Grenze (Config.Env) in
[`UEBERGABE.md`](UEBERGABE.md).

**SPF, DKIM und DMARC gelten für die Absenderdomain**, also für die Domain hinter
`MAIL_ABSENDER_ADRESSE`. Die muss nicht mit `APP_DOMAIN` übereinstimmen. Vor dem Livegang gegen GMX,
web.de, Gmail und Outlook prüfen, ob der Magic-Link im Posteingang landet und nicht im Spam.

### Bewusste Abweichungen von der Planungsskizze

- **Kein Redis.** Magic-Links sind über die Spalte `benutztAm` in Postgres single-use, Rate-Limiting
  läuft über die Tabelle `rate_limit`. Bei 150 Konten reicht das und spart einen Container im
  Notfall-Runbook.
- **Kein Worker-Container in Release 0.1.** Es gab damals noch keine zeitgesteuerten Aufgaben. Seit
  Release 0.2 gibt es ihn (Dienst `worker`, siehe oben).

---

## Was im Fundament steckt

### Statusmaschine als Tabelle, nicht als Enum

`teilnehmer_status` trägt pro Zustand fünf Schalter: `istAktiv`, `istTerminal`, `beitragLaeuft`,
`anwesenheitZaehlt`, `automatikMails`. Jede Automatik fragt diese Schalter ab, statt Status-Codes
im Code aufzuzählen. `VERSTORBEN` hat alle Automatik-Schalter auf `false` — ein harter Not-Aus, damit
keine Mahnung und keine Erinnerung Hinterbliebene erreicht. Neue Zustände lassen sich ohne Deploy
ergänzen. (Ehrliche Grenze: `anwesenheitZaehlt` und `beitragLaeuft` liest heute kein Code; Anwesenheit und
Quote filtern auf `istAktiv` — offene Entscheidung ARCH-status-schalter-tot.)

**Seit Code-Review 4 ist die Statusmaschine bedienbar.** Einziger Schreibweg ist `wechsleStatus()` in
`src/lib/status-io.ts` (bedingtes Update + `StatusWechsel`-Zeile + Audit in einer Transaktion; neu angelegte
Personen über `erfasseErstenStatus`); `scripts/pruefe-benutzerverwaltung.ts` wird rot, sobald
`statusWechsel.create` woanders steht. Die Regeln stehen DB-frei in `src/lib/status.ts`: aus einem Endzustand
führt kein Weg zurück (409, einzige Ausnahme ist die Anonymisierung), ANONYMISIERT und INTERESSENT sind keine
wählbaren Ziele, ABGEBROCHEN, AUSGESCHLOSSEN und VERSTORBEN verlangen einen Grund — ebenso das Verlassen von
ABGEBROCHEN (Wiederaufnahme). Ins Audit kommt nur, *ob* ein Grund angegeben wurde. **Endzustände sind
AUSGESCHLOSSEN, VERSTORBEN und ANONYMISIERT.**
**ABSOLVENT ist kein Endzustand** (Fachentscheidung 27.09.2026): `istAktiv = false`, `automatikMails = false`,
der Portalzugang bleibt — sonst kämen Absolventen nicht an ihr Abschlusszeugnis. Empfohlen: erst das
Abschlusszeugnis ausstellen, dann den Status setzen. **ABGEBROCHEN ist seit dem 27.09.2026 abends ebenfalls kein
Endzustand** (Empfehlung Semesterbetrieb): dieselben Schalter wie ABSOLVENT, der Zugang bleibt, und die
Schulleitung nimmt die Person mit Grund wieder auf (Status zurück auf AKTIV, danach bei Bedarf unter „Aktive
dieses Semester“ übernehmen). Wer auf ABSOLVENT, ABGEBROCHEN oder BEURLAUBT steht, fällt aus allen
Semesterlisten. Das letzte Administratorkonto (gezählt werden nur Administratoren ohne Endzustand) lässt sich
weder per Status noch per Anonymisierung noch per Rollenentzug aussperren (409).

### Rechtematrix als Daten

`rollen`, `rechte` und `rolle_recht` liegen in der Datenbank. Sechs Rollen und — Stand 27.09.2026 — 27
Rechte. Die Codes stehen zusätzlich in `src/lib/constants.ts` (`RECHT`), und der Seed legt die Rechte genau
daraus an — ein Tippfehler in einem Recht-String erzeugt sonst keinen Compile-Fehler, sondern lautlosen
Rechteentzug. Seit Code-Review 4 nehmen `pruefeZugriff`, `ladeMitRecht` und `hatRecht` nur noch den Typ
`RechtCode`. Bewusst getrennt: `FINANZ_DATEN_LESEN` (Beitragsstatus) und
`BANKVERBINDUNG_LESEN` (IBAN) — der Schulleiter sieht den Status, die IBAN sieht nur die Verwaltung.

Vier Rechte tragen in der Bezeichnung „(noch ohne Funktion)“, weil keine Route sie prüft:
`MAIL_VERTEILER_SENDEN`, `MAIL_VORLAGEN_BEARBEITEN`, `FINANZ_DATEN_LESEN`, `IMPERSONATION`. Eine Prüfung
erzwingt, die Kennzeichnung zu entfernen, sobald eine Prüfstelle entsteht.

Die Rollen `DOZENT` und `GASTDOZENT` waren über `aktivAbRelease = "0.2"` markiert; `DOZENT` ist seit 0.2/0.3
in Gebrauch, `GASTDOZENT` hat bewusst keine Rechte.

Die Rechtematrix, Statusschalter, Mailvorlagen und das Kursraster zieht der Seed bei jedem Start nach — sie
sind heute Code-Konfiguration, auch wo Kommentare Änderbarkeit versprechen (offene Entscheidung
ARCH-seed-ueberschreibt-konfiguration). Semester und Einwilligungstexte legt der Seed dagegen nur an.

### Audit-Log wirklich append-only

Nicht per Konvention, sondern per Datenbank-Trigger: `UPDATE` und `DELETE` auf `audit_log` scheitern
mit einer Fehlermeldung — auch aus der Anwendung heraus, auch für den Administrator. Dasselbe gilt
für `einwilligungen`, denn ein nachträglich änderbares Consent-Protokoll ist als Nachweis nach
DSGVO Art. 7 Abs. 1 wertlos. Ein Widerruf ist eine neue Zeile mit `erteilt = false`.

Ehrliche Grenze: Der Append-only-Schutz ist nur so stark wie die Trennung der Datenbankrechte. Seit dem
29.07. gibt es dafür den getrennten, rechtebeschränkten Datenbanknutzer `gbs_app` (opt-in über
`APP_DB_PASSWORD`, siehe „Produktivbetrieb“), dem UPDATE, DELETE und TRUNCATE auf diesen Tabellen entzogen
sind.

**Seit Code-Review 4 gilt dasselbe für weitere Nachweisdaten:**

- **Einwilligungstexte** (`einwilligungs_texte`, Migration `20260927100000`, drei Trigger): Nur `aktivBis`
  ist änderbar, kein DELETE/TRUNCATE; `gbs_app` hat dort weder UPDATE noch DELETE noch TRUNCATE. Ein
  geänderter Text ist eine **neue Fassung mit `version + 1`** — sonst änderte sich rückwirkend der Text aller
  erteilten Einwilligungen. Der Seed legt Fassungen nur an und warnt bei Abweichung.
- **Belege** (Migration `20260927160000_belege_unveraenderlich`, 14 Trigger): Honorarsätze (nur Beleg-Nr und
  DMS-Datum nachtragen, kein DELETE), Honorarabrechnungen (Status nur vorwärts, Beleg-/Freigabe-/Auszahlungs-/
  DMS-Felder einmalig, DELETE nur bei OFFEN), Abrechnungsposten (INSERT nur zu OFFENEN Abrechnungen, kein
  UPDATE, Summe der Abrechnung = Summe der Posten beim Commit) und Zeugnisse (nur GUELTIG → ERSETZT oder
  GUELTIG → STORNIERT mit Zeitpunkt und Grund, DMS-Datum einmalig, Scrub durch die Anonymisierung; Migration
  `20260928100000_zeugnis_storno`). TRUNCATE überall gesperrt. Neue Spalten oder
  Schreibwege an diesen Tabellen brauchen eine Migration mit angepasster Trigger-Funktion.
- **Leistungen** hängen mit `ON DELETE RESTRICT` an ihrer Kurseinheit (Migration `20260927160500`);
  Kurseinheiten werden nur deaktiviert, nie gelöscht.

**Ins Audit gehören nur Feldnamen, keine Personenwerte** (Hausregel seit 27.09.2026): Das Log ist unlöschbar,
die Anonymisierung erreicht es nicht. `geaenderteFeldnamen()` in `src/lib/anonymisierung.ts` liefert die Namen
der geänderten Felder; Statuscodes, Rollen und Zähler dürfen mit alt/neu hinein, Namen, Adressen und
Freitexte nicht. `scripts/pruefe-anonymisierung.ts` prüft die betroffenen Dateien (`AUDIT_DATEIEN`).

### Formular-Builder: Versionierung ist der Kern

Der Schulleiter gestaltet das Anmeldeformular selbst — Abschnitte, Fragen, Feldtypen, Pflichtangaben.
Zwei Regeln machen das tragfähig:

**Eine veröffentlichte Fassung ist unveränderlich.** Wer sie bearbeiten will, bekommt automatisch eine
Kopie als neuen Entwurf; die alte Fassung wird beim Veröffentlichen archiviert, nicht gelöscht. Jede
Anmeldung verweist fest auf die Fassung, gegen die sie ausgefüllt wurde. Ohne das wäre Jahre später
nicht mehr feststellbar, welche Frage jemand tatsächlich beantwortet hat — und das Consent-Protokoll
hätte keine Grundlage.

**Antworten fließen über eine Feldzuordnung in die Akte.** Jedes Feld kann einem Aktenfeld zugeordnet
werden (Vorname, E-Mail, IBAN, Teilnahmeform …). Zwei Felder dürfen nicht auf dasselbe Aktenfeld
zeigen, und der Feldtyp muss passen — sonst überschrieben sich zwei Antworten, und welche gewinnt,
wäre reine Reihenfolge.

Ein Feld lässt sich als **besonders geschützt nach Art. 9 DSGVO** kennzeichnen (Fragen zu Glaube und
Gemeindezugehörigkeit). Fehlt die getrennte Einwilligung, wird die Antwort **verworfen statt
gespeichert** — auch dann, wenn der Browser einen Wert mitschickt. Das ist serverseitig geprüft, nicht
nur ausgeblendet. Gespeichert werden Art.-9-Antworten nur, wenn **alle** aktiven Art.-9-Einwilligungstexte
erteilt sind — dieselbe Regel, nach der das Formular die Abschnitte freischaltet (`art9Eingewilligt` in
`src/lib/anmeldung-antworten.ts`). **Das Aktenfeld Gemeinde ist immer Art. 9:** Im Builder wird das Häkchen
„Besonders geschützt“ gesetzt und gesperrt, der Server prüft es beim Speichern und beim Veröffentlichen, und
zur Laufzeit gilt die Gemeinde auch in älteren Fassungen ohne Häkchen als Art. 9 (`ART9_AKTENFELDER`).

Bedienung ohne Ziehen und Fallenlassen: Verschieben läuft über Pfeiltasten. Das ist mit Tastatur und
Vorlesesoftware bedienbar (WCAG 2.1 AA) und funktioniert auf dem Tablet.

**Seit Code-Review 4 (M15–M17):** Schlüssel und Element-IDs laufen über eine clientseitige `uid`, nicht mehr
über Abschnittstitel oder Feldschlüssel — vorher verlor das Feld nach jedem Tastendruck den Fokus. Die
Abschnittsköpfe sind beschriftet, der Löschknopf hat einen Namen für Vorlesesoftware. Antwortmöglichkeiten
werden erst beim Verlassen des Felds bereinigt (Rand-Leerzeichen und Leerzeilen weg), sodass Enter und
Leerzeichen beim Tippen bleiben. Die Schüler/Hörer-Zuordnung wird beim Laden aus der gespeicherten Fassung
übernommen (`alsBuilderAbschnitte` in `src/lib/formular.ts`); eine **umbenannte Antwort muss neu zugeordnet
werden** (bewusst keine Heuristik, an der Zuordnung hängen Prüfungspflicht und Zeugnis). Die PUT-Route bereinigt
Antworten und Zuordnung selbst; das Veröffentlichen prüft zusätzlich die Felddefinition und nennt Mängel mit
Feldschlüssel. Die gemeinsame, DB-freie Logik von Builder (Client) und `scripts/pruefe-formularlogik.ts` liegt
in `src/lib/formular-optionen.ts` — getrennt von `formular.ts` wegen dessen Prisma-Import, nach demselben
Muster wie `pruefwerte.ts`.

### Die öffentliche Anmeldung

`/anmeldung` ist die einzige Seite ohne Login — sie ersetzt Microsoft Forms. Vier Entscheidungen
stecken darin, die man der Oberfläche nicht ansieht:

**Die Art.-9-Fragen erscheinen erst nach der Zustimmung.** Ein Abschnitt, in dem ausschließlich Fragen
zu Glaube und Gemeinde stehen, bleibt ausgeblendet, solange die getrennte Einwilligung fehlt. Ohne sie
würde die Antwort ohnehin serverseitig verworfen — dann ist es ehrlicher, sie gar nicht erst
abzufragen. Fehlt eine *Pflicht*-Einwilligung, wird das Absenden mit Begründung abgelehnt, statt die
betroffenen Antworten stillschweigend fallenzulassen.

**Eine bekannte Adresse führt zu nichts.** Existiert die E-Mail-Adresse bereits, wird nichts angelegt
und **nichts überschrieben**. Sonst ließen sich über ein öffentliches Formular fremde Stammdaten
ändern. Die Antwort nach außen bleibt dieselbe wie bei einer erfolgreichen Anmeldung: Eine Auskunft
darüber, welche Adresse bekannt ist, würde bestätigen, wer eine Bibelschule besucht — selbst eine
Angabe nach Art. 9. Den Hinweis bekommen nur die Adresse selbst und die Verwaltung.

**Alles oder nichts.** Person, Anmeldung, Einwilligungen und der erste Statuswechsel entstehen in
einer Transaktion. Eine halb angelegte Akte ohne Einwilligungsnachweis wäre schlimmer als gar keine.

**Später weitermachen.** Der Fortsetzen-Link wird beim Zwischenspeichern in die Adresszeile
geschrieben (ohne Neuladen), gespeichert wird nur sein SHA-256-Hash. Mit dem Absenden verfällt er. Seit
Code-Review 4 steht der Token im Fragment (`/anmeldung#fortsetzen=<token>`), das Formular lädt den
Zwischenstand per `POST /api/anmeldung {aktion:"laden"}`; alte `?fortsetzen=`-Links werden beim ersten
Aufruf ins Fragment umgeschrieben (dieser eine Aufruf steht noch im Zugriffslog). `ANMELDUNG_MAX_PRO_IP` gilt
je Aktion (speichern, absenden, laden) als eigenes Kontingent. Die Oberfläche nennt vor dem Zwischenspeichern,
was **nicht** gespeichert wird (die Titel der Art.-9-Abschnitte und die IBAN), zeigt den Link mit
Kopier-Knopf und sagt beim Fortsetzen, dass die Zustimmungen neu zu setzen sind. Beim Verlassen mit
ungesicherten Eingaben warnt der Browser; Art.-9-Freitexte und IBAN gelten dabei immer als ungesichert.

**Fangfeld gegen Roboter.** Das Formular hat ein für Menschen unsichtbares Feld `hp_feld`. Ist es gefüllt,
antwortet der Server wie bei Erfolg, legt aber keine Akte an und schickt keine Mail; das Audit schreibt
`ANMELDUNG_VERWORFEN_FANGFELD` ohne Werte. Das Feld hieß anfangs `website` — das füllten Passwortmanager aus.
Jeder Eintrag im Protokoll ist ein Roboter oder eine still verworfene echte Anmeldung; die Verwaltung sollte
ihn beobachten.

**Schutz vor Massenanmeldungen (27.09.2026, Entscheidung E-23).** Jede Einreichung legt eine nicht löschbare Akte
an und schreibt an die eingegebene Adresse. Zu Drossel je Anschluss und Fangfeld kommen deshalb drei Schichten
(`src/lib/anmelde-schutz.ts`, DB-Teil in `anmelde-schutz-io.ts`, Prüfskript `pruefe-anmelde-schutz.ts`):
eine **Mindestdauer** — die Seite liefert einen mit `SESSION_SECRET` signierten Zeitstempel aus, wer schneller
absendet als `ANMELDUNG_MINDESTDAUER_SEKUNDEN` (3, 0 = aus), bekommt eine sichtbare Meldung —; eine
**Gesamtgrenze** über alle Anschlüsse (`ANMELDUNG_MAX_GESAMT_STUNDE` 10, `ANMELDUNG_MAX_GESAMT_TAG` 30), gezählt
werden nur angenommene Einreichungen (ein reservierter Platz wird bei einem Pflichtfeld-Fehler wieder frei),
Zwischenstände dürfen das Dreifache und zählen über neu angelegte Anmeldezeilen; und eine **Warnung** an
Schulleitung und Verwaltung (Vorlage `ANMELDUNG_GEDROSSELT`), höchstens einmal pro Stunde. Die Betriebsansicht
zeigt die angenommenen Anmeldungen gegen die Grenzen und die Abweisungen der letzten 24 Stunden je Schicht.

**Barrierefreiheit.** Pflichtangaben sind für Vorlesesoftware als „(Pflichtangabe)“ markiert, auch bei
Auswahlgruppen. Die Art.-9-Einwilligung steht zusätzlich im Platzhalter der verborgenen Abschnitte; beim
Freischalten gibt es eine Live-Ansage, und der Fokus springt dorthin. Die IBAN-Bestätigung steht in Textfarbe
auf grüner Tönung (ausreichender Kontrast).

Die Absage bei einer Ablehnung verschickt das System **nicht** automatisch — sie hält nur den internen
Grund fest. Eine Absage an jemanden, der sich für eine Bibelschule beworben hat, formuliert der
Schulleiter selbst; das war die ausdrückliche Linie im Interview.

**Vor der Entscheidung die Bewerbung lesen** (seit Code-Review 4, M13): `/verwaltung/anmeldungen/[id]`
(„Antworten ansehen“) zeigt die Antworten nach den Abschnitten der verwendeten Formularfassung, mit den
damaligen Beschriftungen, darunter die Entscheidung und — mit `PERSON_LESEN_ALLE` — „Akte öffnen“. Rechte:
Die Seite braucht `ANMELDUNG_LESEN`. Die Schulleitung sieht alle Antworten, Art.-9-Antworten aber nur mit
`ANMELDUNG_ENTSCHEIDEN` **und** wirksamer Einwilligung (jüngste Einwilligungszeile, Gleichstand gilt als nicht
erteilt); die Verwaltung sieht alle Nicht-Art.-9-Antworten; der Administrator hat keinen Zugriff. Antworten zu
unbekannten Codes werden wie Art. 9 behandelt, und ausgeblendete Art.-9-Abschnitte zählen als Fragen, nicht als
Antworten. Die IBAN steht nie in der Ansicht, die Bankverbindung erscheint als „hinterlegt“. Jeder Abruf
schreibt `ANMELDUNG_ANTWORTEN_ANGESEHEN` (nur `personId` und `art9Angezeigt`). Nach Aufnehmen oder Ablehnen
bleibt die Meldung stehen, bis „Ansicht aktualisieren“ geklickt wird. Anmeldungen anonymisierter Personen
stehen nicht mehr in der Arbeitsliste, und eine Entscheidung über sie wird mit 409 abgewiesen.

### Einstellungen: keine Fristen im Code

Unter `/verwaltung/einstellungen` lassen sich die Werte ändern, die der Betrieb kennen muss, ohne dass
jemand ein Deployment anstoßen muss — allen voran die **Gültigkeit des Anmeldelinks**, dazu die
Drosselschwellen und die Sitzungsdauer. Änderungen greifen sofort, ohne Neustart, und stehen mit Alt-
und Neuwert im Audit-Log.

Zwei Dinge sind daran wichtiger als das Formular:

**Die Grenzen stehen im Code, nicht nur in der Oberfläche.** Ein Anmeldelink, der ein Jahr gilt, ist
kein Anmeldelink mehr, sondern ein dauerhafter Generalschlüssel im Postfach. Deshalb prüft
`setzeZahl()` gegen fest hinterlegte Minima und Maxima (bei der Link-Gültigkeit 5 Minuten bis
24 Stunden) — auch über die API lässt sich nichts darüber hinaus setzen, und unbekannte Schlüssel
werden abgewiesen, statt neue Zeilen anzulegen.

**Eine kaputte Einstellung legt nichts lahm.** Fehlt die Zeile, ist der Wert unlesbar oder liegt er
außerhalb der Grenzen, greift der im Code hinterlegte Rückfallwert und es geht eine Warnung ins Log.
Die Alternative wäre, dass ein Tippfehler im Verwaltungsbereich die Anmeldung aller Teilnehmer
blockiert.

Der Seed zieht Beschriftung, Grenzen und Einheit bei jedem Start nach, **überschreibt aber nie den
eingestellten Wert** — was der Betrieb gesetzt hat, darf ein Deployment nicht zurückdrehen.

### Ermäßigungen: kein Prozentsatz im Code

Es gibt einen Ehepartner-Rabatt von 50 %. Der steht als Zeile in der Tabelle `ermaessigungen`, nicht
als Konstante im Quelltext — ein Satz im Code ließe sich nur mit einem Deploy ändern, und über die
Jahre kommen weitere Fälle dazu (Geschwister, Härtefall, Gemeinde als Zahler). Die Person trägt einen
optionalen Verweis auf eine Ermäßigung und eine **auflösbare** Ehepaar-Kopplung: Ehen enden, und dann
darf die Software nicht weiter von einem Paar ausgehen.

Die Datenbank verhindert per `CHECK`-Constraint, dass sich jemand selbst als Ehepartner einträgt —
das würde im Beitragslauf ab Release 0.3 einen Nachlass erzeugen, dem kein zweiter Beitrag
gegenübersteht. Die Wechselseitigkeit (A zeigt auf B *und* B auf A) setzt die Anwendung in einer
Transaktion; ohne rekursionsanfälligen Trigger lässt sie sich in der Datenbank nicht sinnvoll
erzwingen.

Der Beitragslauf selbst kommt mit Release 0.3. Hier steht nur die Grundlage, damit später nichts
nachträglich umgebaut werden muss. Bis dahin beschreiben die Beitragseinstellungen unter
`/verwaltung/einstellungen` ihren Stand ehrlich mit „Wird derzeit nicht eingezogen.“ (seit 27.09.2026; der
Seed zieht die Beschreibung beim nächsten Container-Start nach).

### Semester, Teilnehmerliste und Excel-Export

Genau ein Semester ist das laufende — abgesichert durch einen **partiellen Unique-Index**
(`semester_genau_ein_aktuelles`), nicht durch eine Regel in der Anwendung. Das Umschalten setzt
deshalb erst alle zurück und dann eines, beides in einer Transaktion; wer gleichzeitig umschaltet,
bekommt einen `409` statt zwei laufender Semester.

**Die Anmeldung trägt jetzt ihr Semester.** Vorher ließ sich nur über `eingereichtAm` erraten, für
welchen Jahrgang sich jemand beworben hat. Zugeordnet wird beim Einreichen: erst ein Semester mit
offenem Anmeldefenster, sonst das laufende. Der Umweg über das Fenster ist kein Zierrat — wer sich im
Juli für den Jahrgang ab September anmeldet, meint nicht das Semester, das gerade läuft. Die
Entscheidung selbst steht in `src/lib/semester.ts` und ist dort ohne Datenbank nachprüfbar.

Die Teilnahme entsteht bei der Aufnahme durch die Schulleitung, in derselben Transaktion wie der
Statuswechsel. Fehlt das Semester oder die Teilnahmeform, entsteht **keine** Teilnahme und der
Bildschirm sagt es ausdrücklich — geraten wird nicht, denn an der Teilnahmeform hängen
Prüfungspflicht, Zeugnis und ab Release 0.3 der Beitrag. Für alle, die schon vor dem Anlegen des
Semesters aufgenommen wurden, gibt es unter „Aktive dieses Semester" einen Hinweis mit
Sammelübernahme; gezählt werden dabei nur Personen mit der Rolle `TEILNEHMER`, sonst stünde auch die
Schulleitung in dieser Zahl.

**In der Excel-Datei steht keine Bankverbindung.** Die Spalten kommen aus `EXPORT_SPALTEN` in
`src/lib/semester.ts`, und dort fehlt die IBAN mit Absicht: Eine Exportdatei verlässt das System und
liegt danach unverschlüsselt auf Notebooks und in Mailanhängen — die Verschlüsselung in der Datenbank
wäre damit wirkungslos. Jeder Export steht im Audit-Log, weil an dieser Stelle personenbezogene Daten
die Anwendung verlassen. **Die Gemeindezugehörigkeit bleibt dagegen im Export und in der Oberfläche** —
Fachentscheidung vom 27.09.2026 nach Abwägung (Art.-9-Angabe gegen den Nutzen für die Schule); Befunde dazu
gelten als bewusst.

**Seit Code-Review 4 zählt eine abgemeldete Teilnahme nirgends mehr** (siehe Semesterüberleitung oben):
Teilnehmerliste und Excel, Anwesenheit, Quote, Notenerfassung, Zeugnislauf und die Kennzahlen filtern mit
`TEILNAHME_ZAEHLT` aus `src/lib/teilnahme-filter.ts`. Wer eine neue Abfrage auf die Teilnahmen eines Semesters
schreibt, mischt diesen Filter ein. Die Sammelübernahme legt eine im selben Semester abgemeldete Teilnahme
bewusst nicht neu an. Seit dem 27.09.2026 (spät) lässt sie auch Personen aus, deren jüngste Teilnahme vor dem
Zielsemester abgemeldet ist („Ich bin raus“ oder keine Rückmeldung); sie stehen auf der Teilnehmerseite unter
„Zuletzt abgemeldet“ und werden einzeln übernommen (`POST /api/semester/[id]/teilnehmer` mit `{ personId }`).

Semester lassen sich unter `/verwaltung/semester` samt **Lehrjahr und Halbjahr** (Verortung im Kursraster)
pflegen; das **Kürzel ist nach dem Anlegen fest** (PUT mit anderem Kürzel → 400), weil es in Audit-Einträgen
und im Namen der Excel-Datei steht. Der Seed überschreibt Semester nie (M3).

Semesterdaten sind **Kalendertage, keine Zeitpunkte**. Sie werden durchgängig in UTC gerechnet, der
„heutige Tag" dagegen aus der örtlichen Zeit gebildet (der Container läuft auf Europe/Berlin). Sonst
wäre ein Anmeldeschluss am 14.09. je nach Rechnerzeitzone schon am 13.09. abends vorbei — und ein
Anmeldeschluss um 23:30 des Stichtags gilt noch.

### Selbstpflege: warum die E-Mail-Adresse einen Umweg nimmt

Adresse, Telefonnummer und Bankverbindung ändert der Teilnehmer unter `/meine-daten` selbst, sofort
wirksam. Die E-Mail-Adresse nicht: **Sie ist der einzige Kontoschlüssel.** Es gibt kein Passwort, und
in Release 0.1 auch keine Oberfläche, mit der die Verwaltung eine vertippte Adresse korrigieren
könnte — eine sofort wirksame Änderung würde bei einem Tippfehler das Konto dauerhaft aussperren.

Der Weg ist deshalb: Antrag → Bestätigungslink an die **neue** Adresse → erst dieser Klick setzt sie.
Parallel geht ein Hinweis an die **bisherige** Adresse. Das ist die Notbremse: Wer ihn bekommt, ohne
etwas geändert zu haben, weiß, dass jemand an seinem Konto war — und bis zur Bestätigung gilt
weiterhin alles wie bisher. Eingelöst wird per POST von einer Bestätigungsseite, aus demselben Grund
wie beim Anmeldelink (Link-Scanner in Mail-Sicherheitslösungen).

Ist die gewünschte Adresse bereits vergeben, lautet die Antwort trotzdem „Bestätigungslink
verschickt". Alles andere wäre eine Auskunft darüber, wer die Bibelschule besucht, und das ist eine
Angabe zur Religionszugehörigkeit (Art. 9 DSGVO). Statt eines Links geht in dem Fall ein Hinweis an
die Verwaltung — dasselbe Muster wie bei der doppelten Anmeldung.

**Das IBAN-Feld ist immer leer, und leer heißt „unverändert".** Die hinterlegte Bankverbindung wird
nie im Klartext angezeigt; würde ein leeres Feld als „löschen" gelten, hätte jede gespeicherte
Adressänderung nebenbei den Beitragseinzug lahmgelegt. Seit Code-Review 4 geht bei jeder Änderung von IBAN
oder Kontoinhaber die Hinweis-Mail `BANKVERBINDUNG_GEAENDERT` an die hinterlegte Adresse (mit dem Rat, ein
neues Passwort zu setzen, damit fremde Sitzungen enden) — die Honorar-Freigabe weist auf genau diese
Bankverbindung an.

Der Bestätigungslink einer E-Mail-Änderung trägt seinen Token im Fragment (`/meine-daten/email#token=…`).
Wird die neue Adresse bestätigt, verfallen offene Anmelde- und Auskunftslinks der alten Adresse; dasselbe gilt,
wenn die Verwaltung die Anmeldeadresse ändert (Audit `entwerteteAnmeldelinks` bzw. `entwerteteAuskunftslinks`).

Nicht selbst änderbar sind Name, Geburtsdatum, Gemeinde, Teilnahmeform und Status. An ihnen hängt die
Aufnahmeentscheidung, und die Gemeindezugehörigkeit ist eine Art.-9-Angabe — beides gehört nicht in
ein Formular, das man im Vorbeigehen abschickt.

### Zwei Wege hinein — und was passiert, wenn einer verloren geht

**Der Anmeldelink** ist der Regelfall: E-Mail-Adresse eintragen, Link anfordern, fertig. Er ist jedes
Mal neu und nur einmal verwendbar.

**Das Passwort** ist der freiwillige zweite Weg (`/anmelden/passwort`). Es existiert aus genau einem
Grund: Der Anmeldelink hängt am Postfach. Wer den Zugriff darauf verliert, käme ohne Passwort nicht
mehr hinein. Mit Passwort meldet er sich an und trägt selbst eine neue Adresse ein — ohne dass jemand
helfen muss.

Damit deckt sich jeder **einzelne** Verlust selbst ab:

| Verloren | Weg zurück |
|---|---|
| Passwort vergessen | Anmeldelink anfordern, im Portal ein neues Passwort setzen |
| Postfach nicht erreichbar | Mit Passwort anmelden, unter „Meine Daten" die Adresse ändern |
| Beides zugleich | Meldung über `/anmelden/hilfe` — hier muss ein Mensch erkennen, wer da schreibt |

**Es gibt bewusst kein eigenes Zurücksetzen-Verfahren.** Der Anmeldelink *ist* der Weg zurück: Wer
ihn anfordert, kommt hinein und setzt im Portal ein neues Passwort. Ein zweiter Token-Typ mit eigener
Tabelle, eigener Frist und eigenem Missbrauchsweg wäre reine Verdopplung.

Zum Passwort selbst: **scrypt aus Node**, nicht bcrypt oder Argon2 — beide brauchen eine native
Abhängigkeit, die im Image mit `npm ci --ignore-scripts` gar nicht gebaut würde. Verglichen wird in
konstanter Zeit; bei einer unbekannten Adresse rechnet der Server trotzdem, sonst verriete die
Antwortzeit, wer ein Konto hat. Alle Ablehnungen — unbekannte Adresse, kein Passwort gesetzt, falsches
Passwort — nennen denselben Satz. Regeln über Sonderzeichen gibt es keine, nur eine Mindestlänge
(einstellbar, 10 Zeichen): Zeichensalat-Regeln erzeugen „Passwort1!" und Zettel am Bildschirm. Beim
Setzen wird das bisherige Passwort **nicht** abgefragt — genau der Vergessensfall führt dorthin; die
Absicherung ist der Hinweis, der bei jeder Änderung an die hinterlegte Adresse geht.

Bleibt der Fall, dass jemand **beides** verliert — Passwort und Postfach. Dafür gibt es keinen dritten
Faktor, also auch keine Automatik:

`/anmelden/hilfe` ist das öffentliche Meldeformular. Es **ändert nichts** und **verrät nichts**: Die
Antwort ist immer dieselbe, egal ob es die Person gibt — alles andere wäre eine Auskunft darüber, wer
die Bibelschule besucht (Art. 9 DSGVO). Die Meldung geht an Schulleitung *und* Verwaltung, damit
niemand warten muss, bis eine bestimmte Person am Schreibtisch sitzt, und sie trägt den ausdrücklichen
Hinweis, dass die Angaben ungeprüft sind. Das ist kein Beiwerk: Ein Formular, auf dessen Zuruf hin
eine Adresse geändert würde, wäre eine Kontoübernahme per Webseite.

`/verwaltung/personen` ist die Gegenseite. Schulleitung und Verwaltung (Recht
`PERSON_BEARBEITEN_ALLE`, ausdrücklich **nicht** der Administrator) suchen die Person, ändern die
Anmeldeadresse und schicken den Anmeldelink — nachdem sie den Menschen erkannt haben. Weil das
faktisch eine Kontoübernahme ist, hängt einiges daran: Rückfrage vor dem Speichern, Benachrichtigung
an **beide** Adressen, Entwertung offener Änderungsanträge (sonst biegt ein alter Bestätigungslink die
Adresse hinterher wieder um) und ein Eintrag im Audit-Log, den niemand löschen kann. Der Anmeldelink
geht immer an die hinterlegte Adresse, nie an den Auslösenden.

Damit ist auch die bisherige Einschränkung „keine Benutzerverwaltung" erledigt, soweit sie den
Zugang betrifft. (Rollen verwalten und Personen anlegen gibt es seit dem 29.07. ebenfalls; „Rollen speichern“
fragt mit den entzogenen und hinzugefügten Rollen nach, mit eigener Warnung beim Selbst-Entzug der Rolle
Administrator.) „Anmeldelink schicken“ meldet seit Code-Review 4 echte Zustellfehler und nennt die richtige
Drossel; der Weg zählt weiter gegen das IP-Kontingent des Büroanschlusses (offene Entscheidung).

**Abmelden und `/anmelden`** (Code-Review 4, M4): Das Abmelden löscht das `__Host-`-Sitzungscookie mit
denselben Attributen, mit denen es gesetzt wurde (`Secure`, `Path`, `HttpOnly`, `SameSite`) und `Max-Age=0`
— vorher verwarf der Browser den Löschversuch, und die Sitzung blieb bis zu 12 Stunden offen. Der Knopf
leitet nur bei Erfolg weiter und zeigt sonst eine Fehlermeldung. Einen serverseitigen Widerruf einzelner
Sitzungen gibt es nicht (offene Entscheidung). `/anmelden` zeigt eine noch laufende Sitzung samt
Abmelde-Knopf, verlinkt auf die Anmeldung zur Bibelschule, zeigt Fehler rot und getrennt vom Erfolg und bietet
nach dem Senden „Andere Adresse eingeben“. Die Drosseln zählen atomar per `pg_advisory_xact_lock` je
Schlüssel; bei IPv6 gilt das /64-Netz als ein Anschluss.

### Sichtbarkeit: was der Betrieb sehen können muss

Der Leitsatz aus dem ersten Review — **was der Betrieb nicht sehen kann, ist kaputt** — hat im zweiten
Review drei weitere Stellen getroffen. Alle drei sind jetzt sichtbar:

| Stiller Ausfallpfad | Wo er jetzt auftaucht |
|---|---|
| Mail hängt auf `WARTEND` (Prozess starb zwischen Anlegen und Abschließen der Protokollzeile) | Betriebsansicht, eigener Abschnitt „seit mehr als fünf Minuten wartend" |
| Niemand hat die Rolle Schulleitung oder Verwaltung — Meldungen erreichen keinen Menschen | Betriebsansicht, Kennzahl „Empfänger für Verwaltungsmeldungen", rot bei null; zusätzlich hinterlässt `lib/verteiler.ts` eine FEHLER-Zeile |
| Aufräumlauf tot (einzige Löschmechanik für Anmeldeentwürfe, Art. 5 Abs. 1 lit. e DSGVO) | Betriebsansicht, „zuletzt aufgeräumt", rot ab 48 Stunden; ein Lauf mit Löschungen steht immer als `AUFRAEUMEN_GELAUFEN` im Audit-Log, sonst spätestens alle 12 Stunden je Herkunft (`objektId` WORKER bzw. APP) — vorher blähte ein stündlicher Eintrag das unlöschbare Log auf |
| Worker steht (seit Code-Review 4) | Docker-Healthcheck auf `/tmp/gbs-worker-lebenszeichen` (jünger als 130 Minuten, `start_period` 15 min); Betriebsansicht „Worker zuletzt gelaufen“, Warnung ab 26 Stunden; `WORKER_LAUF_FEHLGESCHLAGEN` im Audit-Log bei einem gescheiterten Teillauf |
| Beleg nicht beim DMS angekommen (seit Code-Review 4) | Betriebsansicht, Kachel „Belege noch nicht im DMS“ (Zahlungsbelege, Honorarsatz-Belege, Zeugnis-Archivkopien) mit Hinweis bei fehlender `DMS_EMAIL`; nachsenden auf den Seiten Honorarsätze, Abrechnung bzw. Zeugnisse |

Dazu neu: **`/verwaltung/protokoll`** liest das Audit-Log, das bisher zwar geschrieben, aber von keiner
Oberfläche gelesen wurde. Damit werden die stillen Vorgänge sichtbar — abgewiesene Adressänderungen,
Meldungen aus dem Hilfeformular, fehlgeschlagene Passwortanmeldungen, Eingriffe der Verwaltung in
fremde Konten. Alt- und Neuwerte stehen nur eingeklappt: dort können personenbezogene Daten liegen.
Das Recht `AUDIT_LESEN` hat neben dem Administrator jetzt auch die Schulleitung — bei Bus-Faktor 1
darf die Sichtbarkeit nicht an einem einzigen Konto hängen.

**Das Container-Log nennt keine Empfängeradressen mehr** (seit Code-Review 4), sondern die Protokoll-ID
(`email_versand.id`) und die Vorlage; die Adresse steht nur in `email_versand`, das die Anonymisierung
erreicht (`select * from email_versand where id='<Protokoll-ID>';`). Ausnahme ist die Konsolenausgabe im
Entwicklungsmodus ohne SMTP. Die Betreffs der Verwaltungsmails enthalten keine Namen mehr („Neue Anmeldung
eingegangen“, „Stammdaten geändert“, „Meldung zum Portalzugang“); der Altbestand ist per Migration
`20260927130000_versandprotokoll_betreff_ohne_namen` bereinigt. **Die Fehlerseite zeigt einen Fehlercode**
(`digest`), den der Betrieb im Server-Log (`docker compose logs app`) neben dem Fehler findet.

### Warum die Antwortzeit eine Zusage ist

`/api/auth/anmelden` antwortet für bekannte und unbekannte Adressen gleich — im Inhalt **und in der
Laufzeit**. Ohne die Mindestlaufzeit von 700 ms verriete der Endpunkt über die Antwortzeit, wer ein
Konto hat: unbekannte Adresse wenige Millisekunden, bekannte erst nach dem abgewarteten Mailversand.
Das ist über das offene Internet messbar, und die Auskunft „diese Person besucht eine Bibelschule" ist
eine Angabe zur Religionszugehörigkeit (Art. 9 DSGVO).

Dieselbe Überlegung beim Passwort-Login: Bei einer unbekannten Adresse rechnet der Server trotzdem
eine volle scrypt-Runde (`verbrenneZeitWieEinePruefung`), und alle drei Ablehnungsgründe — Adresse
unbekannt, kein Passwort gesetzt, Passwort falsch — nennen denselben Satz.

**Wer diese Verzögerung für einen Schönheitsfehler hält und sie herausnimmt, macht den Endpunkt wieder
zur Auskunftsstelle.** Deshalb steht die Begründung im Code direkt daneben, und das Prüfskript misst
die Laufzeitangleichung mit.

### Herkunft einer Anfrage

`src/lib/request-kontext.ts` liest die Client-IP aus `X-Real-Ip`, ersatzweise aus dem **rechtesten**
Eintrag von `X-Forwarded-For`. Der linke Eintrag ist frei wählbar: Traefik hängt die echte
Gegenstelle hinten an einen mitgeschickten Header an. Wer links liest, protokolliert im Consent-Log
eine IP, die der Absender selbst bestimmt hat, und drosselt beim Rate-Limit den eigenen Proxy statt
den Angreifer.

### Herkunftsprüfung gegen CSRF (seit Code-Review 4)

Das Sitzungscookie ist `SameSite=Lax` — das hält nur fremde *Sites* ab, und alle Hosts unter `fes-credo.de`
gelten als dieselbe Site. Eine Schwachstelle auf irgendeiner Nachbar-Subdomain hätte genügt, um im Namen eines
angemeldeten Opfers eine E-Mail-Änderung zu beantragen (M5). Deshalb prüft `src/middleware.ts` (Matcher
`/api/:path*`) jede schreibende API-Anfrage mit der reinen Regel `pruefeHerkunft()` aus `src/lib/herkunft.ts`:

- GET, HEAD und OPTIONS sind frei.
- Schickt der Browser `Origin`, muss er **exakt** `new URL(APP_URL).origin` entsprechen; schickt er
  `Sec-Fetch-Site`, muss der Wert `same-origin` oder `none` sein. Ist `APP_URL` ungültig, wird abgewiesen.
- Fehlen beide Header (curl, Cron, Durchstich), geht die Anfrage durch — CSRF setzt einen Browser voraus, und
  Browser schicken bei POST/PUT/PATCH/DELETE immer `Origin`.
- Abgewiesen wird mit 403 und der Log-Zeile `[HERKUNFT] <Methode> <Pfad> abgewiesen (<Grund>)` (nur Methode,
  Pfad und die beiden Header, keine Rümpfe, keine Cookies).

Folgen für den Betrieb: `APP_URL` muss genau die Adresse sein, unter der das Portal geöffnet wird; die
Referrer-Policy darf nie `no-referrer` lauten (sonst schicken Browser `Origin: null`); ein externer Zeitgeber
ruft `/api/cron/erinnerungen` ohne `Origin` auf (wie curl standardmäßig) oder mit genau dem aus `APP_URL`.
Bewusst nicht gebaut: ein Zwang zu `Content-Type: application/json` (POSTs ohne Rumpf schicken keinen) und eine
Pfad-Ausnahme für `/api/cron/*` (neue Angriffsfläche über Pfad-Normalisierung). Die Middleware läuft bewusst in
der Edge-Laufzeit (Begründung im Dateikopf: `APP_URL` wird zur Laufzeit gelesen, und der Edge-Weg stellt den
Anfragerumpf verlässlich wieder her). Next puffert für die Middleware Rümpfe bis 10 MB
(`experimental.middlewareClientMaxBodySize`) — bei einem künftigen Datei-Upload unter `/api` bedenken. Geprüft
in `scripts/pruefe-herkunft.ts` und im Durchstich (Abschnitt 37).

### API-Konventionen

- **401 heißt „nicht oder nicht mehr angemeldet“**, 403 „angemeldet, aber ohne Recht“. Bei 401 sagt die
  Oberfläche „Ihre Sitzung ist abgelaufen …“ und leitet bewusst nicht um; man meldet sich in einem neuen Tab an
  und versucht es dann noch einmal.
- Routen prüfen in dieser Reihenfolge: Anmeldung → Recht über `pruefeZugriff(RECHT.X)` → Zod. `ladeMitRecht`
  nur noch in Seiten. Antworten über `erfolg()`/`fehler()`, unerwartete Fehler über `mitFehlerbehandlung`
  (einheitliche 500 mit deutschem Text); `P2002`/`P2003`/`P2025` werden übersetzt.
- **Download-Routen** (Zeugnis-PDF, Seriendruck, Excel-Export) antworten beim Browser-Klick nicht mit rohem
  JSON, sondern mit einer HTML-Fehlerseite bzw. einem 303 zur Anmeldung (`downloadFehler` in `lib/api.ts`).
- **Keine `loading.tsx`**, mit Absicht: Sie würde die `redirect()`/`notFound()`-Antworten der
  `force-dynamic`-Seiten bei direktem Aufruf zu HTTP 200 mit Meta-Refresh machen. Rückmeldung beim
  Seitenwechsel gibt `<LadeHinweis />` (`useLinkStatus`) in Kachel und Zurück-Leiste.

### Geteilte Bausteine (Stand 27.09.2026)

Neu bzw. zusammengeführt mit Code-Review 4 — vorher gab es für die meisten davon mehrere Kopien:

| Baustein | Inhalt |
|---|---|
| `src/lib/dms.ts` | `mitDmsSperre` (Postgres-Advisory-Lock je Beleg), `sendeBelegAnDms` |
| `src/lib/beleg-nr.ts` | eine Regel für alle Beleg-Nummern (`HON`, `HONA`, `ZEU`, `BESCH`) mit Berliner Kalendertag |
| `src/lib/herkunft.ts` | Herkunftsprüfung (CSRF), DB-frei |
| `src/lib/status.ts`, `src/lib/status-io.ts` | Statusregeln DB-frei, `wechsleStatus` als einziger Schreibweg |
| `src/lib/teilnahme-filter.ts` | `TEILNAHME_ZAEHLT`, `PERSON_ZAEHLT_AKTIV` (ohne Prisma-Import) |
| `src/lib/formular-optionen.ts` | Antwortmöglichkeiten, Zuordnung, `ART9_AKTENFELDER` — gemeinsam für Builder und Prüfskript |
| `src/lib/anmeldung-antworten.ts` | Antwortansicht und Art.-9-Regel (`art9Eingewilligt`) |
| `src/lib/leistung-schema.ts` | Zod-Schema der Noten-Routen (`leistung.ts` bleibt zod-frei, weil Client-Komponenten sie importieren) |
| `src/lib/personen-namen.ts` | lesbare Namen für Genehmiger, Freigeber und Aussteller (vorher im Honorarmodul) |
| `src/lib/anmeldestatus.ts` | Klartexte des Anmeldestands (überall „Angenommen“) |
| `src/lib/honorar-korrektur.ts` | DB-frei: Sperre des Dozentenwechsels, Nachversand-Regeln, `dmsVersand`-Texte, Statuscodes der Honorar-Routen |
| `src/lib/zeugnis-sammellauf.ts` | DB-frei: Sperren und Rückfrage des Sammellaufs, Zeugnissperre je Person |
| `src/lib/aufraeumen-regel.ts` | DB-frei: wann der Aufräumlauf protokolliert (bei Löschungen, sonst alle 12 h je Herkunft) |
| `src/lib/constants.ts` | zusätzlich `EINRICHTUNG`, `KURSRASTER`, `STUNDE_MS` |
| `src/lib/api.ts` | zusätzlich `mitFehlerbehandlung`, `nieErreicht`, `downloadFehler` |
| `src/components/ui/meldung.tsx` | `MeldungsBox` mit dauerhaften Live-Regionen (Rückmeldungen werden vorgelesen) |
| `src/components/ui/lade-hinweis.tsx` | `<LadeHinweis />` für Links |
| `src/components/ui/abmelden-knopf.tsx` | `AbmeldenKnopf` (vorher unter `src/app/verwaltung/`) |
| `src/components/noten/noten-matrix.tsx` | `NotenMatrix` (vorher unter `src/app/verwaltung/noten/`) |

Die ungenutzten `--color-status-*`-Tokens sind aus `globals.css` entfernt; Status-Tönungen kommen aus
`components/ui/badges.tsx`. Jede Seite hat einen eigenen Tab-Titel („… · GBS Campus“) und eine Zurück-Leiste
mit Krümelspur.

### Selbstbestätigung der Anwesenheit (Release 0.2)

In `/meine-daten` → „Meine Anwesenheit" bestätigt ein Teilnehmer für seine **vergangenen**
Unterrichtsabende selbst, ob er **anwesend** war oder den Stoff **nachgearbeitet** hat — beides zählt
laut Schulordnung als Teilnahme und fließt direkt in die 80-%-Quote. Kein neues Datenmodell: der
Eintrag landet in derselben Tabelle `anwesenheiten` wie die Erfassung durch die Verwaltung.

Drei Regeln stehen DB-frei in [`src/lib/selbstbestaetigung.ts`](src/lib/selbstbestaetigung.ts), damit
[`scripts/pruefe-selbstbestaetigung.ts`](scripts/pruefe-selbstbestaetigung.ts) sie ohne Postgres
gegenprüfen kann: (1) nur `ANWESEND`/`NACHGEARBEITET` — ob eine Abwesenheit entschuldigt ist,
entscheidet die Schule, „gefehlt" meldet niemand über sich selbst; (2) nur Abende, die schon
stattgefunden haben; (3) **der Teilnehmer überschreibt nur seinen eigenen Eintrag** — wird
`erfasstVonId` auf die eigene Id gesetzt, und ein von der Verwaltung erfasster Abend (fremde
`erfasstVonId`) bleibt für ihn schreibgeschützt. Das verhindert, dass jemand ein administratives
„gefehlt" mit einem selbst gesetzten „anwesend" übertüncht. Der Durchstich weist genau diesen Fall
nach (409 statt Überschreiben).

### Eigene Anwesenheitsquote für den Schüler (Release 0.3)

In `/meine-daten` → „Meine Anwesenheit" sieht jeder Teilnehmer je Semester **seine eigene Quote** — die
Prüfungsberechtigung hängt an der 80-%-Schwelle, bisher sah nur die Verwaltung die Zahl. Gemessen wird
über **alle Abende des Semesters** (Modell A), nicht nur die schon erfassten, mit drei Zuständen:
**Erfüllt** (schon genug Teilnahmen — nicht mehr verlierbar), **Noch offen** (mit Klartext „Es dürfen noch
N Abende fehlen.“) und **Nicht mehr erreichbar**. Ein noch **nicht erfasster** vergangener Abend zählt
bewusst als *offen*, nicht als Fehltag: Die Erfassung passiert im Betrieb oft verspätet, ein Abend ohne
Eintrag soll die Quote nicht fälschlich drücken — eine Selbstbestätigung schiebt ihn dann in
„teilgenommen". Seit Code-Review 4 rechnen Personenliste, Detailakte und Stundenplan der Verwaltung mit
demselben Modell A (vorher gab es drei verschiedene Quoten für dieselbe Person); die Liste zeigt ✓ erfüllt,
• offen oder ✕ nicht erreichbar. Eine abgemeldete Teilnahme hat keine Quote.

Kein neues Recht, keine Migration. Die Kernrechnung steht DB-frei in
[`src/lib/stundenplan.ts`](src/lib/stundenplan.ts) (`quoteModellA`, gegengeprüft in
[`scripts/pruefe-quote-schueler.ts`](scripts/pruefe-quote-schueler.ts)); die Schwelle kommt wie in der
Verwaltungssicht aus der Einstellung `ANWESENHEIT_MINDEST_PROZENT`. Weil die Quote eine reine Ansicht
ist, erscheint sie schon mit `PERSON_LESEN_EIGENE` — nur die Selbstbestätigungs-Knöpfe hängen weiter an
`PERSON_BEARBEITEN_EIGENE`. Der Durchstich weist die gerenderte Quote für einen angemeldeten Schüler nach.

### Dozenten-Self-Service (Release 0.3)

Die Rolle **Dozent** war bis dahin faktisch leer — dieselben zwei Rechte wie ein Teilnehmer, und nach
dem Login landete ein Dozent in der eigenen Akte. Jetzt hat er einen eigenen Bereich **`/dozent`**
(„Mein Unterricht"): Nach dem Login leitet die Weiche in `/verwaltung` einen reinen Dozenten dorthin
(wer zusätzlich ein Verwaltungsrecht trägt, z. B. ein Schulleiter, der auch unterrichtet, bleibt in der
Verwaltung). `/meine-daten` bleibt erreichbar — der Dozent braucht es für seine Bankverbindung
(Honorar-Auszahlung).

**Stufe 1 — eigener Stundenplan (read-only):** `ladeEigeneDozentTermine` spiegelt den Schüler-Loader,
filtert aber über `Unterrichtstermin.dozentId` statt über die Teilnahme; vergangene und kommende Abende
je Semester mit Fach. Neues Recht `EIGENE_TERMINE_LESEN`.

**Stufe 2 — Anwesenheit an der Quelle** (löst den blinden Fleck, dass der Dozent im Raum die
prüfungsrelevante 80-%-Quote bisher nicht speisen konnte): Für seine **eigenen** vergangenen Abende
trägt der Dozent die Anwesenheit der Teilnehmer ein. Der eigentliche Schutz ist ein **Scope-Guard** in
`erfasseAlsDozent` — `termin.dozentId === benutzer.id`, sonst **403**; das Recht
`ANWESENHEIT_ERFASSEN_EIGENE` öffnet nur die Route (`POST /api/dozent/anwesenheit`). Erlaubt sind nur
**anwesend/gefehlt/nachgearbeitet** — „entschuldigt" bleibt eine Schulentscheidung (DB-frei in
`istDozentStatusErlaubt`, dieselbe Grenze wie bei der Selbstbestätigung). Beide Rechte sind **Daten im
Seed** — keine Migration; **GASTDOZENT** bleibt bewusst rechtlos (Token-Flow ohne Login). Der Durchstich
weist Login-Routing, gerenderte Seite, Erfassung des eigenen Abends (200), den Scope-Guard (403 auf
fremden Abend) und die Zustands-Grenze (400 bei „entschuldigt") nach.

Seit Code-Review 4: „Offene Aufgaben“ springen per „Jetzt erfassen“ zum Abend und klappen ihn auf; in
`/meine-daten` führt „← Mein Unterricht“ zurück. Abgemeldete Teilnahmen stehen nicht in der Erfassung, und
Hörer stehen nicht in der Notenerfassung.

### Dozentenhonorar (Release 0.2)

Die Rolle **Dozent** ist scharfgeschaltet: Jeder Unterrichtsabend lässt sich im Stundenplan einem
Dozenten zuordnen (neues Feld `Unterrichtstermin.dozentId → Person`, `onDelete: SetNull` — ein
gelöschtes Dozentenkonto reißt den Abend nicht mit). Die Zuordnung läuft über die bestehende
Termin-PUT und ist damit an `SEMESTER_VERWALTEN` gebunden; serverseitig wird geprüft, dass die Person
die Rolle Dozent trägt (`istDozent`), sonst 400. Die read-only Übersicht `/verwaltung/honorar`
(Recht `HONORAR_LESEN`, Bereich Finanzen) rechnet je Dozent die **gehaltenen Abende**, jeden Abend zu
dem Satz, der zu seinem Datum galt (siehe Satz-Historie unten); für bereits abgerechnete Abende zeigt sie
den eingefrorenen Betrag.

**Ein abgerechneter Abend lässt sich keinem anderen Dozenten mehr zuordnen** (Code-Review 4, M11): Der
Termin-PUT läuft mit Zeilensperre und antwortet 409, sobald sich `dozentId` an einem Abend mit
Abrechnungsposten tatsächlich ändert (auch beim Entfernen). Korrekturweg bei einer OFFENEN Abrechnung:
stornieren → umhängen → neu abrechnen. Im Stundenplan sind abgerechnete Abende gekennzeichnet (Dozent
gesperrt, kein Löschen, Link zur Abrechnung).

Die Migration ist wie alle hier **von Hand** geschrieben und rein additiv (`ADD COLUMN` / `CREATE INDEX`
/ `ADD CONSTRAINT`, keine `DROP`s) — `prisma migrate dev` würde sonst den partiellen Unique-Index des
laufenden Semesters und die Append-only-Trigger als DROP mit aufnehmen.

### Honorarsatz-Historie und DMS-Beleg (Release 0.3, erster Slice)

Der Honorarsatz ist kein einzelner Regler mehr, sondern eine **Historie mit Gültig-ab-Datum** (Modell
`HonorarSatz`, Tabelle `honorar_saetze`): Jeder Abend nimmt den Satz, der zu seinem Datum galt. Damit
verändert ein **künftig datierter** Satz vergangene Beträge nicht mehr. Eine rückwirkende Korrektur
(eine Zeile mit vergangenem Gültig-ab) ist bewusst möglich — sie bewertet noch nicht ausgezahlte Abende
neu; **spätestens beim Auszahlungslauf (weiterer 0.3-Schritt) wird der Betrag je Abend eingefroren**,
sodass bereits Ausgezahltes stabil bleibt. Die Auflösung „welcher Satz gilt an Tag X" steht DB-frei in
`satzFuer(datum, saetze)` (`src/lib/honorar.ts`, mutationssicher geprüft): das größte `gueltigAb ≤ X`,
bei gleichem Datum die zuletzt genehmigte Zeile; liegt ein Abend vor dem ersten Satz oder ist die
Historie leer, greift die Konstante `HONORAR_SATZ_FALLBACK` (= 60). Der bisherige Einzel-Regler
`HONORAR_SATZ_PRO_ABEND` ist **abgelöst**: Der Seed überführt seinen Wert in die erste Historien-Zeile
und entfernt die Einstellung, damit kein toter Regler zurückbleibt.

Verwaltet werden die Sätze unter `/verwaltung/honorar/saetze` (neues Recht `HONORAR_SATZ_GENEHMIGEN`,
Schulleitung + Verwaltung). Das **Eintragen eines Satzes ist die Genehmigung** — `genehmigtVonId` und
`genehmigtAm` halten fest, wer wann genehmigt hat. Nach jeder Genehmigung erzeugt
`genehmigeHonorarSatz` einen **DMS-Beleg** (PDF: komplette Satz-Historie + alle Unterrichtstage mit Fach
und geltendem Satz, dazu Beleg-Nummer und Genehmiger) und schickt ihn per Mail an das DMS
(`DMS_EMAIL`); `dmsBelegNr`/`dmsGesendetAm` protokollieren den Versand. Fehlerverhalten wie beim Mailer:
Die Genehmigung ist die fachliche Tatsache und wird **nicht zurückgerollt**, wenn der Beleg-Versand
(oder mangels `DMS_EMAIL` die Zustellung) ausbleibt — der offene Versand bleibt sichtbar. Der Beleg
enthält bewusst **keine** Dozentennamen (Datenminimierung); der PDF-Erzeuger bleibt abhängigkeitsfrei,
die DMS-Referenz ist deshalb eine Beleg-Nummer und kein QR-Bild. Ein Muster erzeugt
`tsx scripts/muster-honorar-dms.ts`.

Seit Code-Review 4: Das Genehmigen fragt mit Betrag und Gültig-ab nach. Die Satz-Historie im Beleg endet bei
der auslösenden Genehmigung, sodass ein nachgesendeter älterer Beleg keine später genehmigten Sätze enthält.
Ein nicht angekommener Beleg lässt sich über „Beleg erneut senden“ auf der Sätze-Seite nachsenden
(`POST /api/honorar/saetze/[id]/beleg-senden`, Recht `HONORAR_SATZ_GENEHMIGEN`, nur wenn `dmsGesendetAm` leer
ist) — mit derselben Beleg-Nr und dem Vermerk „NACHVERSAND – Kopie des Belegs <Nr>“, Audit
`HONORAR_SATZ_BELEG_NACHVERSAND`. Ohne `DMS_EMAIL` steht dort statt des Knopfs ein Hinweis auf die fehlende
DMS-Adresse. Sätze sind per Trigger eingefroren (nur Beleg-Nr und DMS-Datum nachtragbar, kein DELETE): Eine
Korrektur ist eine neue Zeile. Ein rückdatierter Satz wirkt nur auf noch nicht abgerechnete Abende.

### Honorar-Auszahlung (Release 0.3)

Eine **Abrechnung** fasst die gehaltenen Abende **eines Dozenten in einem Semester** zusammen (Modell
`HonorarAbrechnung` + `HonorarAbrechnungPosten`). Beim Erstellen wird der Betrag **je Abend eingefroren**
(ein Posten mit Datum, Fach und dem zu diesem Zeitpunkt geltenden Satz) — eine spätere Satzänderung
verändert eine bestehende Abrechnung nicht mehr. Jeder Abend fließt in **höchstens eine** Abrechnung
(`Posten.terminId` ist `@unique`, DB-seitig gegen Doppel-Honorar auch bei parallelen Aufrufen). Die
Übersicht `/verwaltung/honorar/abrechnungen` zeigt je Dozent, was **offen** (gehalten, noch nicht
abgerechnet) und was bereits abgerechnet/ausgezahlt ist.

**Zwei Schritte** (Recht `HONORAR_ABRECHNEN`, Schulleitung + Verwaltung): erstellen (`OFFEN`) → **freigeben**
(`FREIGEGEBEN`) → **als ausgezahlt markieren** (`AUSGEZAHLT`, mit Datum). Die eigentliche Überweisung
passiert **nicht** in der Software (Optigem, später) — der Zahllauf ist Erfassung, Beleg und Statusführung.

Bei der **Freigabe** geht ein **Zahlungsbeleg** an das DMS (`DMS_EMAIL`) — professionell und vollständig:
Dozent, Zahlungsempfänger **inkl. IBAN** (aus der Person entschlüsselt), jede Position (Datum · Fach ·
eingefrorener Betrag) und die Summe, damit die Finanzbuchhaltung ohne Rückfrage überweisen und ein Dritter
alles nachvollziehen kann. Weil der Beleg die IBAN im Klartext enthält, verlangt die Freigabe **zusätzlich**
das IBAN-Recht `BANKVERBINDUNG_LESEN` (in der Praxis die Verwaltung/FiBu), und jede Freigabe wird
protokolliert. Fehlerverhalten wie beim Mailer: die Freigabe ist die fachliche Tatsache und wird bei einem
Belegfehler nicht zurückgerollt (`dmsGesendetAm` bleibt leer, Versand sichtbar offen). Ein Muster erzeugt
`tsx scripts/muster-honorar-abrechnung.ts` (mit Beispiel-IBAN).

**Korrektur und Nachversand (seit Code-Review 4, M11/M12):**

- **Storno** einer OFFENEN Abrechnung: Knopf „Abrechnung stornieren“ mit Rückfrage bzw.
  `DELETE /api/honorar/abrechnungen/[id]` (Recht `HONORAR_ABRECHNEN`). Atomar über ein bedingtes Löschen, die
  Posten fallen per Cascade weg, das Audit `HONORAR_ABRECHNUNG_STORNIERT` hält alle Posten fest. Sonst 409
  (schon freigegeben) bzw. 404. **Eine freigegebene oder ausgezahlte Abrechnung ist bewusst nicht
  korrigierbar** — die Korrektur läuft außerhalb, per Gegenbuchung.
- **„Abrechnen“ schreibt nur fest, was die Rückfrage genannt hat** (Dozent, Abende, Betrag). Weichen Abende
  oder Summe inzwischen ab, entsteht keine Abrechnung (409 „bitte neu laden“).
- **„Freigeben“ ist ohne Bankverbindung gesperrt**; die IBAN trägt der Dozent selbst unter „Meine Daten“ ein,
  und die Fehlermeldung des Servers sagt das. Nach der Freigabe bleibt die Rückmeldung zum DMS-Versand auf der
  Detailseite stehen. Freigabe und Genehmigung melden `dmsVersand` (`GESENDET | KEINE_ADRESSE | FEHLGESCHLAGEN
  | LAEUFT`); ein nicht angekommener Beleg erscheint als gelber Hinweis mit dem Weg zum Nachsenden, statt als
  „E-Mail noch nicht eingerichtet“.
- **Nachversand des Zahlungsbelegs:** „Beleg erneut senden“ bzw. `POST /api/honorar/abrechnungen/[id]/beleg-senden`
  (dieselben Rechte wie die Freigabe, nur bei FREIGEGEBEN/AUSGEZAHLT ohne `dmsGesendetAm`, sonst 409). Der Beleg
  wird aus den eingefrorenen Posten mit derselben Beleg-Nr neu gebaut und trägt im PDF „NACHVERSAND – Kopie des
  Belegs <Nr>, nicht erneut anweisen“. **Er trägt die dann hinterlegte IBAN** — die Abrechnung speichert keine;
  die Mail sagt das ausdrücklich (offene Entscheidung HON-iban-abgleich-nachversand).
- **Jeder DMS-Versand läuft unter einer Sperre:** Postgres-Advisory-Lock je Beleg in einer Transaktion, die
  während des SMTP-Versands eine Verbindung hält (Zeitlimit 60 s); ein zweiter gleichzeitiger Versand bekommt
  409. So kann ein Zahlungsbeleg mit IBAN nicht doppelt anweisbar im DMS landen. Log-Meldung „Beleg gesendet,
  Festhalten unter der Sperre gescheitert — wird nachgetragen“: Der Beleg ist beim DMS, `dmsGesendetAm` wurde
  außerhalb der Sperre nachgetragen. Folgt „dmsGesendetAm nicht nachgetragen“, steht der Beleg fälschlich auf
  „Versand steht aus“; ein Nachversand trägt dann den Kopie-Vermerk.
- **Statuscodes:** `POST /api/honorar/abrechnungen` 400 bei keinen offenen Abenden, 409 wenn ein Abend
  zwischenzeitlich abgerechnet oder umgehängt wurde; `…/[id]/freigeben` 404 (gibt es nicht bzw. storniert), 409
  (nicht OFFEN oder keine IBAN), 500 (IBAN nicht entschlüsselbar); `…/[id]/auszahlen` 400 (ungültiges Datum),
  404, 409 (nicht FREIGEGEBEN). Bis Code-Review 4 lieferten diese Routen pauschal 400.
- **Beleg-Nummern** (`HON-`, `HONA-`) tragen den Berliner Kalendertag; früher zwischen 0 und 2 Uhr vergebene
  Belege tragen den Vortag (nur die Referenz, keine Migration — wichtig für die Suche im DMS).
- Abrechnungen und Posten sind per Trigger eingefroren (siehe „Audit-Log wirklich append-only“).
- Offen als Entscheidung: Selbstabrechnung, wenn Verwaltung und Dozent dieselbe Person sind
  (SEC-honorar-selbstabrechnung), und eine Freigabesperre nach IBAN-Wechsel (E1-iban-freigabesperre).

### Noten und Zeugnisse (Release 0.4)

Leistungen erfassen Dozent (eigene Abende je Kurseinheit und Semester) und Schulleitung (Recht
`NOTEN_VERWALTEN`); Schüler sehen ihre Noten und Zeugnisse unter „Meine Daten“. Zeugnisse (Semester- und
Abschlusszeugnis, Hörer-Bescheinigung) werden als eingefrorener Snapshot ausgestellt, als PDF abgerufen und als
Archivkopie ans DMS geschickt. Seit Code-Review 4 gilt:

- **Hörer werden nicht benotet** („Hörer fällt aus jeder Prüfungsautomatik“): Sie stehen nicht in Notenmatrix
  und Noten-Editor, Noten für Hörer → 400, für abgemeldete Teilnahmen → 409. Das Abschlusszeugnis zählt nur
  Schüler-Semester, die zählen (`TEILNAHME_ZAEHLT`).
- In der Detailakte ist „— nicht bewertet“ bei bewerteten Fächern gesperrt (die API kann eine Bewertung nicht
  leeren); nach dem Speichern zeigt die Akte den Stand der Datenbank (M18). Die Semesterwahl wechselt erst mit
  „Anzeigen“, und bei ungespeicherten Noten fragt der Browser vor dem Wechsel bzw. Neuladen nach.
- **„Alle ausstellen“** fragt mit konkreten Zahlen nach (M14): neue Zeugnisse und Bescheinigungen, Teilnehmer
  mit unbewerteten Fächern, Teilnehmer ganz ohne Bewertung und beim Abschluss Teilnehmer mit weniger als 6
  Schüler-Semestern. **Gesammelt gibt es Abschlusszeugnisse nur im letzten Rastersemester** (Lehrjahr 3,
  Halbjahr 2), einzeln weiterhin jederzeit. Antwort `{ ausgestellt, vorhanden, storniert, ohneAnwesenheit,
  fehlgeschlagen, gesamt }`;
  ABSCHLUSS außerhalb des letzten Semesters → 400, unbekanntes Semester → 404. Der Knopf ist gesperrt, solange
  eine geänderte Auswahl nicht angezeigt ist.
- Keine (Neu-)Ausstellung für ANONYMISIERT, Endzustände oder abgemeldete Teilnahmen (409); ABSOLVENT bleibt
  ausstellbar. Die Ausstellung sperrt die Personenzeile, damit sie nicht mit einer Anonymisierung kollidiert.
- **Ein ersetztes Zeugnis** (nach „Neu ausstellen“) liefert dem Schüler über die alte Id 410 mit Hinweis auf
  „Meine Daten“; die Schulleitung bekommt es als PDF mit dem Kopfvermerk „UNGÜLTIG – ersetzt durch Beleg … am …“
  und dem Dateinamen `<BelegNr>-UNGUELTIG.pdf`. Der Snapshot bleibt unverändert.
- **DMS-Archivkopie:** geht nach der Antwort raus (`after()`), einzeln wie im Sammellauf. Frisch ausgestellte
  Zeugnisse gelten erst nach 2 Minuten als „noch nicht im DMS archiviert“. Nachsenden über den gelben Kasten auf
  der Zeugnisseite bzw. `POST /api/zeugnisse/dms-nachsenden` (Recht `NOTEN_VERWALTEN`): nur GÜLTIGE, höchstens
  4 Mails zu je 50 Zeugnissen je Klick, gruppiert nach Abschnitt, Abbruch beim ersten SMTP-Fehler, unter
  derselben Sperre wie die Honorarbelege (zweiter Klick → 409, ohne `DMS_EMAIL` → 409), Zeitbudget 20 s. Audit
  `ZEUGNIS_DMS_NACHGESENDET`.
- **Beleg-Nr** (`ZEU-`, `BESCH-`) mit Berliner Kalendertag. **PDF-Zeichen:** lateinische Sonderzeichen außerhalb
  von Latin-1 werden über WinAnsi abgebildet oder transliteriert; Kyrillisch und Griechisch erscheinen als „?“
  (offene Entscheidung).
- Zeugnisse sind per Trigger eingefroren; die Anonymisierung überschreibt nur Name und Geburtsdatum im
  Snapshot (Fachentscheidung 27.09.2026) und den Grund eines Stornos.
- **Teilnahmebescheinigung (Hörer)** seit dem 27.09.2026 (spät) nur mit mindestens einem besuchten Abend
  (anwesend oder nachgearbeitet) und nur mit den besuchten Fächern; sonst Einzel-Ausstellung 409, im
  Sammellauf `ohneAnwesenheit`. Eine 80-%-Pflicht gibt es bewusst nicht.
- **Storno ohne Ersatz** seit dem 27.09.2026 (spät): `POST /api/zeugnisse/[id]/stornieren` mit Pflichtgrund
  (Recht `NOTEN_VERWALTEN`, auch in der Detailakte). Status `STORNIERT`, Zeitpunkt, Akteur und Grund bleiben als
  Nachweis; für die Person 410, für die Schulleitung PDF mit Vermerk „STORNIERT am …“ und Dateiname
  `<BelegNr>-STORNIERT.pdf`. Der Sammellauf stellt für ein storniertes Dokument nichts still neu aus, einzeln
  geht es. Audit `ZEUGNIS_STORNIERT` ohne Grundtext.

---

## Verifiziert

### Stand nach Code-Review 4 (27.09.2026)

Verifiziert in einer Sandbox-Kopie außerhalb des Sync-Ordners (Befehle in [`UEBERGABE.md`](UEBERGABE.md),
„Prüfen ohne Docker“), Durchstich und `pruefen:db` mit Docker gegen das gebaute Image:

| Prüfung | Ergebnis |
|---|---|
| `tsc --noEmit` | 0 Fehler |
| `npm run pruefen` | **1341 Prüfungen in 20 Skripten, 0 fehlgeschlagen** — auch in leerer Umgebung mit `TZ=Europe/Berlin` wie in der Docker-Stufe `builder` |
| `next build` in leerer Umgebung | grün, 43 Seiten |
| esbuild-Bundles (Seed, Worker, `setup-app-nutzer`) | grün |
| Migrationen gegen PGlite | alle 25 fehlerfrei; für die Storno-Migration 69 SQL-Prüfungen (Trigger, CHECK, Rückwege, Scrub) |
| Migrationen gegen PostgreSQL 16 | im Durchstich auf frischer Datenbank und als Aktualisierung einer bestehenden (27.09.2026, spät) |
| `prisma migrate diff` Migrationen ↔ Schema | leer, kein Drift |
| `bash -n scripts/durchstich.sh` | Syntax ok, `SOLL=850` |
| **Durchstich gegen das Image** | **850/850 grün** (27.09.2026, spät) |
| `npm run pruefen:db` | 19 + 18 grün |

Der Durchstich deckt seit Code-Review 4 zusätzlich ab (Abschnitte 0 und 37–50 sowie Ergänzungen in älteren
Abschnitten): Datumsannahmen; Herkunft/CSRF und Login-CSRF, Abmelde-Cookie, Sitzungshinweis, Bankverbindung nur
per POST mit `no-store`; Einwilligungstext-Trigger und `gbs_app`-Rechte; eingefrorene Honorarbelege und
Zeugnisse (SQL-Sperren, Triggerzahl), Leistung `RESTRICT`; Statusroute, letzter Administrator, ABSOLVENT;
Ausbildungsdaten; „bin raus“ und Antwort ändern, Abmeldung ohne Rückmeldung durch den Worker, Erinnerung ohne
SMTP, Aufräumlauf mit Inhalt, erledigte Stufen, verschobener Beginn, parallele Starts, Wieder aufnehmen und
Herausfallen aus allen Listen; Hörer ohne Noten; Honorar-Storno, Sperre und Nachversand samt DMS-Hinweisen;
Abschluss-Sammellauf-Sperre, ersetzte Zeugnisse, DMS-Nachversand der Zeugnisse; seit dem 27.09. spät auch
Zusage von Hand (23b), Worker mit Anwesenheit (26), Erneut senden (26b), Hörer ohne Anwesenheit und
Zeugnis-Storno (36b), zuletzt Abgemeldete bei der Übernahme (41b) und die Wiederaufnahme nach Abbruch (39); Antwortansicht der Anmeldungen,
Zwischenstand per POST, Fangfeld; Formular-Builder; Anonymisierung Ende-zu-Ende; Seed-Wiederholung,
Semester-Umbenennung mit Neustart, Opt-out ohne `APP_DB_PASSWORD`, `APP_URL`-Startabbruch, Eigentümer-Passwort
nicht im Serverprozess, Logs ohne Adressen; vollständige Auskunft, Links verfallen beim Adresswechsel; zum
Schluss ein Sweep, dass keine IBAN und keine Art.-9-Angabe in Protokollen und Belegen steht. Nebenbei behoben:
Abschnitt 28 erwartete noch „Du darfst noch“ und war seit dem UI-Redesign 0.4 rot; der Text heißt „Es dürfen
noch … fehlen.“

Einige Handprüfungen lassen sich per curl nicht machen — sie stehen in [`LAIENTEST.md`](LAIENTEST.md).

### Frühere Nachweise

> **Die Nachweise ab hier sind historisch.** Sie stammen vom Stand vor dem Passwortweg; der Rest —
> Passwortweg und sämtliche Fixes aus dem zweiten Review — ist am 28.07.2026 nachgeholt worden und steht in
> „Verifikationslauf vom 28.07.2026" weiter unten. Die Prüfzahlen darin sind die damaligen; die aktuellen
> stehen oben. Gemessen, nicht behauptet.

| Prüfung | Ergebnis |
|---|---|
| `tsc --noEmit` | fehlerfrei |
| `next build` | erfolgreich, 39 Routen |
| Migrationen auf leerer Datenbank | alle neun eingespielt |
| Seed zweimal hintereinander | idempotent, identische Zahlen |
| `UPDATE` auf `audit_log` | abgewiesen |
| `DELETE` auf `audit_log` | abgewiesen |
| Zweites Semester mit `istAktuell = true` | abgewiesen |
| `/api/health` bei laufender Datenbank | `200`, `{"data":{"status":"ok",…}}` |
| `/api/health` bei gestoppter Datenbank | `503`, ohne Verbindungsdetails |
| Erholung nach Datenbank-Neustart | selbsttätig nach ca. 3 Sekunden |
| Produktions-Image, Start gegen leere Datenbank | Migration + Seed laufen im Entrypoint, Prozess läuft als `nextjs` (uid 1001), nicht als root |

### Nach dem Code-Review vom 27.07.2026

Sieben Review-Agenten fanden 211 Befunde, davon 11 GoLive-Blocker. Alle behoben und einzeln
nachgemessen — die Nachweise stehen unten. Der vollständige Report liegt in
[`../2_Code-Review.html`](../2_Code-Review.html).

| Blocker | vorher | jetzt |
|---|---|---|
| **Backup lief nie** | `date -d "tomorrow"` scheitert unter BusyBox, `set -e`, Crash-Loop, null Dumps | BusyBox-taugliche Zeitrechnung, Startlauf sofort beim Hochfahren, Dump erzeugt und mit Testdatensatz verifiziert |
| **Kaputter Dump löschte gute** | `pg_dump \| gzip` prüfte nur gzip, Rotation lief trotzdem | `set -o pipefail`, Dump in `.tmp`, `gzip -t`, erst dann umbenennen und rotieren |
| **IBAN im Klartext** | stand zusätzlich unverschlüsselt in `anmeldungen.antworten` | aus dem Antwort-JSON entfernt, nur noch verschlüsselt an der Person |
| **Art.-9-Daten ohne Einwilligung** | Zwischenspeichern umging die Sperre vollständig | Entwurf verwirft Art.-9-Felder, IBAN und unbekannte Schlüssel; nur bekannte Felder bleiben |
| **Einwilligungsnachweis löschbar** | `DELETE` lief durch, `TRUNCATE` umging alle Trigger, Person löschen ergab 0 von 2 | DELETE- und TRUNCATE-Trigger auf beiden Tabellen, Cascade auf `SetNull` |
| **Mailausfall unsichtbar** | keine Oberfläche las `email_versand` | Betriebsansicht unter `/verwaltung/betrieb`, Healthcheck meldet fehlendes SMTP als `503` |
| **Fehlende Konfiguration sperrte alle aus** | Schlüsselfehler wurde als „nicht angemeldet" verschluckt, Health meldete „ok" | Startprüfung bricht ab, `getSchluessel()` außerhalb des try, Health prüft die Konfiguration mit |
| **Oberfläche hing bei Netzwerkfehlern** | `await antwort.json()` ohne `catch`, Knopf blieb dauerhaft gesperrt | `src/lib/api-client.ts` — ein Rückgabeweg, Zeitgrenze 30 s, deutsche Meldung, `finally` |
| **Auswahlfragen unbeschriftet** | `label htmlFor` zeigte auf eine ID, die es nicht gab | `fieldset`/`legend`, `aria-describedby`, `aria-required`, Autofill, Sprung zum ersten Fehler |
| **Builder unbeschriftet** | 6 Beschriftungen je Zeile ohne `htmlFor` | durchgängige IDs, 44-px-Trefferflächen, Rückfrage vor dem Löschen, stabile Schlüssel — letzteres stimmte damals nicht (Schlüssel hingen an bearbeiteten Werten, Fokusverlust); seit Code-Review 4 (M15) laufen Schlüssel und IDs über eine clientseitige `uid`, und die Abschnittsköpfe sind beschriftet |
| **Off-Site-Backup** | fehlt | **weiterhin offen** — braucht ein Ziel und einen Restore-Drill (siehe unten) |

Dazu die wichtigsten MAJOR-Befunde: vier Nebenläufigkeitslücken geschlossen (Bedingung in die
schreibende Anweisung), `P2002` beim Doppelklick abgefangen, Teilnahmeform wird nicht mehr aus dem
Optionstext geraten, PLZ kann kein Zahlenfeld mehr sein, Umlaute in allen Nutzertexten, Montserrat
wird geladen, Abmelden-Knopf, echte Startseite, `src/lib/constants.ts`, einheitliche Fehlerform,
gepoolter SMTP-Transport mit Zeitgrenzen, Aufräumlauf, elf ungenutzte Pakete entfernt.

**Der Anmeldelink wird jetzt per POST eingelöst.** Ein GET auf den Link verbraucht ihn nicht mehr —
Link-Scanner in Mail-Sicherheitslösungen (Microsoft Safe Links, GMX, web.de) hätten sonst den
Einmal-Token entwertet, bevor der Empfänger überhaupt klickt. Bei passwortlosem Login wäre das ein
Zugangsausfall ohne erkennbaren Grund gewesen.

### Bankverbindung für den Beitragseinzug

Die Verwaltung braucht die IBAN im Klartext, um den Semesterbeitrag einzuziehen. Sie steht deshalb
unter `/verwaltung/anmeldungen` — aber erst auf Klick, nicht beiläufig auf dem Bildschirm, und nur für
Konten mit dem Recht `BANKVERBINDUNG_LESEN`. **Jeder Zugriff wird protokolliert**, mit Akteur,
Zeitpunkt und IP; das Audit-Log ist append-only, dieser Nachweis lässt sich also nicht nachträglich
entfernen. Seit Code-Review 4 steht dort ohne Klick nur „hinterlegt“ (keine Pseudomaske mehr), der
Klartext kommt über „vollständig anzeigen“ **per POST** (die Herkunftsprüfung greift) und nie aus einem
Cache (`Cache-Control: no-store`), und das Audit nennt die betroffene Person nur noch über ihre Id, nicht
mehr mit Namen.

### Formular-Builder und Anmeldung

`npm run pruefen` — damals **41 Prüfungen** der Fachlogik (heute läuft darüber `scripts/pruefe-alle.ts`
mit 1229 Prüfungen in 20 Skripten), alle bestanden (IBAN-Prüfsumme, Felddefinition,
Veröffentlichungsreife, Antwortprüfung, Art.-9-Sperre, IBAN nicht im Antwort-JSON, Entwurfs-Bereinigung,
Datums-Plausibilität).

Vier dieser Prüfungen bestanden vor dem Review **unabhängig von der geprüften Regel**: Der Testschlüssel
war ein einzelnes Zeichen und verletzte damit schon die Format-Regel, sodass `.length > 0` immer erfüllt
war. Sie prüfen jetzt auf die konkrete Meldung. Gegenprobe per Mutationstest — Dublettenregel
auskommentiert, Skript wird rot:

```bash
npm run pruefen
```

`npx tsx scripts/pruefe-einstellungen.ts` — 15 Prüfungen, alle bestanden (Lesen/Schreiben,
Grenzprüfung, Rückfallwert bei unlesbarem, außerhalb liegendem und fehlendem Wert, Gültigkeitstext).

Zusätzlich am laufenden Server durchgespielt:

| Prüfung | Ergebnis |
|---|---|
| `/verwaltung/formulare` ohne Sitzung | `307` auf `/anmelden` |
| `PUT /api/formulare/…` ohne Sitzung | `403`, keine Wirkung |
| Magic-Link für bekannte und unbekannte Adresse | identische Antwort — der Endpunkt verrät nicht, wer registriert ist |
| Magic-Link einlösen | `307` auf `/verwaltung`, Sitzungscookie gesetzt |
| Denselben Token ein zweites Mal einlösen | abgewiesen, Weiterleitung auf `/anmelden?fehler=ungueltig` |
| Entwurf öffnen bei veröffentlichter Fassung | Fassung 2 als Klon angelegt, 5 Abschnitte, 24 Felder, 6 Art.-9-Felder |
| Zwei Felder auf dasselbe Aktenfeld | `400` mit Angabe des kollidierenden Feldes |
| Textfeld auf Aktenfeld Geburtsdatum | `400`, Typ passt nicht |
| Veröffentlichen ohne E-Mail-Feld | `400` mit Mängelliste |
| Veröffentlichen einer gültigen Fassung | `200`, Fassung 1 wurde archiviert, Fassung 2 ist gültig |
| Veröffentlichte Fassung nachträglich ändern | `409`, unverändert |
| Audit-Spur des ganzen Vorgangs | 6 Einträge mit korrekter Client-IP |
| Geheimnisse im Audit-Log (IBAN, Token-Hashes) | keine |

### Einstellungen am laufenden Container

| Prüfung | Ergebnis |
|---|---|
| Anmeldelink bei Standardeinstellung | 30 Minuten gültig |
| Gültigkeit auf 240 Minuten gesetzt, neuen Link angefordert | 240 Minuten gültig — sofort wirksam, ohne Neustart |
| Text in der E-Mail bei 240 Minuten | „Der Link gilt 4 Stunden" — nicht „240 Minuten" |
| Wert über dem Maximum (525.600) | `400` mit Angabe des erlaubten Bereichs, Wert unverändert |
| Unbekannter Einstellungsschlüssel | `404`, keine neue Zeile angelegt |
| Änderung ohne Anmeldung | `403` |
| Audit-Eintrag der Änderung | `EINSTELLUNG_GEAENDERT` mit Alt- (30) und Neuwert (240) |

### Anmeldung von außen bis in die Akte

| Prüfung | Ergebnis |
|---|---|
| `/anmeldung` ohne Login | `200`, Formular aus der veröffentlichten Fassung |
| Abschnitt mit ausschließlich Art.-9-Fragen ohne Zustimmung | ausgeblendet mit Erklärung |
| Absenden ohne Pflicht-Einwilligungen | `400`, beide fehlenden namentlich benannt |
| Absenden ohne Art.-9-Zustimmung | `400`, kein stilles Verwerfen |
| IBAN mit Zahlendreher | `400`, Fehler am Feld `iban` |
| Gültige Anmeldung | Akte angelegt: E-Mail kleingeschrieben, Hörer aus dem Freitext erkannt, **IBAN verschlüsselt** (kein Klartext in der Spalte), Rolle `TEILNEHMER`, Status `INTERESSENT` mit Statuswechsel |
| Consent-Protokoll | beide Einwilligungen mit Textversion und **echter Client-IP** (`203.0.113.7`, nicht der Proxy) |
| Zweite Anmeldung auf dieselbe Adresse mit fremden Daten | neutrale `200`, keine zweite Person, **bestehende Daten unverändert** |
| Entwurf speichern und über den Link wieder aufrufen | Eingaben wiederhergestellt |
| Verwaltung wird über neue Anmeldung informiert | Mail an alle Personen mit Rolle `VERWALTUNG` |
| Aufnehmen durch die Schulleitung | Status `INTERESSENT → ANGENOMMEN`, Beitragslauf aktiv, Aufnahmemail |
| Ein zweites Mal über dieselbe Anmeldung entscheiden | `409` |
| Drosselung des öffentlichen Formulars | zweite Anfrage derselben IP `429`, andere IP weiterhin `200` |
| Geheimnisse im Audit-Log | keine |

### Semester, Teilnehmerliste und Excel-Export

`npx tsx scripts/pruefe-semesterlogik.ts` — **45 Prüfungen**, alle bestanden (Kalenderdatum,
Semesterplausibilität, Semesterwahl für eingehende Anmeldungen, Zeitzonenverhalten, Exportspalten).

Jede dieser Prüfungen ist per **Mutationstest** gegengeprüft: Regel entfernen, Skript muss rot werden.
Alle sechs Mutationen wurden erkannt.

| Entfernte Regel | Ergebnis |
|---|---|
| Anmeldeschluss inklusive letztem Tag (`>` → `>=`) | 1 Prüfung rot |
| „Ende muss nach Beginn liegen" | 2 Prüfungen rot |
| „Anmeldeschluss nicht nach Semesterende" | 1 Prüfung rot |
| Heutiger Tag aus örtlicher statt UTC-Zeit (unter `TZ=Europe/Berlin`) | 3 Prüfungen rot |
| IBAN-Spalte in den Export aufgenommen | 2 Prüfungen rot |
| `ibanVerschluesselt` in die Listenabfrage zurückgeholt | 1 Prüfung rot |

Unverändert unter `TZ=Europe/Berlin` **und** unter UTC: 45 Prüfungen, 0 fehlgeschlagen.

Danach der vollständige Durchstich gegen das Produktions-Image und eine frische Datenbank —
**38 Prüfungen, alle bestanden**:

| Prüfung | Ergebnis |
|---|---|
| Spalte, Index und Fremdschlüssel `anmeldungen.semesterId` | vorhanden, `ON DELETE SET NULL` (gegen `information_schema` und `pg_constraint` geprüft, nicht gegen die Erfolgsmeldung) |
| Recht `SEMESTER_VERWALTEN` nach dem Seed | vorhanden, bei Schulleitung und Verwaltung, **nicht** bei Teilnehmern |
| Semester anlegen mit `istAktuell` | `201`, genau ein laufendes Semester |
| Semesterende vor Semesterbeginn | `400` mit Feldbezug |
| Kürzel ein zweites Mal vergeben | `409` |
| Öffentliche Anmeldung während des Anmeldefensters | Anmeldung hängt am angelegten Semester, IBAN weiterhin nicht im Antwort-JSON |
| Aufnahme durch die Schulleitung | Teilnahme im Semester angelegt, Teilnahmeform `SCHUELER` übernommen, Rückmeldung `semesterZugeordnet: true` |
| Sammelübernahme | 1 übernommen, 1 ohne Teilnahmeform **gemeldet statt geraten**, Schulleitung nicht mitgezählt |
| Sammelübernahme ein zweites Mal | 0 übernommen, nichts doppelt |
| Excel-Export | `200`, gültige Mappe, beide Teilnehmer enthalten, Person ohne Teilnahmeform nicht enthalten |
| IBAN in der Excel-Datei | **keine** |
| Teilnehmer-Konto legt Semester an / exportiert | `403` / `403` |
| Export ohne Sitzung | `403` |
| Audit-Spur | `SEMESTER_ANGELEGT`, `ANMELDUNG_EINGEREICHT`, `ANMELDUNG_ANGENOMMEN`, `SEMESTER_TEILNEHMER_UEBERNOMMEN`, `TEILNEHMERLISTE_EXPORTIERT` — ohne IBAN |
| `/verwaltung/semester` und `/verwaltung/teilnehmer` im Browser | `200`, laufendes Semester, Anmeldefenster, beide Teilnehmer, keine IBAN im Quelltext |

### Schülerakte mit Selbstpflege

`npx tsx scripts/pruefe-eigene-daten.ts` — **29 Prüfungen**, alle bestanden (Stammdaten, IBAN-Regel,
E-Mail-Regel, Änderungserkennung).

Auch hier ist jede Regel per **Mutationstest** gegengeprüft:

| Entfernte Regel | Ergebnis |
|---|---|
| „Die neue Adresse muss sich von der bisherigen unterscheiden" | 2 Prüfungen rot |
| IBAN-Prüfsumme abgeschaltet | 1 Prüfung rot |
| Format der Telefonnummer | 1 Prüfung rot |
| Leeres IBAN-Feld nicht mehr als „unverändert" behandelt | 1 Prüfung rot |
| Nicht mitgeschicktes Feld gilt als Änderung | 1 Prüfung rot |
| E-Mail-Feld in die Sofort-Speicherung geschmuggelt | 1 Prüfung rot |

Der Durchstich deckt die Kette mit ab — **65 Prüfungen insgesamt, alle bestanden**:

| Prüfung | Ergebnis |
|---|---|
| Teilnehmer ruft `/meine-daten` auf | `200` mit eigener Akte, Semester und Teilnahmeform |
| Teilnehmer ruft `/verwaltung` auf | `307` auf `/meine-daten` statt leerer Seite |
| Adresse und Telefon ändern | gespeichert, Rückmeldung nennt die geänderten Felder |
| Speichern mit **leerem** IBAN-Feld | Bankverbindung unverändert (verschlüsselter Wert byte-gleich) |
| Neue IBAN eintragen | verschlüsselt gespeichert, kein Klartext in der Spalte, Verwaltung informiert |
| Unsinnige Telefonnummer und IBAN | `400`, nichts gespeichert |
| Selbstpflege ohne Sitzung | `403` |
| Neue E-Mail-Adresse beantragen | `200`, **Adresse in der Akte zunächst unverändert**, Antrag hinterlegt, nur der SHA-256-Hash gespeichert |
| Eigene Adresse erneut beantragen | `400` |
| Bereits vergebene Adresse beantragen | dieselbe Antwort wie sonst, **kein** Antrag angelegt, Hinweis an die Verwaltung, Protokolleintrag |
| Bestätigungslink einlösen (ohne Sitzung, anderes Gerät) | `200`, ab jetzt gilt die neue Adresse |
| Denselben Link ein zweites Mal | `401` |
| Abgelaufener Link | `401`, Adresse unverändert |
| Audit-Spur | `EIGENE_DATEN_GEAENDERT` mit Alt- und Neuwert, `EMAIL_AENDERUNG_BEANTRAGT`, `EMAIL_AENDERUNG_BESTAETIGT` — ohne IBAN |
| `/meine-daten` im Browser | Akte, Semester, „Bestätigungslink anfordern", **keine IBAN im Quelltext** |

### Zugang wiederherstellen

Die 16 Prüfungen zum Hilfeformular laufen in `pruefe-eigene-daten.ts` mit (45 Prüfungen insgesamt).
Auch sie sind per **Mutationstest** gegengeprüft:

| Entfernte Regel | Ergebnis |
|---|---|
| „Ohne Erreichbarkeit keine Meldung" | 1 Prüfung rot |
| Warnhinweis „Angaben sind ungeprüft" aus der Meldung entfernt | 1 Prüfung rot |
| `prisma.person.update` in die öffentliche Route geschmuggelt | 1 Prüfung rot |

Im Durchstich (damals 87 Prüfungen, inzwischen 150 — **alle bestanden**):

| Prüfung | Ergebnis |
|---|---|
| Meldung ohne Erreichbarkeit | `400` |
| Vollständige Meldung | `200`, Schulleitung benachrichtigt, Protokolleintrag, **kein Konto verändert** |
| Meldung für einen Namen, den es nicht gibt | **exakt dieselbe Antwort** |
| Personenliste als Teilnehmer | `307` |
| Adresse eines fremden Kontos als Teilnehmer ändern | `403` |
| Auf eine bereits vergebene Adresse ändern | `409` |
| Adressänderung durch die Verwaltung | neue Adresse in der Akte, **beide** Adressen benachrichtigt |
| Offener Änderungsantrag der Person | entwertet — der alte Bestätigungslink läuft danach auf `401` |
| Anmeldelink verschicken | `200`, neuer Link entsteht, geht an die hinterlegte Adresse |
| Anmeldelink für ein Konto im Endzustand | `409` mit Begründung statt stillem Nichtstun |
| `/anmelden`, `/anmelden/hilfe`, `/verwaltung/personen` im Browser | `200`, Suche grenzt korrekt ein |

---

## Verifikationslauf vom 28.07.2026

Der am 27.07. an der vollen Festplatte gescheiterte Lauf, nachgeholt. Zuerst musste Docker wieder
arbeiten können: Der **Build-Cache belegte 29,9 GB**, nach `docker builder prune -af` sanken die
Images von 36,9 auf 12,2 GB. Bewusst **kein** `prune --volumes` — auf derselben Docker-Instanz liegen
die Dev-Datenbanken anderer Projekte.

| Prüfung | Ergebnis |
|---|---|
| `docker build --target builder` | Exit 0 — und damit die Typprüfung des gesamten Standes, den sechs Agenten ohne mitlesenden Compiler geschrieben hatten. Kein einziger Typfehler. |
| `npm run pruefen` im Image | **179 Prüfungen, 0 fehlgeschlagen** (43 Formular + 54 Semester + 46 Selbstpflege + 36 Passwort; Stand 28.07., heute 1229 in 20 Skripten) |
| Mutationstests `src/lib/passwort.ts` | **14 Mutationen, 14 wie erwartet** — siehe unten |
| `docker build` (Produktions-Image) | Exit 0 |
| `bash scripts/durchstich.sh` | **150 Prüfungen, 0 fehlgeschlagen** |

Die Fachlogik-Skripte melden am Ende selbst, ob alle Prüfungen gelaufen sind. Der Durchstich hatte
diese Absicherung nicht — sie ist jetzt nachgetragen (`SOLL=150`), damit ein Lauf, der unterwegs
einen Block überspringt, nicht weiterhin „0 fehlgeschlagen" meldet.

### Mutationstests der Passwortlogik

Regel 2 des Projekts: Eine Prüfung beweist erst dann etwas, wenn sie rot wird, sobald man die
geprüfte Regel entfernt. Jede Mutation lief im Image, die Arbeitskopie blieb unangetastet.

| Entfernte Regel | Ergebnis |
|---|---|
| Mindestlänge | rot |
| Höchstlänge | rot |
| „eigene Adresse ist kein Passwort" | rot |
| `trim()` in die Längenprüfung eingebaut | rot |
| Hashvergleich entfernt, nur noch Länge verglichen | rot |
| Salz festgenagelt statt `randomBytes` | rot |
| Formatprüfung des gespeicherten Werts | rot |
| Laufzeitausgleich rechnet nicht mehr | rot |
| Ausgleich im Endpunkt nicht mehr aufgerufen | rot |
| Drossel entfernt | rot |
| Drossel **hinter** die Passwortprüfung verschoben | rot |
| eigener Fehlertext bei falschem Passwort | rot |
| Speichergrenze `MAXMEM` allein | **grün — begründet, siehe unten** |
| Speichergrenze **und** `maxmem` aus dem Datensatz | rot |

### Zwei Lücken, beide in den Prüfskripten

**1. Die Speichergrenze war von keiner Prüfung gedeckt.** Der Mutationslauf hat es gezeigt: Nimmt man
`if (128 * n * r > MAXMEM)` heraus, fällt keine Prüfung um. Der Grund ist gutartig — Node prüft
`maxmem` selbst, bevor es Speicher belegt, und weist mit `ERR_CRYPTO_INVALID_SCRYPT_PARAMS` ab. Der
Schutz liegt also doppelt, und tragend ist nicht die Grenze, sondern die **Konstante** `maxmem: MAXMEM`.
Gemessen an einem gespeicherten Wert mit N = 2²²:

| Variante | Verhalten |
|---|---|
| unverändert | abgewiesen nach **0,8 ms** |
| nur die Grenze entfernt | Node weist selbst ab, **4 ms** |
| Grenze entfernt **und** `maxmem` aus dem Datensatz gezogen | **15.866 ms** und 4 GB Arbeitsspeicher — für einen einzigen Anmeldeversuch |

Ergänzt wurden deshalb zwei Prüfungen: dass aufgeblasene Kostenparameter abgewiesen werden, und dass
die Abweisung **keine scrypt-Runde kostet** (Verhältnis zur echten Prüfung, nicht feste Millisekunden).
Die zweite wird bei der Doppelmutation rot. Dass die Einzelmutation grün bleibt, steht als Begründung
im Skript — sonst entfernt sie beim nächsten Mal jemand als wirkungslos.

**2. „Ohne erkennbare Herkunft wird abgewiesen" konnte nie feuern.** Die Prüfung ließ den
Herkunftsheader weg und erwartete `429`. Bekommen hat sie `200` — eine erfolgreiche Anmeldung. Ursache:
**Fehlt der Header ganz, setzt Next.js selbst ein `X-Forwarded-For` mit der TCP-Gegenstelle ein.**
Nachgemessen am laufenden Container:

| Anfrage | Antwort | protokollierte Herkunft |
|---|---|---|
| `X-Real-Ip: 198.51.100.77` | `401` | `198.51.100.77` |
| kein Herkunftsheader | `401` | `203.0.113.10` ← von Next.js eingesetzt |
| `X-Forwarded-For: 9.9.9.9` | `401` | `9.9.9.9` — Next.js hängt nichts an einen vorhandenen Header an |
| `X-Forwarded-For` **leer** mitgeschickt | `429` | `NULL` ← die Sperre greift |

Der Code war also richtig, die Prüfung falsch. Sie schickt den Header jetzt leer mit — das ist
zugleich der realistische Fall: Proxy vorhanden, gibt aber nichts weiter. Dazu kam eine zweite Zeile,
die die **Ursache** pinnt: `429` allein beweist nichts, weil auch die Adress- und die Anschlussdrossel
mit `429` antworten und Petra vorher schon Fehlversuche gesammelt hat. Nur der Zweig `!ipAdresse`
schreibt `PASSWORT_ANMELDUNG_GEDROSSELT` **ohne** IP-Adresse ins Audit-Log; genau darauf prüft sie.

Gegenprobe mit echter Mutation: `!ipAdresse ||` aus der Route entfernt, Image neu gebaut, Durchstich
gelaufen — **beide Zeilen rot, Anmeldung mit `200` durchgelassen**. Danach zurückgenommen und neu
gebaut, Durchstich wieder 150/150.
