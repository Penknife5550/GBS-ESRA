# GBS Campus — Software für die Gemeindebibelschule Minden

**Stand: 27.09.2026** · Träger: Christliches Werk Esra e.V. · Kursstart Jahrgang 2026–29: 15.09.2026

---

## Wo das Projekt steht

**Gebaut sind die Releases 0.1 bis 0.4** — Anmeldung, Formular-Builder, Akte, Semester und Excel-Export
(0.1), Stundenplan, Anwesenheit, Semesterüberleitung, Worker und Löschkonzept (0.2), Honorar-Abrechnung und
eigene Bereiche für Dozent und Schüler (0.3), Noten, Zeugnisse und der UI-Umbau (0.4). Ob 0.1 schon live ist,
geht aus dem Repo nicht hervor.

Am **27.09.2026** hat ein viertes Code-Review ([`10_Code-Review-4.md`](10_Code-Review-4.md)) 19 MAJOR-Befunde
ergeben, darunter drei, die den Betrieb komplett lahmlegen konnten, und zwei zur Löschzusage nach Art. 17.
**Alle 19 und der größte Teil der MINOR-Befunde sind behoben** — auf dem Branch `fix/code-review-4`, noch nicht
committet. Dazu kamen vier verbindliche Fachentscheidungen (Anonymisierung auch der Zeugnis-Snapshots; „bin raus“
meldet die Teilnahme ab, nicht die Person; ABSOLVENT ist kein Endzustand; die Gemeindezugehörigkeit bleibt in
Export und Oberfläche).

**Verifiziert (27.09.2026, abends):** Typprüfung fehlerfrei, **1229 Prüfungen der Fachlogik in 20
Skripten** grün, Produktionsbuild grün, alle 24 Migrationen gegen eine echte Postgres-Engine (PGlite) fehlerfrei
und ohne Abweichung vom Schema.

> **🟢 Durchstich gegen das gebaute Image: 787/787 grün**, dazu die DB-Prüfungen (`pruefen:db`) 19 + 18 grün.
> Code-Review 4, durchgängig „Sie“ und der Schutz vor Massenanmeldungen (Entscheidungen E-22/E-23) sind in
> `main` — Befehle zum Wiederholen ganz
> oben in [`gbs-campus/UEBERGABE.md`](gbs-campus/UEBERGABE.md).

| | |
|---|---|
| **Release 0.1** | geplant live am **20.08.2026** — der einzige harte Termin |
| **Versprechen** | Jahrgang 2026–29 meldet sich nicht mehr über Microsoft Forms an. Daten liegen in Deutschland, in einer Akte, mit Export. |
| **Domain** | `gbs.fes-credo.de` |
| **Release 0.2** | gebaut — Stundenplan, Selbstbestätigung, Dozentenhonorar, Semesterüberleitung, Worker, Löschkonzept |
| **Release 0.3** | im Code teilweise — Honorar-Abrechnung, Dozenten- und Schülerbereich; offen: Optigem, Beitragslauf |
| **Release 0.4** | im Code — Noten, Zeugnisse, UI-Umbau |

---

## Die wichtigsten Dateien

| Datei | Was drinsteht | Wann brauchst du sie |
|---|---|---|
| [`1_Bauplan.html`](1_Bauplan.html) | **Der fachliche Wahrheitsstand.** Auftrag, Scope-Schnitt, Rollen, Statusmaschine, Module M0–M11, drei Releases, Docker-Betriebsmodell, Termine, Entscheidungsregister E-01…E-21 (E-18 bis E-21: Fachentscheidungen vom 27.09.2026), Risiken. | Für jede fachliche Frage. Hier wird jede Statusänderung nachgetragen. |
| [`2_Code-Review.html`](2_Code-Review.html) | **Der Review-Report vom 27.07., vormittags.** Alle 11 GoLive-Blocker mit Nachweis, gebündelte MAJOR-Befunde, was gut ist, Reihenfolge zum Beheben. | Um zu verstehen, warum der Code an bestimmten Stellen so aussieht, wie er aussieht. |
| [`3_Code-Review-2.html`](3_Code-Review-2.html) | **Das zweite Review vom selben Abend samt Komplettfix.** 160 Befunde, die sechs Blocker mit Begründung, was daraus im Code entstand — und der blinde Fleck: Nichts davon ist geprüft. | Bevor du am Code vom Abend des 27.07. etwas anfasst. Und für die drei offenen Betriebsentscheidungen. |
| [`gbs-campus/README.md`](gbs-campus/README.md) | **Der technische Einstieg.** Wie man startet, was im Fundament steckt, was verifiziert wurde und wie. | Bevor du eine Zeile Code anfasst. |
| [`gbs-campus/UEBERGABE.md`](gbs-campus/UEBERGABE.md) | **Der Einstieg in eine neue Arbeitssitzung.** Was zuerst zu tun ist, neue Regeln, Fallen dieser Umgebung, offene Entscheidungen. | Zu Beginn jeder Sitzung, zuerst der Abschnitt „Neuester Stand“. |
| [`9_Bestandsaufnahme-2026-09-26.md`](9_Bestandsaufnahme-2026-09-26.md) | **Die Bestandsaufnahme vom 26.09.** Stand laut Repo nach zwei Monaten Pause, offene Punkte, Abweichungen zwischen Plan, Code und Doku. | Um den Stand vor Code-Review 4 zu verstehen. |
| [`10_Code-Review-4.md`](10_Code-Review-4.md) | **Das vierte Code-Review vom 27.09.** 19 MAJOR-Befunde samt Gegenprüfung, MINOR/INFO-Liste, Prioritäten — und am Ende der Abschnitt „Stand der Behebung“ mit Status je Befund und Verifikationsstand. | Bevor du an Betrieb, Anonymisierung, Semesterüberleitung, Honorar, Zeugnissen oder Formular-Builder etwas änderst. |
| `Interview-Peter-2026-07-25.rtf` | Die Quelle: das Gespräch mit dem Schulleiter. **Achtung, der Dateiname führt in die Irre** — die Datei ist byte-identisch mit der ursprünglichen `Anforderungen.rtf` (MD5 `dd7aa28e…3fb644`). Es ist kein zweites Gespräch. Lesbare Textfassung: `Archiv/Interview-Transkript.txt`. Liegt nur lokal (per `.gitignore` nicht im Repo). | Wenn du wissen willst, was der Schulleiter wirklich gesagt hat — **immer im Volltext nachsehen, nie nur in der Zusammenfassung**. Genau diese Abkürzung hat schon einmal dazu geführt, dass ein gewünschtes Feature gestrichen wurde. |

Daneben liegen das dritte Review ([`4_Code-Review-3.html`](4_Code-Review-3.html), 29.07.) und die
Planungsdokumente vom Juli/August: [`4_Stand-und-Ausblick.html`](4_Stand-und-Ausblick.html),
[`5_Massnahmenplan.html`](5_Massnahmenplan.html), die Prozesslandschaften aus Sicht des Dozenten
([`6_…`](6_Prozesslandschaft-Lehrer.html)) und des Schülers ([`7_…`](7_Prozesslandschaft-Schueler.html)) sowie
der Plan zum UI-Umbau ([`8_UI-Neustrukturierung-Plan.html`](8_UI-Neustrukturierung-Plan.html)).

> Tipp: In den HTML-Dokumenten schaltet die Taste **`t`** zwischen hell und dunkel um.

---

## Was fertig ist

- **M0 Fundament** — Datenmodell, Statusmaschine als Tabelle, Rollen- und Rechtematrix als Datensatz,
  append-only Audit-Log, Docker-Stack mit Traefik, funktionierendes Backup
- **M0 Anmeldung** — Magic-Link (einmalig, per POST eingelöst, nur als Hash gespeichert, gedrosselt),
  Sitzungen, serverseitige Rechteprüfung, Abmelden
- **M2 Formular-Builder** — versionierte Anmeldeformulare, Feldzuordnung in die Akte,
  Art.-9-Kennzeichnung, Vorschau
- **M2 Öffentliche Anmeldung** — `/anmeldung` ohne Login, getrenntes Consent-Protokoll,
  Fortsetzen-Link, Aufnahme in die Akte, Entscheidung durch die Schulleitung
- **Einstellungen** — Gültigkeit der Anmeldelinks, Drosselschwellen, Sitzungsdauer; wirkt ohne Neustart
- **Ermäßigungen** — Ehepartner-Rabatt 50 % als Datensatz, auflösbare Ehepaar-Kopplung
- **Betrieb** — Ansicht für nicht zugestellte E-Mails, Bankverbindung für den Beitragseinzug
- **Semester und Teilnehmerliste** — Semester anlegen und das laufende festlegen, Anmeldungen tragen
  ihr Semester, Liste „Aktive dieses Semester" mit **Excel-Export** (ohne Bankverbindung, jeder Export
  im Audit-Log). Das ist das Stück, das die chaotische Excel-Liste des Schulleiters ablöst.
- **Schülerakte mit Selbstpflege** — Teilnehmer ändern Adresse, Telefon und Bankverbindung selbst;
  die E-Mail-Adresse über einen Bestätigungsweg, weil sie der einzige Zugang zum Portal ist. Die
  Verwaltung wird über jede Änderung informiert.
- **Zugang wiederherstellen** — ein eigenes „Passwort vergessen“-Verfahren gibt es bewusst nicht: Das Passwort
  ist freiwillig, und der Anmeldelink ist der Weg zurück. Für den echten Fall — Adresse vergessen oder
  Postfach verloren — gibt es das Meldeformular `/anmelden/hilfe` und die Gegenseite unter Verwaltung →
  Personen: Adresse ändern, Anmeldelink schicken, beides protokolliert. **Geändert wird erst, wenn ein Mensch
  die Person erkannt hat** — sonst wäre es eine Kontoübernahme per Formular.
- **Release 0.2 bis 0.4** — Stundenplan und Anwesenheit mit 80-%-Quote, Semesterüberleitung mit „bin dabei /
  bin raus“, Worker, Anonymisieren statt Löschen (Art. 17), Benutzerverwaltung, Honorarsätze, Abrechnung und
  Auszahlung mit DMS-Beleg, eigene Bereiche für Dozent und Schüler, Noten und Zeugnisse. Einzelheiten im README.
- **Nach Code-Review 4 (27.09.)** — Schutz gegen fremde Anfragen (CSRF), bedienbare Statusmaschine,
  Antwortansicht der Anmeldungen, Nachversand nicht angekommener DMS-Belege, Storno offener Honorarabrechnungen,
  eingefrorene Belege und Einwilligungstexte auf Datenbankebene, CI und ein Prüf-Gate im Docker-Build.

## Was als Nächstes ansteht

1. **Neuen Stand ausrollen** — `main` enthält Code-Review 4, Anrede „Sie“ und den Schutz vor
   Massenanmeldungen; alle Prüfungen grün (Durchstich 787). Nach dem Deploy das Anmeldeformular einmal neu
   veröffentlichen (Sie-Form, siehe UEBERGABE). Offene Fachentscheidungen stehen in [`gbs-campus/UEBERGABE.md`](gbs-campus/UEBERGABE.md).
2. **Den ganzen Stack auf Staging mit TLS durchspielen** — Traefik-Netz `gbs_edge`, mehrere Neustarts, keine
   502/504 (Go-Live-Checkliste in [`gbs-campus/LAIENTEST.md`](gbs-campus/LAIENTEST.md)).
3. **Laientest** — eine projektfremde Person klickt die Anmeldung durch (die eigene Methode des Schulleiters),
   dazu die Handprüfungen im Browser.
4. **Offene Entscheidungen aus Code-Review 4** mit der Schulleitung klären — Liste mit Empfehlungen in
   [`gbs-campus/UEBERGABE.md`](gbs-campus/UEBERGABE.md).

---

## Was blockiert und nicht in Entwicklerhand liegt

| Punkt | Bei wem | Warum es drängt |
|---|---|---|
| **SPF/DKIM/DMARC** für die Absenderdomain `gbs-minden.de` (Absender `no-reply@gbs-minden.de` steht fest) | der IT-Dienstleister | Show-Stopper. Der Magic-Link ist für alle ohne Passwort der einzige Zugang; ohne zugestellte Mail kommt niemand ins Portal. Die Angaben gelten für die *Absender*domain, nicht für `gbs.fes-credo.de`. |
| **Offene Entscheidungen aus Code-Review 4** (u. a. Rollenvergabe durch den Administrator, Honorar-Selbstabrechnung, Widerruf der Art.-9-Einwilligung, Löschfrist für abgelehnte Bewerber, Aufbewahrung von Zeugnissen) | der Schulleiter, der Projektverantwortliche | Liste mit Optionen und Empfehlung in `gbs-campus/UEBERGABE.md`. Keine davon blockiert den Merge. |
| **Branch-Schutz in GitHub** — Job „Typpruefung und Pruefskripte“ als Pflicht-Check für `main` | der Projektverantwortliche | Die CI läuft, gatet den Merge aber erst mit dieser Einstellung. |
| **Off-Site-Backup** — Ziel festlegen | der Projektverantwortliche | Der Dump liegt bisher auf demselben Host wie die Datenbank. Danach einmal echten Restore-Drill durchführen. |
| **Externer Uptime-Ping** auf `/api/health` | der Projektverantwortliche | Der Healthcheck markiert nur „unhealthy" — niemand startet neu, niemand wird alarmiert. |
| **Art.-9-Einwilligung als Pflichtfeld?** | Datenschutzbeauftragter | Sie ist Bedingung für die Anmeldung und berührt damit das Kopplungsverbot (Art. 7 Abs. 4 DSGVO). |
| **E-12** zweite Vertrauensperson für den Break-Glass-Tresor | der Schulleiter | Sonst bleibt der Bus-Faktor bei 1. |
| **E-13** Beurlaubungsregeln, **E-02** Bestätigung des Trägerkreises | der Schulleiter, Trägerkreis | Siehe Entscheidungsregister im Bauplan. |
| **E-17** Altzugänge im früheren M365-Tenant prüfen | die IT-Verantwortlichen | Organisatorischer Punkt aus dem Interview, hat mit dieser Software nichts zu tun: Ein Altzugang im früheren M365-Tenant erlaubt weiterhin Einsicht in dort abgelegte Daten und muss geprüft und entzogen werden — null Zeilen Code. |

---

## Archiv (`Archiv/`) — nicht mehr maßgeblich

| Datei | Warum abgelöst |
|---|---|
| `6_Start-Definition.html` (25.07.) | Scope-Schnitt und Docker-Betriebsmodell — in `1_Bauplan.html` übernommen |
| `6_Gesamtplan-2.0.html` (25.07.) | Modulstruktur M0–M11 — übernommen; sein größerer Phase-1-Scope wurde verworfen |
| `1_Prozesslandschaft.html` (12.07.) | Prozesskarte in 4 Achsen inkl. „Weg“-Achse — zurückgestellt bis E-07 geklärt ist |
| `2_Spezifikation.html` (12.07.) | Detailspezifikation aus dem US-Benchmark — an sechs Stellen über den Auftrag hinausgegangen |
| `3_Designkonzept.html` (12.07.) | 12 Oberflächen-Mockups im CREDO-Design — **als Gestaltungsreferenz weiter nutzbar** |
| `4_Umsetzungsplan.html` (12.07.) | 39 Arbeitspakete, Terminplan gerissen — ersetzt durch die drei Releases |
| `5_Analyse-Ergebnisse.md` (12.07.) | Vollständige Analysedoku inkl. Kritiker-Panel (Kapitel 13) — als Nachschlagewerk brauchbar |
| `ESRA-Softwarekonzept-v1.html` (11.07.) | Erste Konzeptfassung |
| `Interview-Transkript.txt` | Lesbare Textfassung des Interviews |
