# GBS Campus

Verwaltungssoftware der Gemeindebibelschule Minden · Christliches Werk Esra e.V.

Der fachliche Bauplan steht in [`../1_Bauplan.html`](../1_Bauplan.html) — dieses README beschreibt nur,
wie man den Code startet und was bereits steht.

**Neu hier?** [`UEBERGABE.md`](UEBERGABE.md) ist der Einstieg: in fünf Minuten lauffähig, die Fallen
dieser Umgebung, die feststehenden Entscheidungen und was als Nächstes gebaut wird.

**Aktueller Baustand (Release 0.1):**

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
  Anmelde- und Auskunftslink tragen den Token jetzt im URL-Fragment (nicht im Query-String, kein Log-Leak)
- **Semesterüberleitung / Re-Enrollment (Release 0.2)** — `/verwaltung/semesterueberleitung`: den
  Jahrgang des laufenden Semesters ins Folgesemester einladen. Jeder aktive Teilnehmer bekommt einen
  persönlichen „Ich bin dabei"-Link (`/dabei/token`, Token im Fragment, ohne Login — er setzt nur
  `Teilnahme.bestaetigtAm`, meldet niemanden an). Wer nicht zusagt, wird T−14/−7/−3 Tage vor
  Semesterstart automatisch erinnert (konfigurierbar, Bereich SEMESTER). Der Erinnerungslauf ist
  idempotent (kein Doppelversand) und läuft im `worker`-Container (siehe unten); der HTTP-Endpunkt
  `POST /api/cron/erinnerungen` (per `CRON_SECRET`) bleibt zusätzlich fürs manuelle Auslösen.
  Logik in `src/lib/ueberleitung.ts`, DB-freie Kernlogik in `src/lib/semester.ts`.
- **Worker-Container (Release 0.2)** — eigener docker-compose-Dienst `worker` (gleiches Image, Einstieg
  `node worker.js`), der die Überleitungs-Erinnerungen und den DSGVO-Aufräumlauf **stündlich und
  idempotent** ausführt (`scripts/worker.ts`). Damit braucht es keinen externen Zeitgeber mehr. Der
  Worker wartet beim Start auf die Migrationen und fährt bei `SIGTERM` sauber herunter.
- **Löschkonzept nach Art. 17 DSGVO (Release 0.2)** — `/verwaltung/personen` → „Anonymisieren" (Recht
  `PERSON_ANONYMISIEREN`, nur Schulleitung). Weil Audit-Log und Einwilligungen append-only sind und als
  Nachweis (Art. 7 Abs. 1) erhalten bleiben müssen, wird **nicht gelöscht, sondern anonymisiert**: alle
  personenbezogenen Felder der Person UND die Anmelde-Antworten (`antworten`-JSON, inkl. Name/Adresse/
  IBAN/Art.-9-Angaben) werden überschrieben, transiente Token-Datensätze gelöscht, der Status auf den
  Endzustand `ANONYMISIERT` gesetzt. Teilnahmen/Anwesenheiten/Einwilligungen bleiben ohne Personenbezug.
  Das Audit protokolliert die Anonymisierung **ohne** die alten Werte. Logik in `src/lib/anonymisierung.ts`
  (DB-frei) und `src/lib/anonymisierung-io.ts` (Transaktion).
- **Fächer & Kursraster (Release 0.2, Grundstein Stundenplan M3)** — die sieben Fächer und das feste
  3-Jahres-Raster (13 Kurseinheiten) aus der Kursübersicht von gbs-minden.de als Seed
  (`prisma/kursraster-definition.ts`), sichtbar unter `/verwaltung/faecher`. Konkrete Semester sind
  über `lehrjahr`/`halbjahr` ans Raster gekoppelt — die „bin dabei"-Seite zeigt so die Fächer des
  Zielsemesters. Die **sechs realen Semester** (2026-H … 2029-F) legt jetzt ein frischer `db:seed` an.
- **Stundenplan & Anwesenheit (Release 0.2, M3)** — `/verwaltung/stundenplan`: die Unterrichtsabende
  eines Semesters (die zehn Dienstagabende ab Semesterbeginn per Knopf), jeder optional einer
  Kurseinheit zugeordnet. **Anwesenheit** je Teilnahme × Termin (anwesend / entschuldigt / gefehlt /
  nachgearbeitet) und die **Quote**: anwesend und nachgearbeitet zählen als teilgenommen, unter der
  Schwelle (`ANWESENHEIT_MINDEST_PROZENT`, Standard 80 %) wird sie markiert. DB-freie Kernlogik in
  `src/lib/stundenplan.ts` (Quote + Dienstags-Generator), IO in `src/lib/stundenplan-io.ts`.

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

Als Nächstes: Laientest durch eine projektfremde Person, erstes Semester anlegen, dann der Livegang
am 20.08.

---

## Entwicklung starten

```bash
docker start gbs-campus-db-dev || docker run -d --name gbs-campus-db-dev -e POSTGRES_DB=gbs_campus -e POSTGRES_USER=gbs -e POSTGRES_PASSWORD=gbs_dev_2026 -p 5434:5432 postgres:16-alpine
```

```bash
cd gbs-campus && export DATABASE_URL="postgresql://gbs:gbs_dev_2026@localhost:5434/gbs_campus?schema=public" && export ENCRYPTION_KEY="$(openssl rand -hex 32)" && npm run dev
```

Port 5434 ist bewusst gewählt — 5433 ist anderweitig belegt.

Für einen dauerhaften Entwicklungsstand die `.env.example` nach `.env` kopieren und ausfüllen; ein
frisch erzeugter `ENCRYPTION_KEY` macht bereits verschlüsselte Felder unlesbar.

| Befehl | Wirkung |
|---|---|
| `npm run dev` | Entwicklungsserver auf Port 3000 |
| `npm run build` | Produktionsbuild (Standalone) |
| `npm run typecheck` | TypeScript ohne Emit prüfen |
| `npm run db:migrate` | Migration erzeugen und einspielen |
| `npm run db:deploy` | Migrationen einspielen (Produktion) |
| `npm run db:seed` | Grunddaten setzen — idempotent, mehrfach ausführbar |
| `npm run db:studio` | Prisma Studio |
| `npm run pruefen` | 329 Prüfungen der Fachlogik (Formular, Semester, Selbstpflege, Zugang, Passwort, Auskunft/PDF, Beitrag, Fächer, Stundenplan, Selbstbestätigung, Honorar, Anonymisierung), ohne Datenbank |
| `bash scripts/durchstich.sh` | 248 Prüfungen gegen das gebaute Image und eine frische Datenbank |
| `npm run pruefen:db` | 30 Prüfungen (Einstellungen + Auskunft-Roundtrip inkl. Verstorbenen-Sperre), **braucht** eine Datenbank |

> Die Typprüfung und der Build hängen auf diesem Rechner regelmäßig, weil Synology Drive und iCloud
> den Projektordner samt `node_modules` synchronisieren. Im Zweifel über den Docker-Build verifizieren.
> Einzelheiten in [`UEBERGABE.md`](UEBERGABE.md).

---

## Produktivbetrieb

```bash
cp .env.example .env && docker compose up -d --build
```

Der Stack besteht aus **traefik** (TLS, Let's Encrypt), **app** (Next.js Standalone), **db**
(PostgreSQL 16) und **backup** (nächtlicher Dump). Zwei Netze: `edge` mit Internetzugang, `data` mit
`internal: true` — die Datenbank hat weder Internetzugang noch einen Port nach außen.

Die Anwendung läuft unter **`gbs.fes-credo.de`** (in `.env.example` eingetragen).

**Vor dem ersten Start noch auszufüllen:** `ACME_EMAIL`, `DB_PASSWORD`, `SESSION_SECRET`,
`ENCRYPTION_KEY` sowie die SMTP-Zugangsdaten samt Absenderadresse. Ohne korrekte `APP_URL` erzeugt die
Anwendung Magic-Links auf `localhost` — und da der Magic-Link der einzige Kontoschlüssel ist, kommt
dann niemand mehr hinein.

**SPF, DKIM und DMARC gelten für die Absenderdomain**, also für die Domain hinter
`MAIL_ABSENDER_ADRESSE`. Die muss nicht mit `APP_DOMAIN` übereinstimmen. Vor dem Livegang gegen GMX,
web.de, Gmail und Outlook prüfen, ob der Magic-Link im Posteingang landet und nicht im Spam.

### Bewusste Abweichungen von der Planungsskizze

- **Kein Redis.** Magic-Links sind über die Spalte `benutztAm` in Postgres single-use, Rate-Limiting
  läuft über die Tabelle `rate_limit`. Bei 150 Konten reicht das und spart einen Container im
  Notfall-Runbook.
- **Kein Worker-Container.** Es gibt in Release 0.1 noch keine zeitgesteuerten Aufgaben. Er kommt mit
  Release 0.2, wenn die Re-Enrollment-Trigger entstehen.

---

## Was im Fundament steckt

### Statusmaschine als Tabelle, nicht als Enum

`teilnehmer_status` trägt pro Zustand fünf Schalter: `istAktiv`, `istTerminal`, `beitragLaeuft`,
`anwesenheitZaehlt`, `automatikMails`. Jede Automatik fragt diese Schalter ab, statt Status-Codes
im Code aufzuzählen. `VERSTORBEN` hat alle Automatik-Schalter auf `false` — ein harter Not-Aus, damit
keine Mahnung und keine Erinnerung Hinterbliebene erreicht. Neue Zustände lassen sich ohne Deploy
ergänzen.

### Rechtematrix als Daten

`rollen`, `rechte` und `rolle_recht` liegen in der Datenbank. Sechs Rollen, 18 Rechte,
34 Zuordnungen. Die Codes stehen zusätzlich in `src/lib/constants.ts` — ein Tippfehler in einem
Recht-String erzeugt sonst keinen Compile-Fehler, sondern lautlosen Rechteentzug. Bewusst getrennt: `FINANZ_DATEN_LESEN` (Beitragsstatus) und
`BANKVERBINDUNG_LESEN` (IBAN) — der Schulleiter sieht den Status, die IBAN sieht nur die Verwaltung.

Die Rollen `DOZENT` und `GASTDOZENT` sind angelegt, aber über `aktivAbRelease = "0.2"` markiert. Sie
werden vor dem ersten Unterrichtsabend nicht gebraucht, und ihr Wegfall halbiert den Aufwand für das
serverseitige Row-Level-Scoping in 0.1.

### Audit-Log wirklich append-only

Nicht per Konvention, sondern per Datenbank-Trigger: `UPDATE` und `DELETE` auf `audit_log` scheitern
mit einer Fehlermeldung — auch aus der Anwendung heraus, auch für den Administrator. Dasselbe gilt
für `einwilligungen`, denn ein nachträglich änderbares Consent-Protokoll ist als Nachweis nach
DSGVO Art. 7 Abs. 1 wertlos. Ein Widerruf ist eine neue Zeile mit `erteilt = false`.

Ehrliche Grenze: Der Append-only-Schutz ist nur so stark wie die Trennung der Datenbankrechte.
Vollständig absichern ließe sich das nur mit einem getrennten, rechtebeschränkten Datenbanknutzer —
das ist der nächste Härtungsschritt, nicht Teil von Release 0.1.

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
nur ausgeblendet.

Bedienung ohne Ziehen und Fallenlassen: Verschieben läuft über Pfeiltasten. Das ist mit Tastatur und
Vorlesesoftware bedienbar (WCAG 2.1 AA) und funktioniert auf dem Tablet.

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
geschrieben (ohne Neuladen), gespeichert wird nur sein SHA-256-Hash. Mit dem Absenden verfällt er.

Die Absage bei einer Ablehnung verschickt das System **nicht** automatisch — sie hält nur den internen
Grund fest. Eine Absage an jemanden, der sich für eine Bibelschule beworben hat, formuliert der
Schulleiter selbst; das war die ausdrückliche Linie im Interview.

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
nachträglich umgebaut werden muss.

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
die Anwendung verlassen.

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
Adressänderung nebenbei den Beitragseinzug lahmgelegt.

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
Zugang betrifft.

### Sichtbarkeit: was der Betrieb sehen können muss

Der Leitsatz aus dem ersten Review — **was der Betrieb nicht sehen kann, ist kaputt** — hat im zweiten
Review drei weitere Stellen getroffen. Alle drei sind jetzt sichtbar:

| Stiller Ausfallpfad | Wo er jetzt auftaucht |
|---|---|
| Mail hängt auf `WARTEND` (Prozess starb zwischen Anlegen und Abschließen der Protokollzeile) | Betriebsansicht, eigener Abschnitt „seit mehr als fünf Minuten wartend" |
| Niemand hat die Rolle Schulleitung oder Verwaltung — Meldungen erreichen keinen Menschen | Betriebsansicht, Kennzahl „Empfänger für Verwaltungsmeldungen", rot bei null; zusätzlich hinterlässt `lib/verteiler.ts` eine FEHLER-Zeile |
| Aufräumlauf tot (einzige Löschmechanik für Anmeldeentwürfe, Art. 5 Abs. 1 lit. e DSGVO) | Betriebsansicht, „zuletzt aufgeräumt", rot ab 48 Stunden; jeder Lauf schreibt `AUFRAEUMEN_GELAUFEN` ins Audit-Log |

Dazu neu: **`/verwaltung/protokoll`** liest das Audit-Log, das bisher zwar geschrieben, aber von keiner
Oberfläche gelesen wurde. Damit werden die stillen Vorgänge sichtbar — abgewiesene Adressänderungen,
Meldungen aus dem Hilfeformular, fehlgeschlagene Passwortanmeldungen, Eingriffe der Verwaltung in
fremde Konten. Alt- und Neuwerte stehen nur eingeklappt: dort können personenbezogene Daten liegen.
Das Recht `AUDIT_LESEN` hat neben dem Administrator jetzt auch die Schulleitung — bei Bus-Faktor 1
darf die Sichtbarkeit nicht an einem einzigen Konto hängen.

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

### Dozentenhonorar (Release 0.2)

Die Rolle **Dozent** ist scharfgeschaltet: Jeder Unterrichtsabend lässt sich im Stundenplan einem
Dozenten zuordnen (neues Feld `Unterrichtstermin.dozentId → Person`, `onDelete: SetNull` — ein
gelöschtes Dozentenkonto reißt den Abend nicht mit). Die Zuordnung läuft über die bestehende
Termin-PUT und ist damit an `SEMESTER_VERWALTEN` gebunden; serverseitig wird geprüft, dass die Person
die Rolle Dozent trägt (`istDozent`), sonst 400. Die read-only Übersicht `/verwaltung/honorar`
(Recht `HONORAR_LESEN`, Bereich Finanzen) rechnet je Dozent **Anzahl gehaltener Abende × Honorarsatz**;
der Satz ist eine Einstellung (`HONORAR_SATZ_PRO_ABEND`, ganzzahlig, Bereich Finanzen), kein Wert im
Code. Die eigentliche **Abrechnung** — Freigabe und Auszahlung — ist bewusst auf Release 0.3
verschoben; 0.2 liefert nur die Übersicht.

Die Migration ist wie alle hier **von Hand** geschrieben und rein additiv (`ADD COLUMN` / `CREATE INDEX`
/ `ADD CONSTRAINT`, keine `DROP`s) — `prisma migrate dev` würde sonst den partiellen Unique-Index des
laufenden Semesters und die Append-only-Trigger als DROP mit aufnehmen.

---

## Verifiziert

> **Der Abschnitt deckt inzwischen den ganzen Code ab.** Die Nachweise unten stammen vom Stand vor
> dem Passwortweg; der Rest — Passwortweg und sämtliche Fixes aus dem zweiten Review — ist am
> 28.07.2026 nachgeholt worden und steht in „Verifikationslauf vom 28.07.2026" weiter unten.
> Gemessen, nicht behauptet.

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
| **Builder unbeschriftet** | 6 Beschriftungen je Zeile ohne `htmlFor` | durchgängige IDs, 44-px-Trefferflächen, Rückfrage vor dem Löschen, stabile Schlüssel |
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
Zeitpunkt, IP und Namen der betroffenen Person; das Audit-Log ist append-only, dieser Nachweis lässt
sich also nicht nachträglich entfernen.

### Formular-Builder und Anmeldung

`npm run pruefen` — **41 Prüfungen** der Fachlogik, alle bestanden (IBAN-Prüfsumme, Felddefinition,
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
| `npm run pruefen` im Image | **179 Prüfungen, 0 fehlgeschlagen** (43 Formular + 54 Semester + 46 Selbstpflege + 36 Passwort) |
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
