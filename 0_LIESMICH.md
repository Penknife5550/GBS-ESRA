# GBS Campus — Software für die Gemeindebibelschule Minden

**Stand: 27.07.2026** · Träger: Christliches Werk Esra e.V. · Kursstart Jahrgang 2026–29: 15.09.2026

---

## Wo das Projekt steht

**Der Bau läuft. Release 0.1 ist funktional fertig und durchgeprüft.**

Am 27.07. hat ein Code-Review mit sieben Prüfrichtungen 211 Befunde ergeben, darunter 11 GoLive-Blocker.
**Zehn davon sind behoben und einzeln am laufenden System nachgemessen.** Offen ist nur das
Off-Site-Backup — es braucht eine Entscheidung über das Ziel.

Am selben Abend kamen Semesterverwaltung, Teilnehmerliste mit Excel-Export, die Schülerakte mit
Selbstpflege, der Weg zurück ins Portal für Ausgesperrte und ein Passwort als zweiter Anmeldeweg
dazu. Ein **zweites Review** fand 160 Befunde (9 Blocker); alle CRITICAL- und MAJOR-Befunde sind
behoben.

> **🔴 Der Codestand seit dem Passwortweg ist nicht verifiziert.** Während der Reparatur lief die
> Festplatte voll und Docker stürzte ab — es gab keinen Build, keinen Testlauf, keinen Durchstich.
> Der Verifikationslauf ist die erste Aufgabe der nächsten Sitzung; die Reihenfolge steht ganz oben
> in [`gbs-campus/UEBERGABE.md`](gbs-campus/UEBERGABE.md).

| | |
|---|---|
| **Release 0.1** | live am **20.08.2026** — der einzige harte Termin |
| **Versprechen** | Jahrgang 2026–29 meldet sich nicht mehr über Microsoft Forms an. Daten liegen in Deutschland, in einer Akte, mit Export. |
| **Domain** | `gbs.fes-credo.de` |
| **Release 0.2** | Mitte Oktober 2026 — Stundenplan, Selbstbestätigung, Dozentenhonorar |
| **Release 0.3** | Winter 2026/27 — Optigem, Leistungserfassung |

---

## Die fünf Dateien

| Datei | Was drinsteht | Wann brauchst du sie |
|---|---|---|
| [`1_Bauplan.html`](1_Bauplan.html) | **Der fachliche Wahrheitsstand.** Auftrag, Scope-Schnitt, Rollen, Statusmaschine, Module M0–M11, drei Releases, Docker-Betriebsmodell, Termine, Entscheidungsregister E-01…E-17, Risiken. | Für jede fachliche Frage. Hier wird jede Statusänderung nachgetragen. |
| [`2_Code-Review.html`](2_Code-Review.html) | **Der Review-Report vom 27.07., vormittags.** Alle 11 GoLive-Blocker mit Nachweis, gebündelte MAJOR-Befunde, was gut ist, Reihenfolge zum Beheben. | Um zu verstehen, warum der Code an bestimmten Stellen so aussieht, wie er aussieht. |
| [`3_Code-Review-2.html`](3_Code-Review-2.html) | **Das zweite Review vom selben Abend samt Komplettfix.** 160 Befunde, die sechs Blocker mit Begründung, was daraus im Code entstand — und der blinde Fleck: Nichts davon ist geprüft. | Bevor du am Code vom Abend des 27.07. etwas anfasst. Und für die drei offenen Betriebsentscheidungen. |
| [`gbs-campus/README.md`](gbs-campus/README.md) | **Der technische Einstieg.** Wie man startet, was im Fundament steckt, was verifiziert wurde und wie. | Bevor du eine Zeile Code anfasst. |
| `Interview-2026-07-25.rtf` | Die Quelle: das Gespräch mit dem Schulleiter. **Achtung, der Dateiname führt in die Irre** — die Datei ist byte-identisch mit der ursprünglichen `Anforderungen.rtf` (MD5 `dd7aa28e…3fb644`). Es ist kein zweites Gespräch. Lesbare Textfassung: `Archiv/Interview-Transkript.txt`. | Wenn du wissen willst, was der Schulleiter wirklich gesagt hat — **immer im Volltext nachsehen, nie nur in der Zusammenfassung**. Genau diese Abkürzung hat schon einmal dazu geführt, dass ein gewünschtes Feature gestrichen wurde. |

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
- **Zugang wiederherstellen** — „Passwort vergessen" gibt es nicht, weil es kein Passwort gibt (jeder
  Anmeldelink ist neu). Für den echten Fall — Adresse vergessen oder Postfach verloren — gibt es das
  Meldeformular `/anmelden/hilfe` und die Gegenseite unter Verwaltung → Personen: Adresse ändern,
  Anmeldelink schicken, beides protokolliert. **Geändert wird erst, wenn ein Mensch die Person
  erkannt hat** — sonst wäre es eine Kontoübernahme per Formular.

## Was als Nächstes ansteht

1. **Der ausstehende Verifikationslauf** — Platz schaffen, `prisma generate`, Prüfungen, Build,
   Durchstich. Reihenfolge und Befehle stehen ganz oben in
   [`gbs-campus/UEBERGABE.md`](gbs-campus/UEBERGABE.md). Alles andere hat Zeit, bis das einmal grün war.
2. **Laientest** — eine projektfremde Person klickt die Anmeldung durch (die eigene Methode des Schulleiters).
3. **Vor dem Livegang das erste Semester anlegen** — ohne laufendes Semester bleibt die
   Teilnehmerliste leer und Anmeldungen bekommen keinen Semesterbezug.

---

## Was blockiert und nicht in Entwicklerhand liegt

| Punkt | Bei wem | Warum es drängt |
|---|---|---|
| **Absenderadresse für den Mailversand** + SPF/DKIM/DMARC | der IT-Dienstleister | Show-Stopper. Der Magic-Link ist der einzige Zugang; ohne zugestellte Mail kommt niemand ins Portal. Die Angaben gelten für die *Absender*domain, nicht für `gbs.fes-credo.de`. |
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
