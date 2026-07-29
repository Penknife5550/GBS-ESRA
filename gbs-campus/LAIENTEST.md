# Laientest — Drehbuch und Go-Live-Checkliste

Dieser Test soll finden, was den Entwicklern durch Betriebsblindheit entgeht: unklare Texte,
Sackgassen, missverständliche Schaltflächen, Fehlermeldungen, die niemand versteht. Er wird von
**einer projektfremden Person** durchgeführt — jemandem, der die Software nie gesehen hat und idealerweise
auch nicht besonders technikaffin ist. Genau deren Stolpersteine zählen.

Das Dokument hat drei Teile:

1. **Vorbereitung** — was der Betreuer vor dem Termin einrichtet (die Testperson fasst keine Technik an).
2. **Aufgaben** — was die Testperson tut, in Alltagssprache, ergebnisoffen.
3. **Go-Live-Checkliste** — alles, was vor dem Livegang am 20.08. zusätzlich zu erledigen ist.

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

### 1.3 Ein Verwaltungskonto anlegen

Für die Verwaltungsseite (Teil 2, Abschnitt B) ein Konto mit Schulleitungsrolle. Das Skript liegt nur
außerhalb des Produktions-Images:

```bash
npx tsx scripts/testperson-anlegen.ts leitung-test@beispiel.de SCHULLEITER
```

Der Anmeldelink erscheint danach im Serverlog. Wer auch die reine Verwaltungsrolle prüfen will (sieht den
Beitragsstatus, aber **nicht** die IBAN), legt zusätzlich ein Konto mit `VERWALTUNG` an.

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
Fortsetzen-Link? Kommt er an? Sind die Angaben noch da?

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

### Block B — als Schulleitung / Verwaltung

Für diesen Block meldet sich die Testperson mit dem Schulleitungskonto an (1.3) — oder der Betreuer führt
ihn vor und die Person schaut zu und kommentiert.

**B1 · Eine Anmeldung ansehen und aufnehmen.**
„Es ist eine neue Anmeldung eingegangen (die aus A1). Sieh sie dir an und nimm die Person auf." — Findet
sie `/verwaltung/anmeldungen`? Ist erkennbar, was die Person angegeben hat? Ist die Aufnahme ein klarer,
bewusster Schritt?

**B2 · Die Teilnehmerliste ansehen und als Excel herunterladen.**
Erwartung: Die eben aufgenommene Person steht in der Liste; die heruntergeladene Datei enthält die
Teilnehmer, aber **keine IBAN**.

**B3 · Jemandem den Zugang wiederherstellen.**
„Ein Teilnehmer meldet, dass er nicht mehr reinkommt. Ändere seine Anmeldeadresse und schick ihm einen
neuen Anmeldelink." — Über `/verwaltung/personen`. Ist klar, dass das eine ernste Sache ist (es ist
faktisch eine Kontoübernahme)?

**B4 · Das Protokoll ansehen.**
„Wo kannst du nachsehen, was in den letzten Minuten alles passiert ist?" — `/verwaltung/protokoll`. Sind
die Einträge verständlich? Steht dort **nirgends** eine IBAN oder ein Passwort?

### Worauf bei jeder Aufgabe zu achten ist

- **Verständlichkeit:** Weiß die Person jederzeit, was als Nächstes zu tun ist?
- **Fehlermeldungen:** Wenn etwas schiefgeht — sagt die Meldung in normalem Deutsch, was zu tun ist?
- **Sackgassen:** Gibt es Seiten ohne Weg zurück oder ohne erkennbaren nächsten Schritt?
- **Sprache:** Tippfehler, Denglisch, unklare Fachwörter?
- **Tempo:** Fühlt sich etwas hängend oder unfertig an (fehlende Ladeanzeige)?
- **Handy:** Wenn ein Smartphone da ist, A1 und A3 auch dort — passt die Darstellung?

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
| B1 Aufnehmen | | | |
| B2 Teilnehmerliste | | | |
| B3 Zugang | | | |
| B4 Protokoll | | | |

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
- [ ] Mindestens **ein Semester** in der Produktivdatenbank angelegt und als laufend gesetzt
- [ ] Anmeldeformular in der endgültigen Fassung veröffentlicht
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
- [ ] Getrennter, rechtebeschränkter Datenbanknutzer (die App verbindet sich sonst als Eigentümer und
  könnte die Append-only-Trigger entfernen)
- [ ] Content-Security-Policy nachgezogen — spätestens bevor irgendwo Formulartexte als Markdown
  gerendert werden

### Zwei Betriebsentscheidungen (siehe zweiter Review-Bericht, Abschnitt 07)
- [ ] Wer sieht die Betriebsansicht mit den Störungswarnungen? (hängt aktuell allein am Administrator)
- [x] Token im Zugriffsprotokoll des Proxy: ins Adressfragment verlegt — Anmelde- und Auskunftslink tragen den Token jetzt im `#`-Fragment, das der Browser nicht an den Server schickt (29.07.)

### Datenschutz (kein Softwarethema, aber vor dem Livegang zu klären)
- [ ] Art.-9-Einwilligung als Pflichtfeld gegen das Kopplungsverbot (Art. 7 Abs. 4 DSGVO) — Frage an den
  Datenschutzbeauftragten
- [ ] **E-17**: der Altzugang im früheren M365-Tenant ist unabhängig von dieser Software zu prüfen und zu
  entziehen — gehört zum Datenschutzbeauftragten, nicht ins Release
