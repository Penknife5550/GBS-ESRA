# GBS Campus — Code-Review 4 (GoLive-Review)

**Datum:** 27.09.2026 · **Stand:** `main` bei Commit `19bab19` (01.08.2026) · **Sprache:** TypeScript (Next.js 15, Prisma 6, PostgreSQL 16) + Docker Compose

**Methode:** Sieben Spezialprüfer (Security, UI/UX, Performance, Architektur, Testing, Fehlerbehandlung,
Codequalität) plus ein Lückenprüfer haben den ganzen Codestand gelesen. Jeder CRITICAL/MAJOR-Befund wurde danach von einem
unabhängigen Prüfer gezielt zu widerlegen versucht (Code-Pfad, Absicherung an anderer Stelle, dokumentierte
Entscheidung). **Ergebnis der Gegenprüfung: 34 schwere Befunde geprüft, 0 widerlegt, 10 auf MINOR herabgestuft.**
MINOR- und INFO-Befunde stammen von je einem Prüfer und sind **nicht** gegengeprüft.

**Nicht gemacht:** kein Build, kein Testlauf, kein Durchstich — reine Lektüre (der Ordner liegt in einem Sync-Dienst,
siehe UEBERGABE.md „Fallen“). Aussagen zum Laufzeitverhalten sind aus dem Code abgeleitet.

---

## GoLive-Status: 🟡 BEDINGT BEREIT

Kein CRITICAL-Befund. Der Sicherheitskern ist stark (kein IDOR in den neuen Routen, vorbildliches Token- und
Passworthandling, keine Formel-/PDF-/Header-Injection, Append-only echt durchgesetzt). Es gibt aber **19 eindeutige
MAJOR-Befunde**. Drei davon können den Betrieb komplett lahmlegen (Traefik-Netz, `APP_DATABASE_URL`,
Seed-Crash-Loop) und zwei betreffen die Löschzusage nach Art. 17. Diese gehören vor bzw. — falls das System seit dem
20.08. bereits live ist — sofort behoben.

---

## Findings-Übersicht

| Bereich | CRITICAL | MAJOR | MINOR | INFO |
|---|---:|---:|---:|---:|
| 🔐 Security | 0 | 3 | 8 | 3 |
| 🎨 UI/UX | 0 | 6 | 14 | 3 |
| ⚡ Performance | 0 | 0 | 3 | 3 |
| 🏗️ Architektur | 0 | 4 | 8 | 3 |
| ✅ Testing | 0 | 2 | 10 | 2 |
| 🛡️ Fehlerbehandlung | 0 | 2 | 10 | 2 |
| 💎 Codequalität | 0 | 2 | 14 | 2 |
| 🔎 Lückenprüfer | 0 | 5 | 11 | 1 |
| **Summe** | **0** | **24** | **78** | **19** |

Die 24 MAJOR enthalten Mehrfachmeldungen desselben Problems aus verschiedenen Blickwinkeln (Anonymisierung ×4,
Formular-Builder-Keys ×2, Statusmaschine ×2). **Zusammengeführt sind es 19.**

---

## GoLive-Checkliste (alle 19 MAJOR)

Betrieb — kann das Portal komplett lahmlegen:
- [ ] M1 Traefik-Netz festlegen — `gbs-campus/docker-compose.yml:93`
- [ ] M2 `APP_DATABASE_URL` nur bei gesetztem `APP_DB_PASSWORD` — `gbs-campus/docker-compose.yml:81`
- [ ] M3 Seed überschreibt Semesterdaten, Crash-Loop bei umbenanntem Semester — `gbs-campus/prisma/seed.ts:767`

Sicherheit und Datenschutz:
- [ ] M4 Abmelden wirkt in Produktion nicht — `gbs-campus/src/lib/session.ts:72`
- [ ] M5 Kein CSRF-Schutz über SameSite hinaus — `gbs-campus/src/app/api/meine-daten/email/route.ts:23`
- [ ] M6 Anonymisierung (Art. 17) unvollständig: Zeugnisse, Mail-Betreffs, Audit — `gbs-campus/src/lib/anonymisierung-io.ts:44`
- [ ] M7 Offene Anmeldung einer anonymisierten Person lässt sich annehmen — `gbs-campus/src/app/api/anmeldungen/[id]/entscheiden/route.ts:77`
- [ ] M8 Einwilligungstexte werden vom Seed überschrieben (Art. 7 Nachweis) — `gbs-campus/prisma/seed.ts:684`

Fachliche Lücken:
- [ ] M9 Statusmaschine nicht bedienbar, Ausbildungsdaten nicht änderbar — `gbs-campus/prisma/seed.ts:209`, `gbs-campus/src/components/personen/person-aktionen.tsx:375`
- [ ] M10 Semesterüberleitung: kein „bin raus“, kein Herausfallen — `gbs-campus/src/lib/teilnehmerliste.ts:26`
- [ ] M11 Abgerechnete Abende per PUT umhängbar — `gbs-campus/src/app/api/stundenplan/termine/[id]/route.ts:37`
- [ ] M12 Fehlgeschlagener DMS-Beleg nicht nachholbar — `gbs-campus/src/lib/honorar-abrechnung-io.ts:366`
- [ ] M13 Aufnahme ohne Einsicht in die Anmeldeantworten — `gbs-campus/src/app/verwaltung/anmeldungen/page.tsx:39`

Bedienung:
- [ ] M14 „Alle ausstellen“ (Zeugnisse) ohne Rückfrage, kein Storno — `gbs-campus/src/app/verwaltung/zeugnisse/zeugnis-client.tsx:45`
- [ ] M15 Formular-Builder: Fokusverlust nach jedem Tastendruck, fehlende Labels — `gbs-campus/src/app/verwaltung/formulare/formular-builder.tsx:262`
- [ ] M16 Formular-Builder: Antwortmöglichkeiten lassen sich nicht tippen — `gbs-campus/src/app/verwaltung/formulare/formular-builder.tsx:527`
- [ ] M17 Formular-Builder zeigt Schüler/Hörer-Zuordnung nicht, Speichern scheitert — `gbs-campus/src/app/verwaltung/formulare/[versionId]/page.tsx:27`
- [ ] M18 Noten-Detailakte: „nicht bewertet“ wird still verworfen — `gbs-campus/src/components/personen/noten-inline.tsx:69`

Tests:
- [ ] M19 Durchstich kalenderabhängig, laut Code seit 22.09.2026 rot — `gbs-campus/scripts/durchstich.sh:1107`

---

## Detaillierte MAJOR-Befunde

Status „bestätigt“ heißt: Der Gegenprüfer hat den Befund am Code nachvollzogen und keine Absicherung gefunden.

### M1 · Traefik-Routing hängt am Zufall — Betrieb · bestätigt
**Fundstelle:** `gbs-campus/docker-compose.yml:93` (Netze der App), `:28-41` (Traefik-Befehl), `:96-101` (Labels)
**Problem:** Die App hängt in `edge` und `data`, Traefik nur in `edge`. Weder `--providers.docker.network` noch das Label
`traefik.docker.network` ist gesetzt. Traefik wählt dann irgendeine IP des Containers; erwischt es die aus `data`
(`internal: true`), laufen alle Anfragen in einen 504.
**Risiko:** Totalausfall, der je nach Neustart auftritt oder verschwindet. Der Durchstich testet direkt gegen den
App-Container, nie über Traefik.
**Fix:** Netz benennen (`networks: edge: name: gbs_edge`) und `--providers.docker.network=gbs_edge` bzw. das Label an
`app` setzen. Vor dem Livegang den ganzen Stack mit TLS und mehreren Neustarts durchspielen.

### M2 · `APP_DATABASE_URL` ist immer gesetzt — Betrieb · bestätigt
**Fundstelle:** `gbs-campus/docker-compose.yml:81`, `gbs-campus/docker/entrypoint.sh:29`
**Problem:** Compose setzt `APP_DATABASE_URL=postgresql://gbs_app:${APP_DB_PASSWORD}@…` ohne Bedingung. Bei leerem
Passwort entsteht ein nicht leerer String, der Entrypoint schaltet trotzdem auf `gbs_app` um — die Rolle wurde aber
gar nicht angelegt.
**Risiko:** Wer der Doku folgt („bleibt es leer, ändert sich nichts“, `.env.example`, UEBERGABE.md), bekommt einen
Server ohne jeden DB-Zugriff: Login, Anmeldung und Health-Check fallen aus.
**Fix:** Im Entrypoint an das Passwort koppeln
(`if [ -n "${APP_DB_PASSWORD:-}" ]; then export DATABASE_URL=…gbs_app…; fi`) und die Zeile aus Compose entfernen —
oder `APP_DB_PASSWORD` in `src/lib/konfiguration.ts` zur Pflicht machen.

### M3 · Seed setzt Semester bei jedem Start zurück, Crash-Loop möglich — Betrieb · bestätigt
**Fundstelle:** `gbs-campus/prisma/seed.ts:767-777`
**Problem:** Der Seed läuft bei jedem Containerstart und überschreibt per `upsert` Bezeichnung, Start und Ende der
sechs Semester. In der Oberfläche korrigierte Daten sind nach dem nächsten Neustart wieder alt. Wird der `code` eines
Semesters in der Oberfläche geändert, legt der Seed das alte Semester neu an — für 2026-H mit `istAktuell: true`. Das
verletzt den partiellen Unique-Index, der Seed endet mit Exit 1, der Entrypoint bricht ab, und
`restart: unless-stopped` erzeugt eine Endlosschleife.
**Risiko:** Stille Datumsrücksetzung verschiebt Erinnerungen (T-14 aus `start`), Link-Ablauf und Dienstagstermine;
eine normale Bedienhandlung kann das Portal dauerhaft lahmlegen.
**Fix:** Semester im Seed nur anlegen (`update: {}`), am besten nur bei leerer Tabelle; `istAktuell` nur setzen, wenn
noch keines aktuell ist; `code` nach dem Anlegen schreibschützen.

### M4 · Abmelden löscht das Sitzungscookie in Produktion nicht — Security · bestätigt
**Fundstelle:** `gbs-campus/src/lib/session.ts:72`
**Problem:** `speicher.delete(COOKIE_NAME)` sendet das Löschen ohne `Secure`. Browser verwerfen jedes Set-Cookie mit
`__Host-`-Präfix ohne `Secure` — auch den Löschversuch. Die Route meldet trotzdem Erfolg. In der Entwicklung heißt das
Cookie ohne Präfix, dort funktioniert es; deshalb fällt es in Tests nicht auf.
**Risiko:** Auf dem geteilten iPad bzw. Verwaltungsrechner (der ausdrückliche Grund für den Knopf) bleibt die Sitzung
bis zu 12 h offen — mit Zugriff auf Art.-9-Daten und IBAN.
**Fix:** Mit denselben Attributen löschen wie gesetzt
(`speicher.set(COOKIE_NAME, "", { httpOnly: true, sameSite: "lax", secure: prod, path: "/", maxAge: 0 })`).
Zusätzlich im Abmelde-Knopf das Ergebnis auswerten (siehe MINOR `abmelden-knopf.tsx:21`). Optional serverseitiger
Widerruf über eine Spalte `sitzungenUngueltigAb`.

### M5 · Kein CSRF-Schutz über SameSite=Lax hinaus — Security · bestätigt
**Fundstelle:** keine `src/middleware.ts`; Beispielroute `gbs-campus/src/app/api/meine-daten/email/route.ts:23`
**Problem:** Keine Route prüft `Origin` oder `Sec-Fetch-Site`, und `request.json()` prüft den Content-Type nicht. Jeder
POST ist als „simple request“ (`text/plain`, `no-cors`) auslösbar. SameSite=Lax schützt nur gegen fremde *Sites* —
alle Hosts unter `fes-credo.de` sind dieselbe Site, und `session.ts:22-23` nennt genau diese Nachbar-Subdomains
selbst als Bedrohung.
**Risiko:** Eine Schwäche irgendwo unter `*.fes-credo.de` reicht, um beim angemeldeten Opfer (auch dem Schulleiter)
eine E-Mail-Änderung zu beantragen und so das Konto zu übernehmen. Offen sind alle POST-Routen (anonymisieren,
Zeugnisse ausstellen, Honorar freigeben, Anmeldung entscheiden …).
**Fix:** Zentrale `src/middleware.ts` für `/api/*`: bei allen Methoden außer GET/HEAD `Origin` exakt gegen
`new URL(APP_URL).origin` prüfen, sonst 403; zusätzlich `Content-Type: application/json` erzwingen. Ausnahme nur
`/api/cron/*`. Durchstich-Prüfung mit fremdem Origin ergänzen.

### M6 · Anonymisierung nach Art. 17 unvollständig — Security/Architektur/Testing/Fehlerbehandlung · bestätigt (4×)
**Fundstelle:** `gbs-campus/src/lib/anonymisierung-io.ts:44-85` (Transaktion), `:84` (Versandprotokoll)
**Problem:**
- (a) `zeugnisse.snapshot` enthält Name und Geburtsdatum (`zeugnis-io.ts:186-187`) und wird nicht angefasst. Die
  Zeugnisse bleiben GÜLTIG, stehen weiter in der Detailakte, und `/api/zeugnisse/[id]/pdf` liefert den Klarnamen samt
  belegter Bibelschulfächer. Auch eine Neuausstellung für eine anonymisierte Person wird nicht abgewiesen.
- (b) Die Verwaltungs-Mails tragen den Namen im Betreff („Neue Anmeldung: {{name}}“, „Stammdaten geändert: {{name}}“,
  „Kommt nicht ins Portal: {{name}}“, `seed.ts:368/417/432`). Diese Zeilen hängen an der `personId` der
  *Empfänger* und werden deshalb nie bereinigt. Die Betriebsansicht zeigt sie an.
- (c) Audit-Einträge enthalten Namen und Adressen in `vorher`/`nachher` (z. B. `personen/[id]/stammdaten/route.ts:73-80`).
- Keine Prüfung deckt das ab: Der Durchstich anonymisiert in Abschnitt 27, Zeugnisse entstehen erst in Abschnitt 36.
**Risiko:** Die Löschzusage aus README.md ist für jede Person mit Zeugnis nicht erfüllt; Name + Bibelschule ist eine
Angabe mit Art.-9-Bezug. Genau das Muster aus UEBERGABE-Regel 1 („alle Schreibpfade gegen die Zusage prüfen“).
Honorar- und Zeugnismodul formulieren ihre Betreffs schon bewusst ohne Namen (`honorar-abrechnung-io.ts:348`,
`zeugnis-io.ts:358`) — die ältesten Vorlagen nicht.
**Fix:** In der Transaktion `snapshot.person` scrubben (oder bewusste Aufbewahrung entscheiden und dokumentieren, dann
PDF-Abruf für ANONYMISIERT sperren); Vorlagen-Betreffs ohne Namen formulieren und Bestand einmalig bereinigen; ins
Audit nur Feldnamen statt Werte schreiben; Durchstich: Person mit Zeugnis anonymisieren und Snapshot auf den Namen
prüfen.

### M7 · Anonymisierte Person lässt sich über ihre offene Anmeldung reaktivieren — Lückenprüfer · bestätigt
**Fundstelle:** `gbs-campus/src/app/api/anmeldungen/[id]/entscheiden/route.ts:77`
**Problem:** `anonymisierePerson` lässt den Status der Anmeldungen stehen; eine EINGEREICHTE Anmeldung bleibt in der
Arbeitsliste. „Annehmen“ prüft nur den Anmeldestatus und setzt die Person auf ANGENOMMEN, legt eine Teilnahme an und
schickt eine Willkommensmail an die `.invalid`-Adresse.
**Risiko:** Realistischer Ablauf (Bewerbung zurückgezogen + Löschbegehren). Jede Entscheidung verletzt danach entweder
den Endzustand oder die Anonymisierung.
**Fix:** Beim Anonymisieren offene Anmeldungen auf einen Endstatus setzen; in der Entscheidungsroute das Personen-Update
bedingt (`where statusCode = INTERESSENT`) schreiben, bei terminalem Status 409.

### M8 · Einwilligungstexte sind veränderlich — Lückenprüfer · bestätigt
**Fundstelle:** `gbs-campus/prisma/seed.ts:682-686`, `gbs-campus/prisma/setup-app-nutzer.ts:53`
**Problem:** Die Einwilligungen sind append-only, der Text, auf den sie zeigen, nicht: kein Trigger auf
`einwilligungs_texte`, `gbs_app` darf UPDATE/DELETE, und der Seed überschreibt bei jedem Start per
`upsert … update: einwilligung`. Wer einen Tippfehler im Text korrigiert, ohne `version` zu erhöhen, ändert
rückwirkend den Text aller bereits erteilten Einwilligungen.
**Risiko:** Der Nachweis nach Art. 7 Abs. 1 DSGVO für die Art.-9-Einwilligung läuft ins Leere.
**Fix:** Im Seed `update: {}`; BEFORE UPDATE/DELETE-Trigger auf `einwilligungs_texte` (nur `aktivBis` änderbar);
Textänderungen nur als neue Version.

### M9 · Statusmaschine nicht bedienbar, Ausbildungsdaten nicht änderbar — Architektur/UI/UX · bestätigt (2×)
**Fundstelle:** `gbs-campus/prisma/seed.ts:209` (Recht `PERSON_STATUS_WECHSELN` geseedet, nirgends genutzt),
`gbs-campus/src/components/personen/person-aktionen.tsx:375` (Hinweistext)
**Problem:** Status wird nur an vier fest verdrahteten Stellen gesetzt (INTERESSENT, ANGENOMMEN, AKTIV, ANONYMISIERT).
VERSTORBEN, AUSGESCHLOSSEN, ABGEBROCHEN, BEURLAUBT und ABSOLVENT sind über die Oberfläche unerreichbar. Geburtsdatum,
Gemeinde und Teilnahmeform lassen sich nachträglich nirgends ändern, obwohl mehrere Texte auf „eine andere Stelle“
verweisen.
**Risiko:** Der „Not-Aus“ VERSTORBEN greift nie: Eine verstorbene oder ausgestiegene Person bleibt AKTIV, wird zur
Semesterüberleitung eingeladen, vom Worker erinnert und landet im Zeugnislauf. Ein Tippfehler im Geburtsdatum steht
unkorrigierbar auf jedem Zeugnis.
**Fix:** Zentraler Service `wechsleStatus()` (bedingtes Update + StatusWechsel + Audit in einer Transaktion), die vier
bestehenden Stellen darauf umstellen, Route `POST /api/personen/[id]/status` mit `PERSON_STATUS_WECHSELN` und ein Block
„Ausbildungsdaten ändern“ in der Detailakte. Bis dahin die Hinweistexte ehrlich formulieren.

### M10 · Semesterüberleitung ohne „bin raus“ und ohne Herausfallen — Lückenprüfer · bestätigt
**Fundstelle:** `gbs-campus/src/lib/teilnehmerliste.ts:26` (Filter nur auf `istAktiv`)
**Problem:** Laut Bauplan „bin dabei / bin raus“ und automatisches Herausfallen ohne Rückmeldung. Im Code gibt es
beides nicht. Alle Listen (Teilnehmer/Excel, Zeugnislauf, Anwesenheit, Noten) filtern nie auf `bestaetigtAm`. Sieben
Tage nach Semesterstart löscht der Aufräumlauf den Token — danach sind Unbestätigte nicht mehr von direkt
Aufgenommenen zu unterscheiden.
**Risiko:** Wer nicht zurückkommt, steht im neuen Semester dauerhaft „unter Soll“ in Anwesenheit und Noten, im Export
und bekommt im Sammellauf ein Zeugnis. Genau der Ärger, den der Bauplan vermeiden will.
**Fix:** `eingeladenAm` an der Teilnahme, „bin raus“ als zweite Antwort, zum Semesterstart nicht bestätigte Einladungen
auf „nicht zurückgemeldet“ setzen und in allen Teilnehmerabfragen ausschließen. Vorher fachlich mit dem Schulleiter
klären.

### M11 · Abgerechnete Abende lassen sich einem anderen Dozenten zuordnen — Architektur · bestätigt
**Fundstelle:** `gbs-campus/src/app/api/stundenplan/termine/[id]/route.ts:37-50`
**Problem:** DELETE schützt abgerechnete Abende mit 409, PUT ändert `dozentId`/`kurseinheitId` ohne diese Prüfung. Der
eingefrorene Posten bleibt in der Abrechnung von Dozent A; bei Dozent B zählt der Abend als gehalten, lässt sich aber
nie abrechnen (`terminId @unique`). Einen Storno für Abrechnungen gibt es nicht.
**Risiko:** Stille, finanziell relevante Inkonsistenz ohne Korrekturweg außer SQL.
**Fix:** Im PUT dieselbe Prüfung wie im DELETE; Storno für OFFENE Abrechnungen einführen.

### M12 · Fehlgeschlagener DMS-Beleg lässt sich nicht nachholen — Fehlerbehandlung · bestätigt
**Fundstelle:** `gbs-campus/src/lib/honorar-abrechnung-io.ts:366` (ebenso Honorarsatz-Beleg und Zeugnis-Archiv)
**Problem:** Die Freigabe setzt den Status zuerst atomar, der DMS-Versand ist best-effort. Scheitert er, gibt es weder
Route noch Knopf zum erneuten Senden; die Freigabe selbst ist nicht wiederholbar. Der Kommentar in
`honorar-io.ts:229-230` („lässt sich später nachholen“) stimmt nicht. Die Oberfläche nennt bei jedem Fehler die Ursache
„E-Mail noch nicht eingerichtet“.
**Risiko:** Die Buchhaltung überweist laut README auf Grundlage genau dieses Belegs. Ein SMTP-Aussetzer im falschen
Moment hinterlässt eine freigegebene Abrechnung ohne Beleg, die trotzdem als „ausgezahlt“ markiert werden kann.
**Fix:** `POST /api/honorar/abrechnungen/[id]/beleg-senden` (gleiche Rechte, nur bei `dmsGesendetAm = null`, Beleg aus
den eingefrorenen Posten neu bauen) plus Knopf „Beleg erneut senden“; gleiches Muster für Sätze und Zeugnisse.

### M13 · Aufnahme-Entscheidung ohne Einsicht in die Anmeldeantworten — UI/UX · bestätigt
**Fundstelle:** `gbs-campus/src/app/verwaltung/anmeldungen/page.tsx:39`
**Problem:** Die Karte zeigt nur Name, E-Mail, Teilnahmeform, Datum, Fassung, Semester und die Zahl der
Einwilligungen; die Antworten werden bewusst nicht geladen, und keine andere Seite zeigt sie. Nicht in die Akte
übernommene Antworten (Glaubenszeugnis, Motivation, Ziele, Zahlweise, Einzugsermächtigung, Bankname) sind in der
Oberfläche unsichtbar.
**Risiko:** Die Schulleitung nimmt auf, ohne die Bewerbung gelesen zu haben; die Verwaltung erfährt die gewählte
Zahlweise für die Lastschrift nicht.
**Fix:** Aufklappbare Ansicht „Antworten ansehen“ nur mit `ANMELDUNG_ENTSCHEIDEN`, Art.-9-Antworten nur bei erteilter
Einwilligung, Abruf protokollieren; Link „Akte öffnen“ ergänzen.

### M14 · „Alle ausstellen“ ohne Rückfrage, kein Storno — UI/UX · bestätigt
**Fundstelle:** `gbs-campus/src/app/verwaltung/zeugnisse/zeugnis-client.tsx:45`
**Problem:** Der Sammellauf stellt ohne `confirm()` für alle Aktiven offizielle Zeugnisse aus — bei Art „Abschluss“ auch
Erstsemestern ein Abschlusszeugnis. Sie sind sofort in `/meine-daten` sichtbar; einen Storno ohne Ersatz gibt es nicht.
Die weniger folgenreiche Einzelaktion „Neu ausstellen“ hat dagegen eine Rückfrage.
**Fix:** Rückfrage mit konkreten Zahlen („32 Semester-Zeugnisse für … ausstellen? 5 Teilnehmer haben unbewertete
Fächer.“); Sammellauf für ABSCHLUSS sperren oder auf das letzte Ausbildungsjahr begrenzen; Storno mit Audit einführen.

### M15 · Formular-Builder: Fokusverlust nach jedem Tastendruck, fehlende Labels — UI/UX + Codequalität · bestätigt (2×)
**Fundstelle:** `gbs-campus/src/app/verwaltung/formulare/formular-builder.tsx:262` und `:315`
**Problem:** Abschnitte haben den Key `` `${abschnittIndex}-${abschnitt.titel}` ``, Feldzeilen `feld.code` — genau die
Werte, die dort bearbeitet werden. Jeder Tastendruck ändert den Key, React baut das Element neu, der Fokus ist weg.
Doppelte Schlüssel erzeugen zudem doppelte DOM-IDs. Titel- und Beschreibungsfeld der Abschnitte haben kein Label, der
Löschknopf heißt für Screenreader nur „✕“.
**Risiko:** Laut LAIENTEST-Checkliste muss der Schulleiter hier vor dem Livegang das endgültige Formular bauen — der
Builder wirkt kaputt und ist mit Tastatur/Vorlesesoftware nicht bedienbar (WCAG 2.4.3, 3.3.2, 4.1.2).
**Fix:** Stabile clientseitige `uid` (`crypto.randomUUID()`) als Key und ID-Basis, vor dem PUT entfernen; Felder mit
`id`/`htmlFor` beschriften; `aria-label` am Löschknopf.

### M16 · Formular-Builder: Antwortmöglichkeiten lassen sich nicht tippen — Codequalität · bestätigt
**Fundstelle:** `gbs-campus/src/app/verwaltung/formulare/formular-builder.tsx:527`
**Problem:** Die kontrollierte Textarea normalisiert in jedem `onChange`
(`split("\n").map(trim).filter(Boolean)`). Ein Enter am Ende und Leerzeichen am Zeilenende werden sofort entfernt —
eine dritte Option lässt sich nicht anlegen, „Ja, gemeinsam mit …“ wird beim Tippen zu „Ja,gemeinsammit…“. Die
Teilnahmeform-Zuordnung hängt am Optionstext und verwaist bei jeder Änderung.
**Fix:** Rohtext in lokalem State halten und erst `onBlur`/beim Speichern normalisieren (oder ein Eingabefeld je
Option); Zuordnung an eine stabile Options-ID binden.

### M17 · Builder zeigt die Schüler/Hörer-Zuordnung nicht, Speichern scheitert — UI/UX · bestätigt
**Fundstelle:** `gbs-campus/src/app/verwaltung/formulare/[versionId]/page.tsx:27-37`
**Problem:** Die Seite liest `feld.validierung` nicht, also fehlt `teilnahmeformZuordnung` im Startzustand. Alle
Zuordnungs-Auswahlen stehen auf „— bitte wählen —“, und jedes Speichern/Veröffentlichen scheitert an der Prüfung in
`lib/formular.ts:153-161` — auch wenn nur ein Tippfehler anderswo korrigiert wurde.
**Fix:** Beim Mapping `teilnahmeformZuordnung: leseTeilnahmeformZuordnung(feld.validierung)` ergänzen (Funktion
existiert in `lib/formular.ts:567`), besser direkt `alsFeldEingaben()` nutzen.

### M18 · Noten in der Detailakte: „— nicht bewertet“ wird still verworfen — UI/UX · bestätigt
**Fundstelle:** `gbs-campus/src/components/personen/noten-inline.tsx:69`
**Problem:** Die leere Option ist auch bei bewerteten Fächern wählbar, wird aber weder gespeichert noch als
„ungespeichert“ markiert (die API kann eine Bewertung nicht leeren). Nach dem Speichern anderer Fächer wird der Entwurf
nicht aus den neuen Props zurückgesetzt — die Anzeige zeigt „nicht bewertet“, die Datenbank weiter z. B. „bestanden“.
**Risiko:** Die Schulleitung glaubt, eine Fehlbewertung entfernt zu haben; das nächste Zeugnis friert den alten Wert ein.
**Fix:** Leere Option bei bewerteten Zeilen deaktivieren (Hinweis wie beim Dozenten, `stundenplan-dozent.tsx:161-163`);
Entwurf nach erfolgreichem Speichern aus den frischen Props neu setzen.

### M19 · Durchstich hängt am Kalender — Testing · bestätigt
**Fundstelle:** `gbs-campus/scripts/durchstich.sh:1107` (Terminwahl per Sortierung), `:118` (festes Testsemester)
**Problem:** Das Testsemester beginnt fest am 15.09.2026; die Honorar- und Dozent-Abschnitte wählen ihre Abende über
`beginn <= now() order by beginn limit 1 [offset 1]`. Seit dem 22.09.2026 sind generierte Abende vergangen, die
Vorbedingungsprüfungen (Z. 1406, 1408) müssen rot werden; ab dem 10.11.2026 kippen weitere.
**Risiko:** Das einzige End-to-End-Sicherheitsnetz für alle Rechte-Guards ist ohne Codeänderung unbrauchbar. Ohne CI
fällt das nicht auf.
**Fix:** Alle Daten relativ zu `date` erzeugen; DT1/DT2/DT_FUT als eigene Termine mit `now() ± interval` anlegen und über
ihre ID referenzieren; am Skriptanfang die Datumsannahmen prüfen.

---

## Inline-Annotationen (Auswahl)

```ts
// gbs-campus/src/lib/session.ts:70-73
export async function sitzungBeenden(): Promise<void> {
  const speicher = await cookies();
  speicher.delete(COOKIE_NAME); // ⚠️ MAJOR M4: __Host-Cookie ohne Secure → Browser verwirft das Löschen
}
// Besser:
//   speicher.set(COOKIE_NAME, "", { httpOnly: true, sameSite: "lax",
//     secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
```

```yaml
# gbs-campus/docker-compose.yml:81 und :93-95
      - APP_DATABASE_URL=postgresql://gbs_app:${APP_DB_PASSWORD}@db:5432/...  # ⚠️ M2: auch bei leerem Passwort gesetzt
    networks:
      - edge
      - data          # ⚠️ M1: ohne traefik.docker.network wählt Traefik zufällig eine der beiden IPs
```

```ts
// gbs-campus/prisma/seed.ts:682-686 und :767-777
await prisma.einwilligungsText.upsert({ where: ..., update: einwilligung, create: einwilligung }); // ⚠️ M8: überschreibt erteilte Fassung
await prisma.semester.upsert({ where: { code: s.code }, update: { bezeichnung, start, ende, ... }, create: s }); // ⚠️ M3
// Besser: update: {}  — Grunddaten nur anlegen, nie überschreiben
```

```tsx
// gbs-campus/src/app/verwaltung/formulare/formular-builder.tsx:262 und :527
<section key={`${abschnittIndex}-${abschnitt.titel}`}> {/* ⚠️ M15: bearbeiteter Wert im Key → Fokusverlust */}
onChange={(e) => onAendern({ optionen: e.target.value.split("\n").map((z) => z.trim()).filter(Boolean) })}
{/* ⚠️ M16: normalisiert bei jedem Tastendruck → Enter/Leerzeichen verschwinden */}
```

```ts
// gbs-campus/src/app/api/stundenplan/termine/[id]/route.ts:37-50
if (geprueft.data.dozentId !== undefined) {
  // ⚠️ M11: keine Prüfung auf abrechnungPosten — DELETE hat sie (Z. 76-82), PUT nicht
  daten.dozentId = geprueft.data.dozentId;
}
```

---

## Was gut ist

- **Sicherheitskern:** Rechte werden bei jeder Anfrage frisch geladen; Endzustände und Passwortänderung beenden Sitzungen
  (`src/lib/berechtigung.ts:43-78`). Magic-Link nur als Hash, per bedingtem Update single-use, Token im Fragment,
  Einlösung per POST, Mindestlaufzeit gegen Enumeration (`src/lib/magic-link.ts`). scrypt mit Speicher-Obergrenze,
  `timingSafeEqual`, Dummy-Rechnung bei unbekannter Adresse (`src/lib/passwort.ts`).
- **Kein IDOR in den neuen Routen:** Dozent-Anwesenheit auf `termin.dozentId` begrenzt, Dozent-Noten verlangen eigenen
  Abend je Kurseinheit *und* Semester, Teilnahmen-Whitelist je Semester, Zeugnis-PDF nur eigene Person oder
  `NOTEN_VERWALTEN`.
- **Injection:** Excel-Export ohne Formel-Injection und ohne IBAN, PDF-Erzeuger maskiert korrekt, Links aus `APP_URL`
  statt Host-Header, Client-IP aus dem rechten `X-Forwarded-For`-Eintrag.
- **Datenbank-Invarianten statt Konvention:** partielle Unique-Indizes für Zeugnisse, `terminId @unique`,
  Append-only-Trigger inkl. TRUNCATE, REVOKE für `gbs_app`; atomare Statusübergänge per bedingtem `updateMany`.
- **Architektur:** saubere Trennung reine Logik ↔ `*-io.ts`, gemeinsamer Schreibkern mit vorgeschaltetem Scope-Guard für
  Verwaltung und Dozent; Rechte-Codes in `constants.ts` und Seed deckungsgleich (27/27).
- **Performance:** für 150 Konten produktionsreif — Kennzahlen per `count`/`groupBy`, Personenliste begrenzt, kein N+1 in
  den Hauptpfaden, Indizes passen zu den Abfragen.
- **Fehlerbehandlung:** `sendeAnfrage` wirft nie und übersetzt Netzabbruch/Timeout/HTML-500 in deutsche Meldungen;
  Audit und Mailer werfen nie; P2002/P2003/P2025 werden übersetzt.
- **Tests:** ungewöhnlich gute Testkultur — Mutationsregel, selbstzählende Soll-Zahlen, Leer-Schutz im Durchstich,
  Durchstich läuft als `gbs_app`.
- **Codequalität:** kein `any`, kein `@ts-ignore`, keine Hex-Farben in Komponenten, kebab-case durchgängig, Kommentare
  erklären das Warum.

---

## MINOR und INFO (nicht gegengeprüft)

Herabgestufte, aber **gegengeprüfte** MINOR (von MAJOR):
- `src/app/anmeldung/oeffentliches-formular.tsx:124` — „Später weitermachen“ verwirft Freitexte und IBAN, der Hinweis nennt nur „Glaube und Gemeinde“
- `src/lib/ueberleitung.ts:108` — Überleitung verschickt Einladungen seriell im Request; bei vielen Teilnehmern greift die 30-s-Grenze des Clients (plausibel)
- `scripts/durchstich.sh:1499` — Semester-Anteil des Dozenten-Noten-Scopes ungeprüft (Code korrekt, Test fehlt)
- `scripts/durchstich.sh:578` — Sitzungsende im Endzustand ungetestet
- `scripts/durchstich.sh:332` — neue Personen-Detailakte von keiner Prüfung aufgerufen
- `src/app/api/personen/[id]/anmeldelink/route.ts:66` — „Anmeldelink schicken“ meldet immer Erfolg
- `src/lib/berechtigung.ts:101` — abgelaufene Sitzung wird als 403 statt 401 gemeldet
- `src/app/verwaltung/abmelden-knopf.tsx:21` — Abmelden verschluckt Fehler
- `src/lib/leistung-io.ts:81` — Hörer stehen in jeder Notenerfassung und lassen sich benoten (Bauregel „Hörer fällt aus jeder Prüfungsautomatik“)
- `src/lib/semester.ts:241` — Gemeindezugehörigkeit (Art. 9) steht im Excel-Export und ist für den Administrator sichtbar

**Security** — MINOR: rohe Passwort-Eingabe landet bei Fehlschlag im Audit (`api/auth/passwort/route.ts:109`); Drossel
nicht atomar (`magic-link.ts:38`); IBAN-Änderung ohne Hinweis an den Inhaber (`api/meine-daten/route.ts:99`); Admin kann
sich selbst Schulleiter-/Verwaltungsrechte geben (`api/personen/[id]/rollen/route.ts:59`); ersetzte Zeugnisse weiter
abrufbar, ohne Storno-Vermerk (`zeugnis-io.ts:428`); Honorar-Selbstabrechnung bei Verwaltung+Dozent möglich
(`honorar-abrechnung-io.ts:126`); Eigentümer-Passwort der DB in der Umgebung des Servers (`docker-compose.yml:80`);
Art.-15-Auskunft ohne Noten, Zeugnisse, Anwesenheiten, Honorare (`auskunft.ts:105`).
INFO: E-Mail-Bestätigungstoken im Query-String (`selbstpflege.ts:226`); Klartext-IBAN ohne `Cache-Control: no-store`
(`api/personen/[id]/bankverbindung/route.ts:63`); Schlüsselprüfung mit `in` lässt Prototyp-Namen durch
(`api/einstellungen/route.ts:27`).

**UI/UX** — MINOR: destruktive Aktionen uneinheitlich abgesichert (Rollen entziehen, Satz genehmigen ohne Rückfrage,
`person-aktionen.tsx:184`); „Anmeldeadresse ändern“ auch bei anonymisierten Personen (`person-aktionen.tsx:226`);
Dozent ohne Rückweg aus `/meine-daten` (`meine-daten/page.tsx:94`); `/anmelden`: Adresse nach dem Senden nicht
korrigierbar, Fehler sehen aus wie Erfolg (`anmelde-formular.tsx:49`); Art.-9-Einwilligung schaltet Abschnitte weiter oben
ohne Hinweis frei (`oeffentliches-formular.tsx:215`); Pflichtangaben bei Auswahlgruppen nicht programmatisch markiert
(`:471`); grüne IBAN-Bestätigung Kontrast 2,84:1 (`:430`); Du/Sie gemischt (`anmeldeformular-definition.ts:38`) — **erledigt 27.09.: überall „Sie“ (E-22)**;
veraltete Hilfetexte (`person-anlegen.tsx:34`); Semesterwahl navigiert bei onChange, ungespeicherte Noten gehen verloren
(`noten/semesterwahl.tsx:23`); Anwesenheitsspalte der Personenliste widerspricht der Detailakte (`personen/page.tsx:111`);
23 von 31 Seiten ohne eigenen Seitentitel (`layout.tsx:21`); „Freigeben“ auch ohne hinterlegte IBAN klickbar
(`honorar/abrechnungen/[id]/page.tsx:128`).
INFO: Live-Regionen uneinheitlich (`person-aktionen.tsx:424`); keine `loading.tsx` (`layout.tsx:26`); Zurück-Leiste nur auf
5 Seiten (`noten/page.tsx:50`).

**Performance** — MINOR: Dozenten-Startseite lädt die ganze Historie (`stundenplan-io.ts:419`); stündlicher
Heartbeat bläht das unlöschbare Audit-Log auf (`aufraeumen.ts:93`).
INFO: einige doppelte/sequenzielle Abfragen (`stundenplan/page.tsx:42`); zod im Client-Bundle (`leistung.ts:133`);
`ladeBelegDaten` ungebunden, bei dieser Größe harmlos (`honorar-io.ts:157`).

**Architektur** — MINOR: kein Lebenszeichen des Workers in der Betriebsansicht (`betrieb/page.tsx:73`); DMS-Nachversand
fehlt (siehe M12, `honorar-abrechnung-io.ts:284`); Seed überschreibt bei jedem Start Rechtematrix, Status-Schalter,
Vorlagen und Kursraster (`seed.ts:667`); Rechte-Codes nur als `string` typisiert (`berechtigung.ts:101`); Status-Schalter
`anwesenheitZaehlt`/`beitragLaeuft` ungenutzt (`schema.prisma:43`); eingefrorene Belege nur per Konvention
unveränderlich (`setup-app-nutzer.ts:53`); Rollenvergabe ohne Obergrenze (`api/personen/[id]/rollen/route.ts:59`); neue
UI-Bausteine nur teilweise genutzt (`components/ui/zurueck-leiste.tsx:4`).
INFO: Worker wartet nicht auf den Abschluss der Migrationen (`scripts/worker.ts:48`); onDelete-Politik bei Nachweisdaten
uneinheitlich (`schema.prisma:506`); Seiten fragen die DB direkt ab (`verwaltung/page.tsx:48`).

**Testing** — MINOR: IBAN-Suche läuft vor den neuen IBAN-Pfaden (`durchstich.sh:738`); Prüfung des ungültigen
Auszahlungsdatums besteht unabhängig von der Regel (`durchstich.sh:1231`); Inline-Noteneingabe dupliziert Regeln
ungetestet (`noten-inline.tsx:87`); Zeitzonen-Prüfungen laufen in UTC und beweisen dort nichts
(`pruefe-stundenplan.ts:59`); Satz-Historie in einer Abrechnung ungeprüft (`durchstich.sh:1089`); Löschlauf nur auf
„lief“ geprüft (`aufraeumen.ts:60`); **keine CI** (`package.json:20`).
INFO: Randfälle „ersetztes Zeugnis“/„leere Leistungen“ ohne festgeschriebenes Verhalten (`api/zeugnisse/[id]/pdf/route.ts:20`);
Soll-Summe in der README weicht vom Code ab (`README.md:113`).

**Fehlerbehandlung** — MINOR: Erinnerungslauf rotiert den Token vor dem Versand (`ueberleitung.ts:297`);
Zeugnis-Sammellauf zählt Fehlschläge als „übersprungen“ (`zeugnis-io.ts:342`); „Erneut versuchen“ lädt Server-Daten
nicht neu (`error.tsx:22`); Honorar-Routen bilden jedes Nein auf 400 ab (`api/honorar/abrechnungen/[id]/freigeben/route.ts:29`);
uneinheitliche 500-Behandlung in neuen Routen (`api/zeugnisse/ausstellen/route.ts:31`); Download-Links zeigen im
Fehlerfall rohes JSON (`meine-daten/meine-zeugnisse-abschnitt.tsx:31`).
INFO: Prototyp-Schlüssel in Einstellungen → 500 statt 404 (`api/einstellungen/route.ts:27`); Kommentar und Code
widersprechen sich in `api/auth/token/route.ts:24`.

**Codequalität** — MINOR: `ladeMitRecht`/`hatRecht` nehmen `string` statt `RechtCode` (`berechtigung.ts:101`); restliche
Magic Strings (`anmeldung.ts:31`); `BESTANDEN_ERGEBNISSE` unbenutzt, zwei Kopien daneben (`leistung.ts:42`); Kommentare,
die das Gegenteil des Codes behaupten (`oeffentliches-formular.tsx:88`); überholte sichtbare Texte „Einzug ab Release 0.3“
(`einstellungen.ts:290`); kein 401/403-Unterschied (`api.ts:28`); UI-Redesign halb migriert, einmal Rot auf Rot
(`stundenplan/page.tsx:144`); Inline-Noten kopieren Matrix-Logik (`noten-inline.tsx:87`); Enum-Klartexte mehrfach gepflegt
(`stundenplan.ts:10`); drei verschiedene Anwesenheitsquoten für dieselbe Person (`stundenplan-io.ts:161`); Datumshelfer
umgangen (`personen/[id]/page.tsx:82`); DMS-Versand/Beleg-Nr mehrfach implementiert (`honorar-io.ts:270`); JSDoc an falscher
Deklaration (`formular.ts:551`); „uebersprungen“ vermischt zwei Bedeutungen (`zeugnis-io.ts:338`).
INFO: uneinheitliche Signaturen der Geschwisterfunktionen (`leistung-io.ts:330`); Name der Einrichtung 23-mal fest im Code
(`mailer.ts:149`).

**Lückenprüfer** — MINOR: Hörer-Bescheinigung bestätigt „teilgenommen“ unabhängig von der Anwesenheit
(`zeugnis-io.ts:98`); Art.-9-Kennzeichnung im Builder frei abwählbar, auch für Gemeinde (`formular.ts:128`); Widerruf der
Art.-9-Einwilligung modelliert, aber nicht umsetzbar (`schema.prisma:977`); Einladung und T-14-Erinnerung fallen zusammen,
vier statt drei Mails (`ueberleitung.ts:297`); öffentliche Anmeldung ohne Gesamtdrossel (`api/anmeldung/route.ts:56`) — **erledigt 27.09.: Gesamtgrenze, Mindestdauer, Warnung (E-23)**;
Adressänderung nach Postfachverlust entwertet den Auskunftslink nicht (`api/personen/[id]/email/route.ts:104`);
Zeichen außerhalb Latin-1 im Zeugnis-PDF als „?“ eingefroren (`pdf.ts:61`); keine Löschfrist für abgelehnte Bewerber
(`aufraeumen.ts:60`); **ABSOLVENT ist terminal** — Absolventen kämen weder an ihr Abschlusszeugnis noch in `/meine-daten`
(`seed.ts:73`).
INFO: Fortsetzen-Token der Anmeldung im Query-String (`oeffentliches-formular.tsx:130`).

(Alle Pfade relativ zu `gbs-campus/`.)

---

## Empfohlene Prioritäten

**Sofort (klein, verhindert Totalausfall oder Datenleck):**
1. M1 Traefik-Netz festlegen · M2 `APP_DATABASE_URL` an das Passwort koppeln · M3 + M8 Seed: Semester und
   Einwilligungstexte nur anlegen, nie überschreiben (+ Trigger auf `einwilligungs_texte`)
2. M4 Abmelde-Cookie korrekt löschen (+ Fehler im Knopf auswerten)
3. M5 Origin-Prüfung in `src/middleware.ts`
4. M19 Durchstich auf relative Daten umstellen — sonst ist keiner der folgenden Fixes nachweisbar

**Vor dem nächsten Semesterwechsel:**
5. M6 + M7 Anonymisierung vervollständigen (Zeugnisse, Betreffs, offene Anmeldungen)
6. M9 Statuswechsel und Ausbildungsdaten in der Oberfläche (VERSTORBEN als echter Not-Aus); dabei ABSOLVENT-Terminal-Frage klären
7. M10 „bin raus“/Herausfallen — vorher fachlich mit dem Schulleiter klären
8. M15–M17 Formular-Builder reparieren (stabile Keys, Labels, Optionen, Zuordnung laden)
9. M14 Rückfrage beim Zeugnis-Sammellauf · M18 Noten-Leeroption
10. M11 + M12 Honorar: PUT auf abgerechnete Abende sperren, Storno OFFENER Abrechnungen, DMS-Beleg nachsenden
11. M13 Anmeldeantworten einsehbar machen

**Backlog (Auswahl):** Hörer aus der Notenerfassung nehmen · Gemeinde aus dem Excel-Export · 401 vs. 403 ·
Anmeldelink-Rückmeldung · Art.-15-Auskunft um neue Datenarten ergänzen · CI einrichten · Worker-Lebenszeichen ·
Widerruf der Art.-9-Einwilligung · Löschfrist für abgelehnte Bewerber.

---

## Stand der Behebung (27.09.2026)

**Branch:** `fix/code-review-4` (committet und in `main` gemergt). Behoben in drei Fix-Runden:
Runde 1 (Betrieb, Anmeldung/Sitzung, Honorar, Zeugnis, Formular-Builder, Anmeldung/Noten), Runde 2
(Personen-Lebenszyklus, Semesterüberleitung, Nachbesserungen aus der Gegenprüfung), Runde 3 (MINOR/INFO,
Durchstich, CI, Doku). Jede Runde wurde von einem unabhängigen Prüfer gegengelesen und zentral in einer
Sandbox verifiziert (Kopie des Arbeitsbaums außerhalb des Sync-Ordners); zum Schluss liefen mit Docker der
Durchstich und `pruefen:db` gegen das gebaute Image.

**GoLive-Status des Codes: 🟢 — keine offenen CRITICAL- oder MAJOR-Befunde.** Alle 19 MAJOR sind behoben und
nachgewiesen: DB-frei, gegen PGlite und Ende-zu-Ende mit dem Durchstich gegen das gebaute Image (766/766).
**Für den Livegang insgesamt bleibt es 🟡**, bis die externen Punkte erledigt sind (Staging mit TLS,
SPF/DKIM/DMARC, Off-Site-Backup, Laientest); dazu kommen die offenen Entscheidungen unten.

### Verifikationsstand

| Schritt | Ergebnis |
|---|---|
| `tsc --noEmit` | 0 Fehler |
| `npm run pruefen` (jetzt `scripts/pruefe-alle.ts`, je Skript `TZ=Europe/Berlin`) | **1177 Prüfungen in 19 Skripten, 0 fehlgeschlagen** — auch in leerer Umgebung wie in der Docker-builder-Stufe |
| `next build` in leerer Umgebung | grün, 41/41 Seiten, keine Warnungen |
| esbuild-Bundles (Seed, Worker, `setup-app-nutzer`) | grün |
| `prisma validate` | grün (mit Platzhalter-`DATABASE_URL`) |
| Migrationen gegen PGlite (PostgreSQL 18.3 als WASM) | **alle 24** fehlerfrei in Reihenfolge, 65 SQL-Prüfungen OK (Trigger auf `einwilligungs_texte`, Append-only, CHECK `teilnahmen_abmeldung_konsistent`, partieller Index, Nachtragen von `eingeladenAm`, Betreff-Bereinigung, Idempotenz) |
| `prisma migrate diff` Migrationen ↔ Schema (Shadow-DB PGlite) | leer — kein Drift |
| `bash -n scripts/durchstich.sh` | Syntax ok, `SOLL=766` |
| **Durchstich gegen das Image** | **766/766 grün** (27.09.2026, Docker, frische Datenbank). Erster Lauf 760/764: vier Rechte-Gegenproben nutzten eine absichtlich entwertete Sitzung und erwarteten 403 statt des jetzt korrekten 401 — Testfehler, behoben (+2 Prüfungen) |
| `npm run pruefen:db` | **grün**, 19 + 18 (gegen `gbs_durchstich`) |

Prüfzahlen im Verlauf: Ausgangsstand `19bab19` 516 in 16 Skripten → Runde 1 669 in 18 → Runde 2 846 in 19 →
Runde 3 **1177 in 19**. Kein Skript hat Prüfungen verloren.

Nicht von den SQL-Prüfungen gedeckt: das *Verhalten* der drei zuletzt ergänzten Trigger in
`20260927160000_belege_unveraenderlich` (Posten nur zu OFFENEN Abrechnungen, Summe = Summe der Posten). Sie
werden angelegt; ihr Verhalten prüft erst der Durchstich (Abschnitt 29b, Triggerzahl in Abschnitt 31).

### MAJOR M1–M19

| # | Status | Umsetzung |
|---|---|---|
| M1 Traefik-Netz | ✅ behoben | Netz `edge` heißt fest `gbs_edge`; Traefik doppelt festgelegt (`--providers.docker.network=gbs_edge` und Label `traefik.docker.network` an `app`). Sicherheits-Header kommen aus dem Datei-Provider (`docker/traefik-dynamisch.yml`), der traefik-Container hat keine Labels mehr. Offen nur der Staging-Test mit TLS und Neustarts (GoLive-Checkliste). |
| M2 `APP_DATABASE_URL` | ✅ behoben | Der Entrypoint schaltet nur bei nicht leerem `APP_DB_PASSWORD` auf `gbs_app` um. Passwort mindestens 16 Zeichen, nur Buchstaben und Ziffern, sonst bricht der Start ab. Nach dem Umschalten entfernt der Entrypoint `DB_PASSWORD` aus dem Serverprozess (Rest: Entscheidung E-betrieb-migrationsdienst). |
| M3 Seed/Semester | ✅ behoben | Semester nur bei leerer Tabelle (`createMany`), danach nie überschrieben. Kürzel nach dem Anlegen fest, Lehrjahr/Halbjahr in der Oberfläche pflegbar. |
| M4 Abmelden | ✅ behoben | Cookie wird mit denselben Attributen wie beim Setzen und `Max-Age=0` gelöscht. Der Abmelde-Knopf leitet nur bei Erfolg weiter. Serverseitiger Widerruf: Entscheidung AUTH-serverseitiger-widerruf. |
| M5 CSRF | ✅ behoben | `src/middleware.ts` + `src/lib/herkunft.ts`: schreibende `/api`-Anfragen nur mit `Origin` = Herkunft aus `APP_URL` bzw. `Sec-Fetch-Site` `same-origin`/`none`, sonst 403 und `[HERKUNFT]`-Log. Der Startprüfer lehnt eine `APP_URL` ohne Herkunft ab, in Produktion mit `APP_DOMAIN` auch ohne `https://` oder mit anderem Host. Content-Type-Pflicht und Cron-Ausnahme bewusst nicht gebaut. |
| M6 Anonymisierung | ✅ behoben | (a) Zeugnis-Snapshots werden gescrubbt, Neuausstellung für ANONYMISIERT gibt 409 (Fachentscheidung 1). (b) Betreffs ohne Namen, Bestand per Migration `20260927130000` bereinigt, Betreff/Empfänger/Fehlertext im Versandprotokoll bereinigt. (c) Audit nur mit Feldnamen. (d) Rollen entfernt, Sitzungen beendet, offene Anmeldungen geschlossen. |
| M7 offene Anmeldung | ✅ behoben | Anonymisierung setzt offene Anmeldungen auf ABGELEHNT (`[anonymisiert]`); die Entscheidungsroute antwortet 409 bei ANONYMISIERT bzw. „Annehmen“ im Endzustand; Statuswechsel bedingt. |
| M8 Einwilligungstexte | ✅ behoben | Seed legt nur an (WARNUNG bei Abweichung). Migration `20260927100000`: drei Trigger, nur `aktivBis` änderbar, kein DELETE/TRUNCATE; `gbs_app` ohne UPDATE/DELETE/TRUNCATE. Neuer Text = `version + 1`. |
| M9 Statusmaschine | ✅ behoben | `status-io.ts` (`wechsleStatus`) ist der einzige Schreibweg, Regeln DB-frei in `status.ts`. `POST /api/personen/[id]/status` und `PUT …/ausbildungsdaten` (Recht `PERSON_STATUS_WECHSELN`, nur Schulleitung), Block „Ausbildungsdaten & Status“ in der Akte, letzter Administrator geschützt. ABSOLVENT kein Endzustand (Fachentscheidung 3). |
| M10 Überleitung | ✅ behoben | `Teilnahme.eingeladenAm/abgemeldetAm/abmeldeGrund` (Migration `20260927110000` mit CHECK). „Bin raus“ und Antwort ändern bis zum Vortag des Semesterstarts, ab dem Starttag Abmeldung ohne Rückmeldung (Worker/Cron), Filter `TEILNAHME_ZAEHLT` in allen Semesterlisten, „Wieder aufnehmen“ (Fachentscheidung 2). |
| M11 Dozentenwechsel | ✅ behoben | PUT sperrt den Wechsel an abgerechneten Abenden (409, Zeilensperre). Storno OFFENER Abrechnungen (`DELETE /api/honorar/abrechnungen/[id]`, Audit mit Posten). Nach der Freigabe bewusst kein Storno. |
| M12 DMS-Nachversand | ✅ behoben | Nachversand für Zahlungsbeleg, Satz-Beleg und Zeugnis-Archivkopie, jeweils unter Advisory-Lock, mit derselben Beleg-Nr und Vermerk „NACHVERSAND“. Ehrliche Meldung (`dmsVersand`), Betriebs-Kachel „Belege noch nicht im DMS“. |
| M13 Anmeldeantworten | ✅ behoben | Seite `/verwaltung/anmeldungen/[id]`; Art.-9-Antworten nur mit `ANMELDUNG_ENTSCHEIDEN` und wirksamer Einwilligung in alle Art.-9-Texte; jeder Abruf protokolliert. |
| M14 Zeugnis-Sammellauf | ✅ behoben | Rückfrage mit Zahlen (unbewertete Fächer, ohne Bewertung, Quereinsteiger), ABSCHLUSS gesammelt nur im letzten Rastersemester, ersetzte Zeugnisse: 410 für Schüler, Vermerk „UNGÜLTIG“ für die Schulleitung. Storno ohne Ersatz: Entscheidung ZEUG-storno-ohne-ersatz. |
| M15 Builder-Fokus | ✅ behoben | Clientseitige `uid` als Key und ID-Basis, beschriftete Abschnittsköpfe, `aria-label` am Löschknopf. |
| M16 Builder-Optionen | ✅ behoben | Rohtext lokal, bereinigt erst beim Verlassen bzw. Speichern; Zuordnung auf vorhandene Antworten beschnitten. Eine umbenannte Antwort wird bewusst neu zugeordnet (keine stabile Options-ID). |
| M17 Builder-Zuordnung | ✅ behoben | Builder lädt über `alsBuilderAbschnitte`/`alsFeldEingaben`, die Zuordnung ist vorbelegt. |
| M18 Noten-Leeroption | ✅ behoben | Overlay wie in der Notenmatrix, Anzeige nach dem Speichern aus frischen Daten, „— nicht bewertet“ bei bewerteten Fächern gesperrt. |
| M19 Durchstich-Kalender | ✅ behoben, **766/766 grün** | Alle Daten relativ zum Berliner Kalendertag, Abschnitt 0 prüft die Annahmen, Abende mit Zeitbezug als eigene Termine per Id; neue Abschnitte 37–50; `SOLL=766` (vorher 414). |

### MINOR und INFO — Zusammenfassung

**Erledigt** (Auswahl nach Bereich):
- *Security:* keine Eingabe mehr im Audit bei Passwort-Fehlversuch; Drosseln atomar (`pg_advisory_xact_lock`, IPv6 je /64); Hinweis-Mail bei IBAN-Änderung (`BANKVERBINDUNG_GEAENDERT`); ersetzte Zeugnisse mit 410 bzw. Vermerk; Auskunft um Noten, Zeugnisse, Anwesenheit, Rückmeldungen, Honorare erweitert; E-Mail-Bestätigungs- und Fortsetzen-Token im Fragment; Klartext-IBAN nur per POST mit `no-store`; `Object.hasOwn` statt `in` bei Einstellungen.
- *UI/UX:* Rückfragen bei Rollen und Honorarsatz; keine Aktionen an Anonymisierten; Rückweg für Dozenten; `/anmelden` mit Sitzungshinweis, rotem Fehler und „Andere Adresse eingeben“; Art.-9-Freischaltung mit Ansage und Fokus; Pflichtangaben für Vorlesesoftware; IBAN-Bestätigung kontrastreich; Semesterwahl per Knopf „Anzeigen“; Quote in Liste und Akte gleich (Modell A); eigener Tab-Titel je Seite; „Freigeben“ ohne IBAN gesperrt; einheitliche Live-Regionen (`MeldungsBox`); Zurück-Leiste überall.
- *Performance:* Aufräum-Audit nur bei Löschungen, sonst höchstens alle 12 h; zod aus dem Client-Bundle (`leistung-schema.ts`).
- *Architektur:* Worker-Lebenszeichen (Datei, Healthcheck, Betriebs-Kachel); DMS-Nachversand; Belege per Trigger eingefroren; Rechte-Codes typisiert (`RechtCode`, `pruefeZugriff`); Worker wartet auf die Migrationen; Leistung → Kurseinheit `RESTRICT`.
- *Testing:* IBAN-/Art.-9-Suche als Abschluss-Sweep am Durchstich-Ende; Aufräumlauf mit Inhalt geprüft; Prüfskripte in Europe/Berlin; **CI** (`.github/workflows/pruefen.yml`) und Prüfgate im Docker-Build; Soll-Summe in der README korrigiert.
- *Fehlerbehandlung:* Token erst nach erfolgreichem Versand rotiert; Sammellauf unterscheidet vorhanden/fehlgeschlagen; „Erneut versuchen“ lädt neu, Fehlerseite zeigt Fehlercode; Honorar-Routen mit 404/409/500 statt pauschal 400; einheitliche 500-Behandlung; Download-Links bei abgelaufener Sitzung mit HTML-Seite bzw. 303 statt JSON; 401 vs. 403.
- *Codequalität:* Klartexte und Konstanten zentral (`anmeldestatus.ts`, `ANWESENHEIT_OPTIONEN`, `EINRICHTUNG`, `KURSRASTER`); DMS-Versand und Beleg-Nr je einmal (`lib/dms.ts`, `lib/beleg-nr.ts`); „uebersprungen“ aufgelöst; überholte Texte („Einzug ab Release 0.3“, Hilfetexte, widersprüchliche Kommentare) korrigiert.
- *Lückenprüfer:* Gemeinde im Builder immer Art. 9; Einladung und T-14 fallen zusammen (höchstens drei Mails); Adressänderung entwertet Auskunfts- und Anmeldelinks; Fangfeld gegen Roboter; ABSOLVENT kein Endzustand.

**Teilweise erledigt, Rest ist Entscheidung:** Eigentümer-Passwort nur aus dem Serverprozess entfernt
(E-betrieb-migrationsdienst) · PDF bildet lateinische Sonderzeichen ab, nicht-lateinische Schrift bleibt „?“
(E-betrieb-pdf-nichtlateinische-schrift) · Dozenten-Startseite lädt weniger, aber weiter die ganze Historie
(E-SEM-dozent-semesterfenster) · Missbrauchsschutz der Anmeldung: seit 27.09. abends vollständig (Gesamtgrenze,
Mindestdauer, Warnung; E-23) · IBAN-Änderung: Hinweis-Mail ja, Freigabesperre offen (E1-iban-freigabesperre) ·
Nachweisdaten: Leistung `RESTRICT` ja, Zeugnis ↔ Person weiter Cascade (E-betrieb-zeugnis-person-cascade).

**Offene Entscheidungen** (Liste mit Optionen und Empfehlung in `gbs-campus/UEBERGABE.md`):
Admin-Selbstvergabe und Rollen-Obergrenze · Honorar-Selbstabrechnung · Umfang des Satz-Belegs · Seed überschreibt
Konfiguration · tote Status-Schalter · ~~Du/Sie im Formular~~ (erledigt: „Sie“, E-22) · Versionsnummer · IP-Drossel beim Anmeldelink der
Verwaltung · ~~Bescheinigung ohne Anwesenheit~~ (erledigt 27.09. spät) · Widerruf der Art.-9-Einwilligung · Löschfrist für abgelehnte
Bewerber · serverseitiger Sitzungswiderruf · ~~ABGEBROCHEN ohne Rückweg~~ (erledigt 27.09. spät) · Reichweite eines Formwechsels ·
~~Nachholen nach Worker-Ausfall~~ (erledigt 27.09. spät) · ~~„bin raus“ in der Sammelübernahme~~ (erledigt 27.09. spät) · ~~Zusage von Hand~~ (erledigt 27.09. spät) · ~~Einladung erneut senden~~ (erledigt 27.09. spät) ·
Zahlweise im Excel-Export · ~~Zeugnis-Storno ohne Ersatz~~ (erledigt 27.09. spät) · DMS-Nachversand für Anonymisierte · IBAN-Abgleich beim
Nachversand · Art.-9-Antworten nach der Entscheidung · ~~Tippfehler in Einwilligungstext v1~~ (erledigt: Fassung 2) · Restfenster
Erst-/Nachversand · Auskunft (DMS als Empfänger, Protokolldaten, Speicherdauer, Art. 22) · Semesterbeginn
vorziehen · rückwirkender Honorarsatz · ~~Nachversand von Einladungen~~ (erledigt 27.09. spät: nur per Knopf) · Personenname im Tab-Titel · Rechte ohne
Funktion · Begriff „Angenommen“ · IPv6-Präfix.

**Bewusst so belassen:**
- Gemeindezugehörigkeit im Excel-Export und in der Oberfläche (`semester.ts:241`) — **Fachentscheidung 4 vom 27.09.2026**, unverändert.
- Kein `Content-Type: application/json`-Zwang und keine Pfad-Ausnahme für `/api/cron/*` (M5): Die Origin-Prüfung schließt die Lücke, eine Pfad-Ausnahme wäre neue Angriffsfläche.
- Keine `loading.tsx`: Sie würde `redirect()`/`notFound()` der dynamischen Seiten bei direktem Aufruf zu HTTP 200 machen. Ladehinweis stattdessen über `<LadeHinweis />`.
- Kein Storno nach der Freigabe einer Honorarabrechnung; Korrektur außerhalb per Gegenbuchung.
- Keine stabile Options-ID im Builder (umbenannte Antwort wird bewusst neu zugeordnet).
- Kein zusätzlicher Index auf `teilnahmen(abgemeldetAm)` (60–150 Zeilen je Semester).

**Nicht einzeln nachgeprüft** (INFO, ohne Auswirkung auf den Betrieb): Seiten fragen die Datenbank direkt ab
(`verwaltung/page.tsx:48`); doppelte/sequenzielle Abfragen auf der Stundenplanseite.

**Neu entstandene, bekannte Restpunkte:** Der Durchstich hält zwei „Rest (bekannt)“-Prüfungen fest (Abschnitt 49:
`docker exec` und Healthcheck sehen das Eigentümer-Passwort weiter). Die Branch-Schutz-Regel „Typpruefung und
Pruefskripte“ als Pflicht-Check für `main` ist eine Einstellung im GitHub-Repo und noch einzutragen.
