# Laientest — Drehbuch und Go-Live-Checkliste

Dieser Test soll finden, was den Entwicklern durch Betriebsblindheit entgeht: unklare Texte,
Sackgassen, missverständliche Schaltflächen, Fehlermeldungen, die niemand versteht. Er wird von
**einer projektfremden Person** durchgeführt — jemandem, der die Software nie gesehen hat und idealerweise
auch nicht besonders technikaffin ist. Genau deren Stolpersteine zählen.

Das Dokument hat fünf Teile:

1. **Vorbereitung** — was der Betreuer vor dem Termin einrichtet (die Testperson fasst keine Technik an).
2. **Aufgaben** — was die Testperson tut, in Alltagssprache, ergebnisoffen.
3. **Rückmeldebogen** — was der Betreuer dabei mitschreibt.
4. **Go-Live-Checkliste** — alles, was vor dem Livegang zusätzlich zu erledigen ist.
5. **Handprüfungen** — was der Betreuer selbst im Browser nachsieht, weil es der automatische Durchstich
   (per curl) nicht prüfen kann.

> **Grundregel für den Betreuer:** Beim Beobachten **nicht helfen und nicht erklären**, solange es
> irgendwie geht. Jedes „ach, da musst du oben rechts klicken" ist ein gefundener, aber ungeschriebener
> Fehler. Zusehen, mitschreiben, wo es hakt — erst eingreifen, wenn die Person wirklich feststeckt.

---

## Teil 1 · Vorbereitung durch den Betreuer

### 1.1 Umgebung starten

Ein Testlauf braucht eine laufende Instanz mit **frischer, leerer Datenbank** — nicht die spätere
Produktivdatenbank. Am einfachsten die Entwicklungsumgebung (siehe [`UEBERGABE.md`](UEBERGABE.md),
Abschnitt „In fünf Minuten lauffähig"):

```bash
docker start gbs-campus-db-dev || docker run -d --name gbs-campus-db-dev -e POSTGRES_DB=gbs_campus -e POSTGRES_USER=gbs -e POSTGRES_PASSWORD=gbs_dev_2026 -p 5434:5432 postgres:16-alpine
```

```bash
cd gbs-campus && export DATABASE_URL="postgresql://gbs:gbs_dev_2026@localhost:5434/gbs_campus?schema=public" && export ENCRYPTION_KEY="$(openssl rand -hex 32)" && export SESSION_SECRET="$(openssl rand -hex 32)" && export APP_URL="http://localhost:3000"
```

In eine **frische** Datenbank zuerst das Schema einspielen und die Grunddaten setzen — das geht in der
Entwicklung **nicht** von allein (`npm run dev` macht weder Migration noch Seed):

```bash
npx prisma migrate deploy && npm run db:seed
```

Der Seed ist idempotent und legt an: Statusmaschine, Rollen und Rechte **und ein bereits
veröffentlichtes Standard-Anmeldeformular** mit einem Art.-9-Feld (Glaubensangabe). Danach der Server:

```bash
npm run dev
```

> Auf **diesem** Entwicklungsrechner hängen `migrate` und Build wegen der Ordner-Synchronisierung
> gelegentlich; die Umgehungen stehen in [`UEBERGABE.md`](UEBERGABE.md) unter „Fallen". Für einen
> Laientest ist ein sauberer Rechner oder das Produktions-Image (dessen Entrypoint Migration und Seed
> selbst ausführt) der ruhigere Weg.

Das Serverlog **offen lassen** — es ist im Test die „Poststelle" (siehe 1.5).

> **Die Anwendung im Browser genau unter der Adresse aus `APP_URL` öffnen** — hier also
> `http://localhost:3000`, nicht `http://127.0.0.1:3000`. Seit Code-Review 4 prüft der Server die Herkunft
> jeder Änderung; unter einer anderen Adresse meldet jede Speicher-Aktion „Diese Anfrage kam nicht von der
> Seite des Portals …“. Die Testinstanz aus dem Produktions-Image (siehe [`UEBERGABE.md`](UEBERGABE.md),
> „Lokale Testinstanz“) läuft dagegen mit `APP_URL=http://127.0.0.1:3000` und wird genau dort geöffnet.

### 1.2 Ein Semester anlegen — sonst bleibt alles leer

Ohne laufendes Semester bekommt keine Anmeldung einen Bezug und die Teilnehmerliste bleibt leer. Also
zuerst als Schulleitung anmelden (siehe 1.3) und unter **`/verwaltung/semester`** ein Semester anlegen,
das laufende festlegen und ein **Anmeldefenster** setzen, das den Testtag einschließt. Beispielwerte für
den Test:

| Feld | Wert |
|---|---|
| Bezeichnung | Wintersemester 2026 (Testlauf) |
| Anmeldefenster | von heute bis in zwei Wochen |
| als laufendes Semester | ja |

In eine **leere** Datenbank legt der Seed bereits die sechs realen Semester an (2026-H als laufend). Er
überschreibt Semester danach nie — was hier geändert wird, bleibt auch nach einem Neustart. Das Kürzel eines
Semesters lässt sich nach dem Anlegen nicht mehr ändern; Lehrjahr und Halbjahr (Verortung im Kursraster) schon.

### 1.3 Ein Verwaltungskonto anlegen

Für die Verwaltungsseite (Teil 2, Abschnitt B) ein Konto mit Schulleitungsrolle. Das Skript liegt nur
außerhalb des Produktions-Images:

```bash
npx tsx scripts/testperson-anlegen.ts leitung-test@beispiel.de SCHULLEITER
```

Der Anmeldelink erscheint danach im Serverlog. Wer auch die reine Verwaltungsrolle prüfen will (sieht den
Beitragsstatus, aber **nicht** die IBAN), legt zusätzlich ein Konto mit `VERWALTUNG` an. Weitere Konten
(Verwaltung, Dozent) lassen sich auch in der Oberfläche anlegen: Verwaltung → Personen → „Person anlegen“ und
dort die Rollen setzen (Recht des Administrators).

### 1.4 Anmeldeformular — schon da

Der Seed hat bereits ein **veröffentlichtes** Standardformular mit einem Art.-9-Feld (Glaubensangabe)
angelegt, `/anmeldung` funktioniert also sofort — an diesem Feld hängt der Einwilligungstest in Aufgabe
A1. Nur wer das Formular für den Test **anpassen** möchte, tut das unter **`/verwaltung/formulare`**:
ändern und als neue Fassung veröffentlichen.

### 1.5 Die „Poststelle": Magic-Links aus dem Log holen

Im Test wird keine echte E-Mail verschickt. Stattdessen steht jeder Anmelde- und Bestätigungslink im
**Serverlog** (bewusst nur außerhalb der Produktion — in Produktion ist der Link ein vollwertiger
Kontoschlüssel und wird nie geloggt). Ablauf beim Test: Die Person klickt „Anmeldelink anfordern", der
Betreuer holt die Zeile aus dem Log und reicht den Link weiter — so, als käme er per Mail. Wer es
realistischer will, richtet vorher echten Mailversand mit einem Test-Postfach ein.

### 1.6 Zwei Geräte, wenn möglich

Der E-Mail-Änderungsweg und der Zugang-wiederherstellen-Weg sind so gebaut, dass ein Link auf einem
**anderen** Gerät oder in einem privaten Fenster eingelöst wird. Ein Smartphone neben dem Rechner macht
den Test realistischer.

---

## Teil 2 · Aufgaben für die Testperson

Die Person bekommt **nur die Aufgabentexte** unten — nicht die Seitennamen, nicht die Klickwege. Sie soll
selbst herausfinden, wie es geht. Der Betreuer schreibt zu jeder Aufgabe mit: **geschafft / mit Mühe /
nicht geschafft**, und wo es hakte.

### Block A — als Interessent und Teilnehmer

**A1 · Sich für die Bibelschule anmelden.**
„Stell dir vor, du hast von der Gemeindebibelschule gehört und möchtest dich anmelden. Finde das
Anmeldeformular und fülle es aus." — Startpunkt ist die Adresse der Anwendung (im Test
`http://localhost:3000`). Beobachten: Findet sie `/anmeldung`? Ist klar, welche Felder Pflicht sind? Ist
die **Einwilligung** zur Glaubensangabe verständlich — und lässt sich das Formular absenden, ohne sie zu
geben (soll **nicht** gehen)? Kommt am Ende eine klare Bestätigung?

**A2 · Das Ausfüllen unterbrechen und später fortsetzen.**
„Du wirst mittendrin gestört. Schließ den Tab. Setz später fort, wo du warst." — Gibt es einen
Fortsetzen-Link? Kommt er an? Sind die Angaben noch da? Seit Code-Review 4 nennt ein gelber Hinweis vor
„Später weitermachen“, was **nicht** gespeichert wird (die Glaubensabschnitte und die IBAN), der Link lässt
sich per Knopf kopieren, und beim Fortsetzen steht dort, dass die Zustimmungen neu zu setzen sind. Versteht
die Person das? Schließt sie den Tab mit solchen Eingaben, warnt der Browser — erschreckt sie das oder hilft es?

**A3 · Sich zum ersten Mal einloggen.**
Nachdem die Schulleitung die Anmeldung aufgenommen hat (Block B, der Betreuer macht das zwischendurch):
„Du hast die Zusage bekommen und sollst dich jetzt einloggen." — Findet sie den Anmeldeweg? Fordert sie
den Link an, löst ihn ein, landet sie bei den eigenen Daten (`/meine-daten`)?

**A4 · Ein Passwort einrichten.**
„Damit du auch reinkommst, wenn du mal keinen Zugriff auf dein Postfach hast, richte ein Passwort ein." —
Findet sie es in „Meine Daten"? Ist die Längenregel verständlich (mind. 10 Zeichen, ganze Sätze erlaubt)?
Danach: einmal abmelden und **mit dem Passwort** wieder anmelden.

**A5 · Umgezogen — die Adresse ändern.**
„Du bist umgezogen. Trag deine neue Anschrift ein." — Wirkt die Änderung sofort? Ist klar, dass die
Bankverbindung dabei **nicht** verschwindet, obwohl das Feld leer aussieht?

**A6 · Neue E-Mail-Adresse.**
„Du hast eine neue E-Mail-Adresse und möchtest dich künftig damit anmelden." — Hier läuft ein
Bestätigungsweg: Der Link geht an die **neue** Adresse (im Test: ins Log), ein Hinweis an die alte. Erst
nach dem Klick gilt die neue Adresse. Ist dieser Ablauf verständlich, oder wirkt es kaputt, weil sich
zunächst „nichts" ändert?

**A7 · Ausgesperrt.**
„Stell dir vor, du kommst gar nicht mehr rein — Passwort vergessen und keinen Zugriff aufs Postfach.
Was tust du?" — Findet sie `/anmelden/hilfe`? Ist die Meldung, die sie absenden kann, verständlich, und
ist klar, dass sich jetzt ein Mensch meldet?

**A8 · Am fremden Rechner abmelden.**
„Du hast am Rechner im Gemeindebüro nachgesehen. Melde dich ab, damit niemand nach dir in deine Daten
schaut.“ — Findet sie den Knopf? Landet sie auf der Anmeldeseite? Ruft sie danach `/anmelden` erneut auf,
darf dort keine laufende Sitzung mehr stehen (vorher zeigt die Seite eine laufende Sitzung samt Abmelde-Knopf).
Nach dem Absenden einer Adresse bietet `/anmelden` „Andere Adresse eingeben“ — wird das gefunden, wenn man
sich vertippt hat?

### Block B — als Schulleitung / Verwaltung

Für diesen Block meldet sich die Testperson mit dem Schulleitungskonto an (1.3) — oder der Betreuer führt
ihn vor und die Person schaut zu und kommentiert.

**B1 · Eine Anmeldung ansehen und aufnehmen.**
„Es ist eine neue Anmeldung eingegangen (die aus A1). Sieh sie dir an und nimm die Person auf." — Findet
sie `/verwaltung/anmeldungen` und dort „Antworten ansehen“? Ist erkennbar, was die Person angegeben hat? Ist
die Aufnahme ein klarer, bewusster Schritt? Als Schulleitung sind die Glaubensangaben sichtbar (die
Einwilligung liegt vor), als Verwaltung ausgeblendet; „Akte öffnen“ führt zur Person. Nach dem Aufnehmen bleibt
die Meldung stehen, bis „Ansicht aktualisieren“ geklickt wird. Der Stand heißt danach „Angenommen“.

**B2 · Die Teilnehmerliste ansehen und als Excel herunterladen.**
Erwartung: Die eben aufgenommene Person steht in der Liste; die heruntergeladene Datei enthält die
Teilnehmer, aber **keine IBAN**.

**B3 · Jemandem den Zugang wiederherstellen.**
„Ein Teilnehmer meldet, dass er nicht mehr reinkommt. Ändere seine Anmeldeadresse und schick ihm einen
neuen Anmeldelink." — Über `/verwaltung/personen`. Ist klar, dass das eine ernste Sache ist (es ist
faktisch eine Kontoübernahme)?

**B4 · Das Protokoll ansehen.**
„Wo kannst du nachsehen, was in den letzten Minuten alles passiert ist?" — `/verwaltung/protokoll`. Sind
die Einträge verständlich? Steht dort **nirgends** eine IBAN oder ein Passwort — und seit Code-Review 4 auch
kein Name und keine Adresse in den Alt-/Neuwerten, sondern nur die Namen der geänderten Felder?

### Block C — Schulleitung im Semesterbetrieb (mit dem Betreuer)

Diese Aufgaben brauchen Vorbereitung durch den Betreuer (Teilnahmen, Unterrichtsabende, Noten). Die Testperson
bedient, der Betreuer richtet die Daten ein und holt Links aus dem Log.

**C1 · Ausbildungsdaten und Status ändern.**
„Ein Teilnehmer pausiert ein Semester, und sein Geburtsdatum ist falsch eingetragen. Korrigiere beides.“ —
Personenakte, Block „Ausbildungsdaten & Status“ (nur Schulleitung). Ist die Rückfrage verständlich (die Person
fällt aus den Semesterlisten)? Wird beim Wechsel in einen Endzustand klar, dass er **nicht** rückgängig zu
machen ist, und dass dafür ein Grund nötig ist? Bei „Absolvent“: Ist klar, dass erst das Abschlusszeugnis
kommen sollte? „Anmeldelink schicken“ meldet eine gescheiterte Zustellung als Fehler, nicht als Erfolg.

**C2 · Das nächste Semester vorbereiten.**
„Lade den Jahrgang ins nächste Semester ein.“ — `/verwaltung/semesterueberleitung`. Danach, als Teilnehmer
mit dem Link aus dem Log: „Ich bin raus“ (Rückfrage), die Antwort auf „Ich bin dabei“ ändern und wieder auf
„raus“. Zurück als Schulleitung: Zeigt die Übersicht „abgemeldet“ mit Grund? Lässt sich die Person über
„Wieder aufnehmen“ zurückholen? Ist die Frist in Mail und Seite („bis einschließlich …“) verständlich?

**C3 · Noten eintragen.**
„Trag für ein Fach Noten ein und wechsle dann zu einem anderen Semester.“ — Die Auswahl wechselt erst mit
„Anzeigen“; bei ungespeicherten Noten fragt der Browser nach. Hörer stehen nicht in der Liste (der Hinweistext
sagt das). In der Personenakte ist „— nicht bewertet“ bei schon bewerteten Fächern gesperrt, und nach dem
Speichern stimmt die Anzeige.

**C4 · Zeugnisse ausstellen.**
„Stell für das Semester die Zeugnisse aus.“ — Semester und Art wählen, „Anzeigen“, dann „Alle ausstellen“.
Nennt die Rückfrage verständliche Zahlen (unbewertete Fächer, Teilnehmer ohne jede Bewertung), und lässt sie
sich abbrechen? Bei Art „Abschlusszeugnis“ außerhalb des letzten Semesters ist der Knopf gesperrt — ist der
Grund verständlich? Solange eine geänderte Auswahl nicht angezeigt ist, ist „Alle ausstellen“ gesperrt.
Erscheint der gelbe Kasten „noch nicht im DMS archiviert“, ist klar, was „An das DMS nachsenden“ tut?

**C5 · Ein Honorar abrechnen (optional, Verwaltung).**
„Rechne die gehaltenen Abende einer Dozentin ab und gib die Abrechnung frei.“ — Nennt die Rückfrage Dozentin,
Abende und Betrag? Ohne hinterlegte Bankverbindung ist „Freigeben“ gesperrt, mit Hinweis, dass die Dozentin sie
selbst unter „Meine Daten“ einträgt. Ohne DMS-Adresse steht statt „Beleg erneut senden“ ein Hinweis. Eine
offene Abrechnung lässt sich mit Rückfrage stornieren; im Stundenplan ist ein abgerechneter Abend gekennzeichnet
und der Dozent dort nicht mehr änderbar.

### Worauf bei jeder Aufgabe zu achten ist

- **Verständlichkeit:** Weiß die Person jederzeit, was als Nächstes zu tun ist?
- **Fehlermeldungen:** Wenn etwas schiefgeht — sagt die Meldung in normalem Deutsch, was zu tun ist?
- **Sackgassen:** Gibt es Seiten ohne Weg zurück oder ohne erkennbaren nächsten Schritt?
- **Sprache:** Tippfehler, Denglisch, unklare Fachwörter?
- **Tempo:** Fühlt sich etwas hängend oder unfertig an (fehlende Ladeanzeige)?
- **Handy:** Wenn ein Smartphone da ist, A1 und A3 auch dort — passt die Darstellung?
- **Orientierung:** Jede Seite hat einen eigenen Tab-Titel („… · GBS Campus“) und oben eine Zurück-Leiste
  mit Krümelspur. Hilft das, oder wird es übersehen?
- **Fehlerseite:** Erscheint sie, zeigt sie einen Fehlercode. Den bitte mitschreiben — der Betrieb findet
  ihn im Server-Log.

---

## Teil 3 · Rückmeldebogen

Pro Aufgabe eine Zeile. Der Betreuer füllt ihn während des Tests aus.

| Aufgabe | Geschafft? (ja / mit Mühe / nein) | Wo hakte es? | Zitat / Reaktion der Person |
|---|---|---|---|
| A1 Anmelden | | | |
| A2 Fortsetzen | | | |
| A3 Erstes Login | | | |
| A4 Passwort | | | |
| A5 Adresse | | | |
| A6 E-Mail | | | |
| A7 Ausgesperrt | | | |
| A8 Abmelden | | | |
| B1 Aufnehmen | | | |
| B2 Teilnehmerliste | | | |
| B3 Zugang | | | |
| B4 Protokoll | | | |
| C1 Ausbildungsdaten & Status | | | |
| C2 Semesterüberleitung | | | |
| C3 Noten | | | |
| C4 Zeugnisse | | | |
| C5 Honorar | | | |

**Drei Abschlussfragen an die Person:**
1. Was war der verwirrendste Moment?
2. An welcher Stelle hättest du beinahe aufgegeben?
3. Würdest du dich damit ohne fremde Hilfe anmelden trauen?

Anschließend die Findings nach **Blocker / stört / Kosmetik** sortieren. Blocker vor dem Livegang beheben,
den Rest terminieren.

---

## Teil 4 · Go-Live-Checkliste (20.08.)

Zusammengetragen aus [`UEBERGABE.md`](UEBERGABE.md). Der Laientest ist nur der erste Punkt.

### Inhalt und Daten
- [ ] Laientest durchgeführt, Blocker-Findings behoben
- [ ] Durchstich gegen das gebaute Image grün (Soll 764) und `npm run pruefen:db` grün — nach Code-Review 4
  noch nicht gelaufen, siehe [`UEBERGABE.md`](UEBERGABE.md)
- [ ] Handprüfungen aus Teil 5 erledigt
- [ ] Mindestens **ein Semester** in der Produktivdatenbank angelegt und als laufend gesetzt (bei leerer
  Datenbank legt der Seed die sechs realen Semester an — Daten, Lehrjahr/Halbjahr und Anmeldefenster prüfen)
- [ ] Anmeldeformular in der endgültigen Fassung veröffentlicht. **Bestandsinstallation:** In der
  Einleitung steht der Satz „Mit * gekennzeichnete Felder sind Pflichtangaben.“ doppelt — Formulare → Entwurf
  öffnen → Satz aus „Einleitung über dem Formular“ löschen → veröffentlichen
- [ ] Einwilligungstexte endgültig: Korrekturen nur als neue Fassung (`version + 1`), nie am bestehenden Text
- [ ] Konfigurierbare Werte geprüft: Anmeldelink-Gültigkeit, Drosselschwellen, Sitzungsdauer, Rabatte

### E-Mail-Zustellung (Show-Stopper — hängt am IT-Dienstleister)
- [ ] Absenderadresse festgelegt
- [ ] SPF, DKIM und DMARC für die **Absenderdomain** gesetzt (nicht für die App-Domain)
- [ ] Magic-Link-Zustellung gegen **GMX, web.de, Gmail und Outlook** geprüft — Posteingang, nicht Spam

### Betrieb und Sicherheit
- [ ] Restore-Drill: einen Backup-Dump testweise in eine leere Datenbank eingespielt
- [ ] Off-Site-Backup-Ziel eingerichtet (der Dump liegt sonst auf demselben Host wie die Datenbank)
- [ ] Break-Glass-Tresor befüllt: `ENCRYPTION_KEY`, `SESSION_SECRET`, DB-Passwort sicher hinterlegt
  (ein verlorener `ENCRYPTION_KEY` macht alle verschlüsselten Felder unlesbar)
- [ ] Externer Uptime-Ping eingerichtet
- [ ] Speichergrenze für den App-Container gesetzt (Empfehlung 768 MB), sonst trifft der OOM-Killer
  im Zweifel die Datenbank
- [ ] Getrennter, rechtebeschränkter Datenbanknutzer: `APP_DB_PASSWORD` gesetzt — mindestens 16 Zeichen,
  nur Buchstaben und Ziffern (`openssl rand -hex 24`), sonst bricht der Start ab; ohne Passwort verbindet sich
  die App als Eigentümer und könnte die Append-only-Trigger entfernen. Auch `DB_PASSWORD` nur aus Buchstaben
  und Ziffern
- [ ] `APP_URL` = genau die Adresse, unter der das Portal im Browser geöffnet wird (`https://`, derselbe Host
  wie `APP_DOMAIN`) — sonst startet der Container nicht bzw. jede Änderung scheitert mit 403
- [ ] `DMS_EMAIL` gesetzt (sonst bleiben Honorar-Belege und Zeugnis-Archivkopien als „noch nicht im DMS“ stehen)
- [ ] `docker/traefik-dynamisch.yml` liegt auf dem Server neben `docker-compose.yml`; erster Deploy mit
  `docker compose up -d --force-recreate`, danach das alte Netz entfernen (`docker network rm gbs-campus_edge`)
- [ ] **Staging-Probe des ganzen Stacks mit TLS:** `docker compose config` ohne Fehler, Stack fünfmal neu
  starten, `/api/health` über Traefik liefert dabei nie 502/504, Traefik-Log sauber
- [ ] Worker-Healthcheck grün, Betriebsansicht zeigt „Worker zuletzt gelaufen“ ohne Warnung
- [ ] In GitHub unter Branch-Schutz den Job „Typpruefung und Pruefskripte“ als Pflicht-Check für `main`
  eintragen
- [ ] Content-Security-Policy nachgezogen — spätestens bevor irgendwo Formulartexte als Markdown
  gerendert werden
- [ ] Im Betrieb beobachten: Audit-Aktion `ANMELDUNG_VERWORFEN_FANGFELD` (Roboter oder still verworfene echte
  Anmeldung) und die Kachel „Belege noch nicht im DMS“

### Zwei Betriebsentscheidungen (siehe zweiter Review-Bericht, Abschnitt 07)
- [ ] Wer sieht die Betriebsansicht mit den Störungswarnungen? (hängt aktuell allein am Administrator)
- [x] Token im Zugriffsprotokoll des Proxy: ins Adressfragment verlegt — Anmelde- und Auskunftslink tragen den Token jetzt im `#`-Fragment, das der Browser nicht an den Server schickt (29.07.); seit 27.09. auch der E-Mail-Bestätigungslink und der Zwischenstand der Anmeldung (`#fortsetzen=`)

### Datenschutz (kein Softwarethema, aber vor dem Livegang zu klären)
- [ ] Art.-9-Einwilligung als Pflichtfeld gegen das Kopplungsverbot (Art. 7 Abs. 4 DSGVO) — Frage an den
  Datenschutzbeauftragten
- [ ] **E-17**: der Altzugang im früheren M365-Tenant ist unabhängig von dieser Software zu prüfen und zu
  entziehen — gehört zum Datenschutzbeauftragten, nicht ins Release

### Offene Entscheidungen aus Code-Review 4
- [ ] Die Liste „Offene Entscheidungen“ in [`UEBERGABE.md`](UEBERGABE.md) mit der Schulleitung durchgehen —
  vor dem Livegang mindestens: Rollenvergabe durch den Administrator, Honorar-Selbstabrechnung, Widerruf der
  Art.-9-Einwilligung, Löschfrist für abgelehnte Bewerber, Aufbewahrung der Zeugnisse beim Löschen einer Person,
  Du/Sie im Anmeldeformular

---

## Teil 5 · Handprüfungen vor dem Livegang (Betreuer)

Diese Punkte prüft der automatische Durchstich nicht, weil er ohne Browser (per curl) arbeitet. Der Betreuer
geht sie einmal selbst durch — am besten auf der Staging-Instanz mit HTTPS, denn das Sitzungscookie trägt nur
dort seinen `__Host-`-Namen.

**Formular-Builder** (`/verwaltung/formulare`, Entwurf öffnen)
- [ ] Im Feld „Antwortmöglichkeiten“ am Ende Enter drücken und eine neue Zeile tippen: Die Zeile bleibt, der
  Fokus bleibt im Feld, Leerzeichen innerhalb einer Antwort bleiben. Bereinigt wird erst beim Verlassen des Felds.
- [ ] In Abschnittstitel und Feldschlüssel tippen: Der Fokus springt nach keinem Tastendruck weg.
- [ ] Formular öffnen, **nichts** ändern, Entwurf speichern: gelingt, die Schüler/Hörer-Zuordnung ist vorbelegt.
- [ ] Ein Feld dem Aktenfeld „Gemeinde“ zuordnen: „Besonders geschützt (Art. 9)“ wird gesetzt und lässt sich
  nicht abwählen.

**Öffentliches Formular** (`/anmeldung`)
- [ ] Glaubensangaben oder IBAN eintragen, „Später weitermachen“, dann den Tab schließen: Der Browser warnt.
  Ohne solche Eingaben warnt er nach dem Zwischenspeichern nicht.
- [ ] Den Link mit `#fortsetzen=` in einem neuen Tab öffnen: Der Stand ist wieder da.
- [ ] Den Art.-9-Haken setzen: Die Glaubensabschnitte erscheinen, eine Ansage kommt, der Fokus springt dorthin;
  vorher nennt der Platzhalter die Einwilligung.
- [ ] Vorlesesoftware liest bei Pflichtfeldern „(Pflichtangabe)“ vor.

**Verwaltung**
- [ ] Nach „Aufnehmen“ oder „Ablehnen“ in der Antwortansicht bleibt die Meldung stehen, bis „Ansicht
  aktualisieren“ geklickt wird.
- [ ] „Rollen speichern“ fragt mit den entzogenen und hinzugefügten Rollen nach; beim Entzug der eigenen
  Administratorrolle kommt eine eigene Warnung.
- [ ] „Anonymisieren“ steht abgesetzt unter „Löschung nach Art. 17 DSGVO“, die Rückfrage nennt Zeugnisse,
  geschlossene Anmeldungen und Rollen.
- [ ] Die Personenliste zeigt die Quote wie die Akte (✓ erfüllt / • offen / ✕ nicht erreichbar); „Person
  anlegen“ führt zur neuen Akte. Bei einer nicht mehr erreichbaren Quote rät die Detailakte der Schulleitung
  nicht, sich „an die Schulleitung“ zu wenden.
- [ ] Stundenplan: Die Semesterwahl wechselt erst mit „Anzeigen“; abgerechnete Abende sind gekennzeichnet.
- [ ] Rückmeldungen (gespeichert, Fehler) werden von der Vorlesesoftware angesagt.

**Dozent und Teilnehmer**
- [ ] Als Dozent in „Meine Daten“: Der Rückweg „← Mein Unterricht“ ist da. „Jetzt erfassen“ bei den offenen
  Aufgaben springt zum Abend.
- [ ] Nach einer IBAN-Änderung in „Meine Daten“ geht die Hinweis-Mail an die hinterlegte Adresse (im Test: Log).
- [ ] Die Einladung und die Erinnerungen der Überleitung nennen die Antwortfrist.

**Sitzung und Fehlerfälle**
- [ ] **Abmelden im Browser entfernt die Sitzung wirklich** (auf HTTPS): Danach ist das Cookie in den
  Entwicklerwerkzeugen weg, und die Zurück-Taste zeigt nach dem Neuladen keine Daten.
- [ ] Mit abgelaufener Sitzung einen Download-Link anklicken (Zeugnis-PDF, Excel): Es kommt die Anmeldeseite
  bzw. eine lesbare Fehlerseite, kein rohes JSON.
- [ ] Mit abgelaufener Sitzung speichern: Die Meldung sagt „Deine Sitzung ist abgelaufen …“ (Anmelden im neuen
  Tab, dann erneut versuchen).
- [ ] Die lokale Testinstanz einmal unter einer anderen Adresse als `APP_URL` öffnen (etwa `localhost:3000`
  statt `127.0.0.1:3000`) und etwas speichern: 403 mit verständlicher Meldung, im Server-Log `[HERKUNFT]`.
