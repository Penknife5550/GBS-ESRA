# GBS Campus — Bestandsaufnahme

**Stand: 26.09.2026** · Grundlage: `origin/main` bei Commit `19bab19` (01.08.2026) · reine Lektüre von Doku und Code, kein Build, kein Testlauf

---

## Worum es geht

GBS Campus ist die Verwaltungssoftware der Gemeindebibelschule Minden (Christliches Werk Esra e.V.).
Der Kernauftrag aus dem Interview: eine Akte pro Mensch statt Microsoft Forms, Excel-Listen und
Honoraren per Zuruf — Daten in Deutschland.

- **Technik:** Next.js 15, Prisma 6, PostgreSQL 16, Docker Compose mit Traefik, Worker und Backup.
  Rund 27.000 Zeilen TypeScript, 19 Migrationen, 16 DB-freie Prüfskripte plus Durchstich gegen das
  gebaute Image (`gbs-campus/scripts/durchstich.sh`).
- **Architektur:** Statusmaschine, Rechtematrix und Einstellungen liegen als Daten in der Datenbank.
  Das Audit-Log ist per DB-Trigger nur ergänzbar. Die IBAN ist verschlüsselt (AES-256-GCM).
  Anmeldung per Magic-Link, Passwort freiwillig. Rechte werden bei jeder Anfrage serverseitig neu
  geprüft (`gbs-campus/src/lib/berechtigung.ts`).

## Stand laut Repo

| Release | Inhalt | Stand |
|---|---|---|
| 0.1 | Anmeldung, Formular-Builder, Akte, Semester, Excel-Export, Selbstpflege, DSGVO-Auskunft | fertig |
| 0.2 | Stundenplan, Anwesenheit mit 80-%-Quote, Semesterüberleitung, Worker, Anonymisieren statt Löschen | fertig |
| 0.3 | Honorarsätze mit Historie, Honorar-Abrechnung/-Auszahlung, eigene Bereiche für Dozent und Schüler | teilweise |
| 0.4 | Noten, Zeugnisse, UI-Umbau nach `8_UI-Neustrukturierung-Plan.html` | im letzten Commit umgesetzt |

## Offene Punkte

Der letzte ausformulierte Auftrag (UI-Umbau) ist mit Commit `19bab19` erledigt. Offen sind laut
`5_Massnahmenplan.html`:

**Vor dem Livegang, großteils ohne Code**
- SPF/DKIM/DMARC für `gbs-minden.de` — Show-Stopper, ohne zugestellte Mail kommt niemand ins Portal
- Off-Site-Backup und ein echter Restore-Test
- Notfallzugang (Break-Glass) und externer Uptime-Ping auf `/api/health`
- Laientest (`gbs-campus/LAIENTEST.md`)

**Ausbau**
- Dozent sieht sein eigenes Honorar (Self-Service Stufe 3)
- Postfach in der App (Lese-Archiv gesendeter Mails)
- Beitragslauf mit Selbstansicht für Schüler (0.3)
- Anbindung an Optigem (0.3)
- Kursmaterial

**Kleinere Härtungen**
- Honorar-Freigabe und Auszahlung hängen am selben Recht `HONORAR_ABRECHNEN` — kein Vier-Augen-Prinzip
  (`src/app/api/honorar/abrechnungen/[id]/freigeben/route.ts`, `.../auszahlen/route.ts`)
- `ladeBelegDaten` in `src/lib/honorar-io.ts:157` lädt alle Unterrichtstermine ohne Filter
- Terminausfall/-verschiebung abbilden
- Warteliste/Kapazität, Evaluation

## Auffälligkeiten beim Lesen

1. **Termine vorbei, Repo still.** Livegang war für den 20.08., Kursstart für den 15.09. geplant.
   Seit dem 01.08. gibt es keinen Commit. Ob 0.1 live gegangen ist, lässt sich aus dem Repo nicht ablesen.
2. **Code hinter dem Plan:**
   - Für den **Gastdozenten** gibt es keinen Link-Zugang ohne Login, nur die Rollen-Konstante in
     `src/lib/constants.ts`. Der UI-Plan spricht trotzdem von einem „bestehenden Token-Flow“.
   - **Verteiler und Rundmail** (M5, laut Bauplan für 0.1) fehlen; das Recht `MAIL_VERTEILER_SENDEN`
     existiert nur als Konstante.
   - **Semesterüberleitung:** Es gibt nur „bin dabei“. Die Antwort „bin raus“ und das automatische
     Herausfallen ohne Rückmeldung aus dem Bauplan (Kap. 05) sind nicht gebaut.
   - Fahrtkosten/km-Pauschale (M7) und Leitfragen je Lektüre (M3) sind nicht gebaut.
3. **Doku teilweise veraltet:**
   - `0_LIESMICH.md` steht auf dem 27.07. und meldet den Code noch als „nicht verifiziert“.
   - `gbs-campus/UEBERGABE.md` sagt stellenweise, es gebe keine Benutzerverwaltung (gibt es seit 29.07.).
   - Die Zahl der Prüfungen schwankt zwischen den Dokumenten (179 / 351 / 491).
   - Den UI-Umbau vom 01.08. beschreibt nur die Commit-Nachricht.
4. **Interview nicht im Repo:** Die RTF-Dateien sind per `.gitignore` ausgeschlossen; die Datei liegt nur
   lokal in diesem Ordner.
