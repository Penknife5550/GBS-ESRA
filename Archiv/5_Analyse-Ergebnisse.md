# GBS Campus — Ergebnisse der Funktions-, Rollen- & Prozessanalyse

> **Stand:** 12.07.2026 · **Auftraggeber:** Gemeindebibelschule Minden (Christliches Werk Esra e.V.) · **Kursstart:** 15.09.2026 (Jahrgang 2026–29)

Dieses Dokument bündelt alle Ergebnisse aus (1) der Klärung der 7 offenen Fragen und (2) einer US-fokussierten Deep-Research (37 Agenten, 12 Fachdomänen) mit anschließendem Abgleich gegen die 10 geplanten Module. Begleitdokumente: `Archiv/ESRA-Softwarekonzept-v1.html` (Ausgangskonzept), `2_Spezifikation.html` (interaktive Web-Ansicht), `3_Designkonzept.html` (Mockups), `1_Prozesslandschaft.html` (Prozesslandkarte v2), `4_Umsetzungsplan.html` (Bauplan &amp; Tracker).

## Inhalt

- 1. Zusammenfassung & Urteil
- 2. Getroffene Entscheidungen
- 3. Methodik
- 4. Funktions-Deckungsmatrix
- 5. Priorisierte Ergänzungen (P0/P1/P2)
- 6. Rollen- & Rechte-Matrix
- 7. Prozessflüsse
- 8. UX/UI-Prinzipien
- 9. Screen-Inventar
- 10. Betriebs- & Go-Live-Ring
- 11. Aktualisierte Roadmap
- 12. Offene To-dos & externe Abhängigkeiten

## 1 · Zusammenfassung & Urteil

Der 10-Modul-Plan ist als Verwaltungs-/Lernkern (M1, M3, M6-Anwesenheit, M7-Material, M9-Portal, M8-Prüfungen) für eine 20-60-Personen-Abendbibelschule solide und trifft die Vereinfachungs-Entscheidungen (Kohortenmodell, Pass/Fail, Optigem führend, kein Proctoring/GPA) meist richtig — die Overengineering-Gefahr ist bewusst gebannt. Er hat jedoch drei GoLive-blockierende Lücken: (1) der verbindliche Referenz-/Pastorenempfehlungs-Workflow — das eigentliche Zulassungs-Gate einer Bibelschule — ist in KEINEM Modul vorgesehen; (2) der DSGVO-Unterbau ist unvollständig: getrennte Art.9-Einwilligung, revisionssichere Consent-Protokollierung, Lösch-/Retention-Konzept und vor allem ein zentrales Audit-Log fehlen komplett und sind nachträglich nicht rekonstruierbar; (3) die serverseitige Zugriffskontrolle für die ab Start aktive Dozentenrolle ist nur konzeptionell beschrieben — ohne hartes Row-Level-Scoping drohen IDOR-Lecks auf Noten-, Prüfungs- und Finanzdaten. Hinzu kommen wichtige, aber überschaubare Ergänzungen (Entschuldigungs-Workflow + kumulative 80%-Anwesenheit, Schulvertrag, Aufgaben-Feature für Ausarbeitungen, Ankündigungen/Content-Release als Teams-Ablösung, rollenspezifische Dashboards, SMTP-DKIM). Empfehlung: GoLive-MVP auf M1/M2/M3/M6/M7/M9/M10 fokussieren, die drei P0-Blocker plus SMTP-Auth zuerst schließen, und M5-Voll-API sowie Zertifikat-PDF (erster Abschluss 2029) bewusst nachlagern.

**Kennzahlen:** 37 Recherche-Agenten · 12 Fachdomänen (US-Benchmark) · 40 Funktionen abgeglichen (1 abgedeckt / 26 teilweise / 13 fehlend) · Ergänzungen: 11× P0, 16× P1, 4× P2.

### Die drei fachlichen GoLive-Blocker (P0)

1. **Referenz-/Pastorenempfehlungs-Workflow (tokenisiert, ohne Login, vertraulich)** (M2) — Bewerber benennt 1-2 Referenzgeber (Pastor/Charakter). System versendet automatisch einmaligen Magic-Link zu separatem Empfehlungsformular ohne Account. Antworten verschlüsselt (AES-256), für Bewerber NICHT sichtbar. Statustracking (angefragt/erhalten) je Bewerbung, automatische Reminder nach x Tagen, Adress-Korrektur/Neuversand. Neue externe Rolle 'Referenzgeber'. Bewerbung erst 'prüfbereit' wenn Pflichtreferenzen vorliegen.
1. **DSGVO Art.9 getrennte Einwilligung + revisionssichere Consent-Protokollierung** (M2) — Separate, ausdrückliche Einwilligung für Religions-/Gemeindezugehörigkeit und geistliche/seelsorgliche Angaben (besondere Kategorie). Aktive Zustimmung (kein Vorabhaken), Speicherung von Datenschutz-Version + Zeitstempel + IP als Audit-Trail, Re-Consent bei Versionswechsel. Glaubensbekenntnis-Zustimmung mit gleicher Mechanik. Admin-editierbare Versionen in M10.
1. **Separate, langlebige Token für Bewerbung-Fortsetzen und Referenzgeber** (M2) — 'Speichern & später fortsetzen' braucht eigenen 7-14-Tage-Token (mehrfach nutzbar) — darf NICHT die 15-Min-Magic-Link-Regel erben (Berufstätige füllen abends über Tage aus). Referenzgeber-Link ebenso längerlebig. Sonst brechen die zwei wichtigsten Admissions-Flows ab.

## 2 · Getroffene Entscheidungen (12.07.2026)

| # | Frage | Entscheidung |
|---|-------|--------------|
| 1 | Optigem-Struktur | Je Teilnehmer Debitor + Abo-Artikel „Semesterbeitrag“ (wiederkehrende Rechnung) → exakter Offene-Posten-Sync per Saldo je Rechnung. |
| 2 | Teilnehmer-Finanzsicht | Zunächst nur Leiter-Sicht; Teilnehmer-Sicht als Schalter vorbereitet (Default aus). |
| 3 | Bewertungsschema | Konfigurierbar; Default bestanden / nicht bestanden + 80 % Anwesenheit als Abschlussvoraussetzung. |
| 4 | Hosting & Betrieb | Getrennte Docker-Instanz, eigener GBS-Server, eigene AVV. |
| 5 | SMTP-Domain | Noch offen → DNS-Anforderungen (SPF/DKIM/DMARC) dokumentiert, Voraussetzung für Phase 1. |
| 6 | Dozenten-Rolle | Ab Start aktiv — 4 Rollen ab Tag 1. |
| 7 | Produktname | „GBS Campus“ (konfigurierbar hinterlegt). |

## 3 · Methodik

Multi-Agenten-Workflow (37 Agenten, ~2 Mio Tokens). Als Maßstab diente die Praxis der größten US-amerikanischen Bibelschulen und Seminare.

- **Benchmark-Institutionen:** Moody Bible Institute, Dallas Theological Seminary, The Master's University & Seminary, Liberty University, Gordon-Conwell, Southern/Southeastern Baptist Theological Seminary, Grace, Multnomah, Columbia International University.
- **Untersuchte Systeme:** Populi, CAMS (Three Rivers), Empower, Sonis, Jenzabar, Anthology/Slate, Blackbaud, Rock RMS, Canvas, Brightspace, Moodle, Gradelink, FACTS/RenWeb.
- **Vorgehen:** 12 Fachdomänen parallel recherchiert → jede sofort gegen die 10 Module abgeglichen → Synthese (Deckungsmatrix, Rechte-Matrix, Prozessflüsse, UX) → Vollständigkeits-Kritiker → Nachrecherche der Lücken.

## 4 · Funktions-Deckungsmatrix

Jede an großen US-Bibelschulen bewährte Funktion, abgeglichen gegen unseren Plan (1 abgedeckt · 26 teilweise · 13 fehlend).

### M1 · Teilnehmerverwaltung

| Funktionsbereich | Status | Anmerkung |
|---|---|---|
| Status-Lebenszyklus als validierte State-Machine mit protokollierten Übergängen | 🟡 Teilweise | Status-Enum vorhanden, aber Übergänge nicht validiert/protokolliert (wer/wann/Grund), Rückwege (Pausiert→Aktiv, Warteliste→Genehmigt) nicht modelliert. |
| Person-Core vs. Login-Rolle + Mehrfachrollen | 🟡 Teilweise | 4 Rollen sind Login-Rollen; Person kann zugleich Dozent+Teilnehmer+Alumnus sein → n:m-Modell nötig, sonst Doppelanlagen über Jahrgänge. |
| Löschkonzept / Retention / Anonymisierung | 🔴 Fehlt | Soft-Delete vs. DSGVO Art.17 ungelöst; keine datenklassen-getrennten Fristen (Finanz 10J vs. Kontakt), kein Anonymisierungs-Job, kein Löschprotokoll. GoLive-Blocker. |
| DSGVO-Auskunft Art.15 + Feld-Audit-Trail + Deprovisioning bei Statuswechsel | 🟡 Teilweise | Werkzeuge genannt; Ein-Klick-Datenkopie, Feld-Änderungslog und Sofort-Entzug von Sessions/Magic-Links bei Absolvent/Abgebrochen fehlen. |
| Duplikat-Erkennung + Merge/Dedupe | 🟡 Teilweise | Suche implizit; Bestandsabgleich bei Einreichung und Merge-Werkzeug (zweiten als 'gemerged' markieren) fehlen → doppelte Optigem-Debitoren. |
| Listen/Filter/Export + Custom-Fields/Tags + Household-Relation | 🟡 Teilweise | Listen/Export covered; Zusatzfeld 'Gemeinde', Tag-System und echte Person↔Person-Ehe-Relation (statt Formular-Flag) fehlen. |

### M2 · Anmeldung & Formular-Builder

| Funktionsbereich | Status | Anmerkung |
|---|---|---|
| Referenz-/Pastorenempfehlungs-Workflow (tokenisiert, ohne Login, vertraulich) | 🔴 Fehlt | KRITISCHSTE Lücke: Kern-Zulassungs-Gate einer Bibelschule fehlt komplett — Token-Versand, Statustracking, Reminder, Vertraulichkeit vor Bewerber. |
| DSGVO Art.9 getrennte Einwilligung + revisionssichere Consent-Protokollierung | 🟡 Teilweise | Nur Checkbox+AES; separate Einwilligung für Religions-/geistliche Daten und Speicherung Version+Zeitstempel+IP fehlen. Rechtlicher GoLive-Blocker. |
| Speichern & Fortsetzen mit eigenem langlebigen Token + Bewerber-Checkliste/Gate | 🟡 Teilweise | Öffentlicher Link da; 7-14-Tage-Fortsetzen-Token (nicht 15-Min-Regel), Vollständigkeits-Gate 'prüfbereit' und Bewerber-Upload fehlen. |
| Enrollment-Agreement/Schulvertrag (Checkbox+Zeitstempel+PDF) + Kohorten-Sammeleinschreibung | 🔴 Fehlt | Vertrag (80% Pflicht, 120€, Datenschutz) vor Aktivierung fehlt; Sammel-Einschreibung ganzer Jahrgang in alle Fächer nicht als 1 Schritt modelliert. |

### M3 · Kommunikation / E-Mail

| Funktionsbereich | Status | Anmerkung |
|---|---|---|
| Abmelde/Opt-out + Trennung transaktional/Rundschreiben + Footer/Impressum | 🔴 Fehlt | Abmeldelink, Opt-out-Speicherung, Unterdrückung Abgemeldeter und Regel 'keine Note/Betrag in Betreff/URL' fehlen. DSGVO-Pflicht. |
| SPF/DKIM/DMARC + Bounce-Handling in Akte | 🟡 Teilweise | Eigenes SMTP geplant, aber DNS-Auth offen (Entscheidung 5) → Spam-Risiko für Magic-Links/alle Mails; Bounce-Rückmeldung in Akte fehlt. |
| Terminerinnerung (+ICS) / Notfall-Broadcast / gebündelte Trigger | 🔴 Fehlt | Automatische Erinnerung vor Dienstagabenden, Ein-Klick-Ausfall-Broadcast an Jahrgang und Digest-Bündelung (gegen Mail-Flut) fehlen. |
| Ereignis→Vorlage-Trigger + Vorlagen je Entscheidungsstufe | 🟡 Teilweise | Vorlagen/Platzhalter covered; schlanke Status→Aktion-Zuordnung und Vorlagen für Zusage/Absage/Warteliste/Willkommen/Ergebnis als Trigger fehlen. |

### M4 · Finanzen & Optigem

| Funktionsbereich | Status | Anmerkung |
|---|---|---|
| Zahlungsplan/Raten (6×20€, Ehepartner 3×20€) als Soll-Anzeige | 🔴 Fehlt | Nur Zahlungserinnerung; Soll-Ratenplan mit Fälligkeiten/Fortschritt (Zuordnung via Rest-Saldo) fehlt; Ratenwunsch-Feld in M2 fehlt. |
| Ehepartner-50%-Logik korrekt nach Optigem | 🟡 Teilweise | Ehepaar-Anmeldung da, aber Ableitung welcher Partner voll/halb, Vier-Augen-Bestätigung und Abo-Artikel-Abbildung nicht durchgezogen → Fehlbuchungen. |
| Mehrstufiges Dunning (idempotent, Stopp bei Zahlung) + OP-Sync-Granularität | 🟡 Teilweise | Einstufig; gestaffelte pastorale Stufen, Ausnahmeliste aktiver Pläne, Idempotenz und Saldo+Fälligkeit JE Rechnung (nicht nur Debitor) müssen verifiziert werden. |
| Finanz-Dashboard/Ampel + read-only-Garantie + Debitor-Anlage-Trigger | 🟡 Teilweise | Ampel covered; Trigger 'Status Aktiv→Debitor prüfen/anlegen', kein Schreibpfad nach Optigem und Third-Party-Payer (Gemeinde zahlt) fehlen. |

### M5 · Offene API & Webhooks

| Funktionsbereich | Status | Anmerkung |
|---|---|---|
| Serverseitiges Row-Level-Scoping/IDOR-Schutz je Route | 🟡 Teilweise | Dozent-Scope nur konzeptionell; jede M6/M7/M8-Route muss auf zugeordnete Fach-IDs filtern, Finanz-Endpoints für Dozent/Teilnehmer-Token sperren. |
| API-Keys/Scopes/Events + n8n-Service-Key | ✅ Abgedeckt | Gut abgedeckt; sicherstellen n8n/Optigem läuft über eigenen Minimal-Scope-Service-Key (nicht menschlicher Account). Voll-API-Ausbau nach GoLive schiebbar. |

### M6 · Leistung, Anwesenheit, Lektüre

| Funktionsbereich | Status | Anmerkung |
|---|---|---|
| Anwesenheit: Status P/A/T/E + kumulative 80% über 6 Semester + Audit | 🟡 Teilweise | Ampel je Semester da; getrennter 'Entschuldigt', kumulierte Gesamtquote (Abschlussvoraussetzung) und Korrektur-Protokoll fehlen — bei 10 Terminen = max 2 Fehltage. |
| Entschuldigungs-Workflow (Beleg-Upload=Art.9, Genehmigung, Neuberechnung) | 🔴 Fehlt | Fehlt komplett; ohne ihn ist die 80%-Regel unfair/angreifbar. Atteste als Gesundheitsdaten verschlüsseln, nur Leiter. |
| Noten-Finalisierung/Lock + Änderungsantrag + Frühwarnung + Graduation-Clearance | 🟡 Teilweise | Erfassung da; unwiderruflicher Lock, genehmigungspflichtige Notenänderung, Alert bei rechnerisch unerreichbaren 80% und Clearance-Prozess fehlen. |
| Andacht/Chapel als getrennt zählbarer Block | 🟡 Teilweise | Termine da; eigener Termintyp/Flag mit optionaler Quote fehlt. Vor Bau klären ob abschlussrelevant + wer abhakt (Leiter vs. Fachdozent). |

### M7 · Materialplattform

| Funktionsbereich | Status | Anmerkung |
|---|---|---|
| Fach-Kursraum als Objekt + Lektions-/Abend-Ordner + Content-Release (sichtbar-ab) | 🟡 Teilweise | Nur lose Datei-Ordner; Kursraum-Kopf (Beschreibung/Dozent/Termine), zweite Ebene je Abend und Entwurf/veröffentlicht-Steuerung fehlen. |
| Aufgaben/Assignments (Datei-/Text-Abgabe, Bewertung→M6) | 🔴 Fehlt | Echte Lücke: schriftliche Ausarbeitungen/Exegese passen weder in M8 (Klausur) noch M6 (nur Ergebnis) → wandern sonst zurück in Teams/Mail. |
| Audio HTTP-Range/Byte-Serving + Offline-Download + Speicher/Backup-Konzept | 🟡 Teilweise | Player geplant; Tempo-Regler, Range-Requests (Spulen bei 500MB), großer Download-Button und Storage-/Retention-Plan (kein DB-Blob) fehlen. |
| Diskussion/Q&A moderiert + jahrgangsweite Ankündigung als Entität | 🟡 Teilweise | 'Optional eigene Beiträge' zu vage; moderiertes Fach-Q&A und Ankündigung (Portal-Anzeige+Mail, Empfängerkreis Fach/Jahrgang) fehlen — Kern der Teams-Ablösung. |

### M8 · Online-Prüfungen

| Funktionsbereich | Status | Anmerkung |
|---|---|---|
| Zeitlimit getrennt vom Verfügbarkeitsfenster + Auto-Abgabe | 🟡 Teilweise | Nur Fenster von-bis; Bearbeitungs-Zeitlimit ab Start mit Auto-Abgabe und Übersteuerungsregel fehlen → Streitpotenzial. |
| Rubric für Freitext (Anker für Ollama) + Feedback-Sichtbarkeit + Release-Sperre | 🟡 Teilweise | Freitext+Ollama da, aber ohne Kriterienraster nicht belastbar; Sichtbarkeits-Schalter und Sperre gegen Teil-Freigabe bei offenen Freitexten fehlen. |
| Randomisierung + Ausnahmen/Nachteilsausgleich + Live-Abgabe-Monitoring + Unicode | 🟡 Teilweise | Fragen-Mischen (billigste Integrität statt Proctoring), abweichende Zeitfenster je TN, Abgabe-Liste und NFC-Vergleich für Griechisch/Hebräisch fehlen. |

### M9 · Teilnehmerportal

| Funktionsbereich | Status | Anmerkung |
|---|---|---|
| Rollenspezifische Dashboards + Benachrichtigungs-Glocke + Onboarding-Checkliste | 🟡 Teilweise | Nur Teilnehmer-Startseite; Leiter/Dozent/Admin-Dashboards, In-App-Inbox mit Ungelesen-Zähler und geführte Post-Genehmigung-Checkliste fehlen. |
| Re-Enrollment je Semester + Readmission nach Pause | 🔴 Fehlt | Schlanker Klick-Bestätigen-Schritt (+Beitrags-Trigger) vor Semesterstart und niedrigschwelliger Wiedereinstieg für Pausierte fehlen. |
| Magic-Link-Härtung + Directory-Opt-in + eigene Anwesenheitsquote | 🟡 Teilweise | 15-Min-Login ok, aber Single-Use, Rate-Limit, Invalidierung alter Links, Opt-in-Sichtbarkeit und 'verbleibende Fehltage' im Portal fehlen. |

### M10 · Administration

| Funktionsbereich | Status | Anmerkung |
|---|---|---|
| Dozent↔Fach/Semester/Termin-Zuordnung + Curriculum-Snapshot/Klon je Jahrgang | 🟡 Teilweise | Struktur da; explizite 'Termin→Fach→Dozent'-Zuordnung (Dozent ab Start aktiv) und Einfrieren/Klonen der Fächer-/Anforderungsstruktur je Jahrgang fehlen. |
| Rechte-Matrix als DB-Datensatz + Consent-/Feld-Verschlüsselungs-/Termintyp-Config | 🟡 Teilweise | 4 feste Rollen ok, aber als DB-Matrix (Rolle×Modul×Aktion) statt if(role===) modellieren; Consent-Versionen, Feldkatalog sensibel und Andacht-Termintyp konfigurierbar. |

### NEU · Modulübergreifend / neu

| Funktionsbereich | Status | Anmerkung |
|---|---|---|
| Zentrales append-only Audit-Log (Noten/Anwesenheit/Stammdaten/Rollen/Consent/Freigaben) | 🔴 Fehlt | In keinem Modul vorgesehen; DSGVO Art.5(2)/30-Nachweispflicht + Belastbarkeit der Zeugnisse. Nachträglich nicht rekonstruierbar → vor GoLive. |
| Kohorten-Dashboard/Reporting + Early-Alert-Risikoliste + Träger-Jahresbericht | 🔴 Fehlt | Keine Analytik-Ebene; Retention/Abschlussquote, kombinierte Risiko-Liste (Anwesenheit+Prüfung+Lektüre+OP) und Esra-e.V.-Preset-Export fehlen. k-Anonymität bei kleinen Kohorten beachten. |
| Rolle 'Referenzgeber' (extern, ohne Konto, nur Magic-Link zu 1 Formular) | 🔴 Fehlt | Nicht im 4-Rollen-Modell; zwingend für Referenz-Workflow. Antwort für Bewerber nie einsehbar, Link zeit-/einmal-begrenzt. |
| Barrierefreiheit WCAG 2.1 AA / BFSG/BITV als Querschnitts-DoD | 🔴 Fehlt | Nicht verankert; Tastatur/Fokus/Screenreader/Kontrast/Audio-Transkript. Radix hilft, aber als Definition-of-Done aufnehmen (rechtlich DE + Zielgruppe). |

## 5 · Priorisierte Ergänzungen zum Plan

### P0 — GoLive-Blocker (zuerst schließen)

- **Referenz-/Pastorenempfehlungs-Workflow (tokenisiert, ohne Login, vertraulich)** — *M2* · Bewerber benennt 1-2 Referenzgeber (Pastor/Charakter). System versendet automatisch einmaligen Magic-Link zu separatem Empfehlungsformular ohne Account. Antworten verschlüsselt (AES-256), für Bewerber NICHT sichtbar. Statustracking (angefragt/erhalten) je Bewerbung, automatische Reminder nach x Tagen, Adress-Korrektur/Neuversand. Neue externe Rolle 'Referenzgeber'. Bewerbung erst 'prüfbereit' wenn Pflichtreferenzen vorliegen.
- **DSGVO Art.9 getrennte Einwilligung + revisionssichere Consent-Protokollierung** — *M2* · Separate, ausdrückliche Einwilligung für Religions-/Gemeindezugehörigkeit und geistliche/seelsorgliche Angaben (besondere Kategorie). Aktive Zustimmung (kein Vorabhaken), Speicherung von Datenschutz-Version + Zeitstempel + IP als Audit-Trail, Re-Consent bei Versionswechsel. Glaubensbekenntnis-Zustimmung mit gleicher Mechanik. Admin-editierbare Versionen in M10.
- **Separate, langlebige Token für Bewerbung-Fortsetzen und Referenzgeber** — *M2* · 'Speichern & später fortsetzen' braucht eigenen 7-14-Tage-Token (mehrfach nutzbar) — darf NICHT die 15-Min-Magic-Link-Regel erben (Berufstätige füllen abends über Tage aus). Referenzgeber-Link ebenso längerlebig. Sonst brechen die zwei wichtigsten Admissions-Flows ab.
- **Serverseitiges Row-Level-Scoping / IDOR-Schutz für Dozentenrolle** — *M5* · Da Dozent AB START aktiv: jede M6/M7/M8/M5-Route MUSS serverseitig auf die dem Dozenten zugeordneten Fach-/Semester-IDs filtern (nicht nur UI-Ausblendung). Finanz-Endpoints für Dozent-/Teilnehmer-Token hart sperren. Zentrale Autorisierung in lib/authz.ts, nicht pro Route dupliziert. Sonst fremde Notenblätter/Prüfungen via ID-Manipulation abrufbar.
- **Zentrales append-only Audit-Log** — *M10* · Unveränderliches Protokoll (wer/wann/was/Alt→Neu/IP) für Notenänderung nach Freigabe, Anwesenheitskorrektur, Stammdaten-/Sensibelfeld-Zugriff, Rollenvergabe/-entzug, Finanzsicht und Consent. Auch Admin kann nicht löschen. Für 20-60 TN reicht eine Audit-Tabelle + Schulleiter-Ansicht. DSGVO-Rechenschaft + Zeugnis-Belastbarkeit; nachträglich nicht rekonstruierbar.
- **Löschkonzept / Retention / Anonymisierung** — *M1* · Soft-Delete statt Hard-Delete; datenklassen-getrennte Aufbewahrungsfristen (Finanzbelege ~10J vs. Kontaktdaten), Anonymisierungs-Job nach Fristablauf, Löschprotokoll. DSGVO-Auskunfts- und Löschantrag als Workflow (Datenkopie → Fristprüfung → Anonymisieren/Sperren → Bestätigung). Löst Spannungsfeld 'Profil nie löschen' vs. Art.17.
- **Abmelde/Opt-out + Trennung transaktional/Rundschreiben + Datensparsamkeit in Mails** — *M3* · Abmeldelink + Impressum im Footer nicht-transaktionaler Mails, Opt-out je Nutzer speichern, Abgemeldete automatisch aus Rundschreiben unterdrücken. Regel als UX-Standard: keine sensiblen Daten (Note/Betrag) in Betreff oder URL — nur Portal-Verweis.
- **SMTP-Domain + SPF/DKIM/DMARC vor GoLive festlegen** — *M10* · Entscheidung 5 schließen und DNS-Authentifizierung einrichten/dokumentieren. Ohne saubere Auth landen Magic-Links, Anmelde-/Genehmigungs- und Erinnerungsmails im Spam — das bricht sowohl M3 als auch das passwortlose Login. Bounce-Handling: unzustellbare Adressen in Akte markieren.
- **Magic-Link-Härtung** — *M9* · Single-Use (nach 1x Einlösen ungültig), Rate-Limit pro E-Mail/IP, Invalidierung alter Links bei Neuanforderung, Resend-Button. Ablaufzeit für abendliche/mobile Zielgruppe UX-prüfen (ggf. 30 Min). Der Magic-Link ist der alleinige Kontoschlüssel.
- **Anwesenheit: Status P/A/T/E, kumulative 80% über 6 Semester, Korrektur-Audit** — *M6* · Mindestens 4 konfigurierbare Status (Anwesend/Fehlend/Verspätet/Entschuldigt); 'Entschuldigt' getrennt von 'Fehlend'. Quote kumulativ über ALLE 6 Semester aggregieren (Abschlussvoraussetzung ist gesamt, nicht je Semester). Jede nachträgliche Korrektur protokolliert. Bulk-Default 'alle anwesend', Dozent stellt nur Abweichungen um.
- **Entschuldigungs-Workflow mit Beleg-Upload und Genehmigung** — *M6* · Mini-Workflow beantragt→in Prüfung→genehmigt/abgelehnt: Teilnehmer/Dozent reicht ein, optionaler Attest-Upload (Magic-Bytes/Path-Traversal-Härtung aus M7), Schulleiter genehmigt, Quote neu berechnet, Ergebnis-Mail. Atteste = Gesundheitsdaten (Art.9) verschlüsselt, nur Leiter. Bei nur 2 erlaubten Fehltagen zentral für Fairness.

### P1 — Wichtig (im MVP-Umfeld)

- **Kohorten-Sammeleinschreibung + Matrikulation als Ein-Klick-Konvertierung** — *M2* · Genehmigen-Klick übernimmt Bewerbung 1:1 in die Kartei (kein Abtippen), ordnet Jahrgang 2026-29 + Startsemester zu, schreibt ganzen Jahrgang in alle Semesterfächer (ein Schritt, nicht Fach-für-Fach), löst n8n-Webhook 'Debitor+Abo anlegen' und Willkommens-/Magic-Link-Mail aus. Keine individuelle Kurswahl (Kohortenmodell).
- **Enrollment-Agreement/Schulvertrag + Bewerber-Checkliste/Gate** — *M2* · Bei Zusage Ausbildungsvertrag (80%-Pflicht, 120€/Semester, Datenschutz) den TN vor Aktivierung digital bestätigt (Checkbox+Zeitstempel+PDF in Akte — keine Voll-E-Signatur). Explizite Vollständigkeits-Checkliste je Bewerbung (Formular, Pflichtreferenzen, Consent, ggf. Dokumente) steuert Übergang 'eingereicht→prüfbereit' und zeigt dem Bewerber 'Was fehlt noch?'.
- **Aufgaben/Assignments im Kursraum (Datei-/Text-Abgabe, Bewertung→M6)** — *M7* · Schlankes Feature: Beschreibung + Fälligkeit + Abgabe (Datei ODER Freitext mit Autospeicherung), Zeitstempel, verspätet-Kennzeichnung. Dozenten-Rückmeldung (Punkte/bestanden + Kommentar), Freigabe fließt automatisch in M6. Deckt Exegese-/Hausarbeiten ab, die weder in M8 (Klausur) noch M6 (nur Ergebnis) passen. Kein SpeedGrader-Umfang.
- **Fach-Kursraum als Objekt + Content-Release (Entwurf/sichtbar-ab) + Ankündigungen** — *M7* · Kursraum je Fach/Semester mit Kopf (Beschreibung, Dozent, 10 Termine, Lektüreliste) als Aufhänger für Material/Ankündigung/Diskussion/Prüfung/Anwesenheit. Material-Status Entwurf/veröffentlicht + optional 'sichtbar ab Datum' (Cron-Freischaltung zum Dienstagabend). Ankündigung als eigene Entität (Empfängerkreis Fach-/Jahrgang, Portal-Anzeige + Mail) — Kern der Teams-Ablösung.
- **Audio: HTTP-Range/Byte-Serving, Tempo-Regler, Offline-Download, Storage-Konzept** — *M7* · Range-Requests sicherstellen (sonst kein Spulen bei 500MB), Tempo 0.75x-2x, großer Download-Button je Audio (Offline-Hören unterwegs = prägender Use-Case), Wiedereinstiegs-Merker 'zuletzt gehört'. Dateien auf Filesystem (kein DB-Blob), Backup-/Retention-Plan für 7 Fächer × 10 Abende × 6 Semester × Jahrgänge. Am echten Handy (iOS-Range/Hintergrund) testen.
- **Noten-Finalisierung/Lock + genehmigungspflichtige Änderung + Frühwarnung + Clearance** — *M6* · Dozent 'reicht Endnoten ein'→schreibgeschützt (zweistufiger Dialog); danach nur via Änderungsantrag mit Begründung + Leiter-Genehmigung + Protokoll. Release-Sperre solange offene Freitexte unbewertet. Frühwarn-Alert an TN+Leiter sobald 80% rechnerisch unerreichbar. Graduation-Clearance (7 Fächer bestanden + 80% gesamt + Lektüre + OP-Ampel) → Statuswechsel Aktiv→Absolvent (Datenmodell jetzt, PDF 2029).
- **Zahlungsplan/Raten + Ehepartner-50%-Logik nach Optigem** — *M4* · Leiter hinterlegt Soll-Ratenplan (6×20€, Ehepartner 3×20€) mit Fälligkeiten, Fortschritt als Progressbar (Zuordnung via Rest-Saldo, GBS bucht nichts). Ehe als First-Class-Relation; Regel bestimmt welcher Partner voll/halb (Vier-Augen-Bestätigung, Grund in Akte), korrekt an Optigem-Abo. Ratenwunsch-Feld in M2. Third-Party-Payer (Gemeinde als Debitor) mitdenken.
- **Mehrstufiges idempotentes Dunning + OP-Sync-Granularität verifizieren** — *M4* · Konfigurierbare, eskalierende aber pastorale Erinnerungsstufen (bei Fälligkeit, +7, +14) mit automatischem Stopp bei Zahlungseingang und Ausnahmeliste für aktive Ratenpläne. Idempotenter Abgleich je Rechnungsnummer+Saldo (keine Doppelmahnung bei n8n-Reruns). VOR Bau prüfen: liefert Optigem Saldo UND Fälligkeit JE Rechnung (nicht nur Debitor-Gesamtsaldo)? Sonst keine exakte Ampel/Raten möglich.
- **Rollenspezifische Dashboards + Benachrichtigungs-Glocke + Onboarding-Checkliste** — *M9* · Startseite je Rolle statt Menübaum: Leiter (offene Anmeldungen als To-Do, Anwesenheits-/OP-Ampeln, zu bewertende Prüfungen), Dozent (eigene Fächer, heutiger Termin+Anwesenheitsliste, offene Freitext-Bewertungen), Admin (SMTP/Sync-Status). In-App-Glocke mit Ungelesen-Zähler (E-Mail bleibt Default gespiegelt). Nach Genehmigung geführte Onboarding-Checkliste für neue TN.
- **Re-Enrollment je Semester + Readmission nach Pause + Deprovisioning** — *M9* · Leichter Klick-Bestätigen-Schritt vor Semesterstart (keine Neubewerbung) stößt neuen Beitragslauf an; Leiter-Liste 'noch nicht rückbestätigt'. Kurzer Readmission-Workflow (Antrag→Prüfung→Reaktivierung) für Pausierte. Bei Statuswechsel Pausiert/Abgebrochen/Absolvent: Optigem-Abo koppeln UND Rolle/Sessions/offene Magic-Links sofort invalidieren (Absolvent = read-only Archiv).
- **Person-Core-Datenmodell + Mehrfachrollen + Status-State-Machine** — *M1* · EIN Personendatensatz mit Rollen als Attribut (n:m); Login-Rolle vs. fachliche Rolle vs. Status trennen (Schulleiter unterrichtet auch, Ehepartner meldet sich Folgejahrgang erneut an). Status als validierte State-Machine mit erlaubten Übergängen, Verlaufseintrag (Zeitstempel/Nutzer/Grund) und modellierten Rückwegen. Duplikat-Erkennung (Name+Mail+Geburtsdatum) + Merge-Werkzeug.
- **Terminerinnerung (+ICS) und Notfall-Broadcast** — *M3* · Konfigurierbare Erinnerung x Tage vor jedem Dienstagabend (Cron/n8n), ICS-Anhang für alle 10 Abende in der Willkommensmail. Ein-Klick-Broadcast an alle aktiven TN eines Jahrgangs bei Ausfall/Raumänderung (E-Mail + Portal-Glocke, 1-2 vorkonfigurierte Kurzvorlagen). Material-/Diskussions-Benachrichtigungen als Tages-Digest bündeln (Anti-Mailflut).
- **Prüfungen: Zeitlimit vom Fenster trennen, Rubric, Randomisierung, Ausnahmen, Unicode** — *M8* · Optionales Bearbeitungs-Zeitlimit ab Start mit Auto-Abgabe zusätzlich zum Verfügbarkeitsfenster (Übersteuerungsregel erklären). Leichtes Rubric je Prüfung als Anker für Ollama-Vorbewertung (immer als 'KI-Vorschlag' kennzeichnen, Dozent bestätigt). Reihenfolge-Mischen statt Proctoring. Abweichende Zeitfenster/Nachschreibtermine je TN (Recht: Leiter). NFC-Normalisierung für Griechisch/Hebräisch-Vergleich. Auto-Save-Recovery bei Verbindungsabbruch real testen.
- **Dozent↔Fach-Zuordnung + Curriculum-Snapshot je Jahrgang** — *M10* · Explizite 'Termin→Fach→zuständiger Dozent'-Zuordnung in M10 (Dozent ab Start aktiv, jeder Abend = ein Fach); Leiter kann als Fallback/Vertretung überall nacherfassen. Fächer-/Anforderungsstruktur je Jahrgang einfrieren + aus Vorjahr klonen, damit spätere Änderungen laufende Jahrgänge nicht rückwirkend verfälschen. Andacht-Termintyp und Rechte-Matrix als DB-Datensatz (Rolle×Modul×Aktion) statt if(role===).
- **Kohorten-Dashboard + Early-Alert-Risikoliste + Träger-Jahresbericht** — *M1* · Schlankes Kohorten-Dashboard (Filter Jahrgang/Semester, aktive TN, Anwesenheitsschnitt, Prüfungsdurchgang, offene Beiträge). Regelbasierte Risiko-Liste gefährdeter TN (Anwesenheit unter Schwelle + versäumte Prüfung + offene Lektüre + Zahlungsrückstand) mit seelsorglich-milder Benachrichtigung. Preset-Export für Esra e.V./Vorstand. k-Anonymität-Schwelle bei kleinen Kohorten beachten (Re-Identifikation).
- **Barrierefreiheit als Querschnitts-Definition-of-Done** — *M9* · WCAG 2.1 AA / BFSG/BITV als Grundstandard über alle Module: Tastaturbedienung, sichtbarer Fokus, Screenreader-Labels, Kontrast, Zoom, Audio-Transkript. Radix liefert Basis; als DoD prüfen, nicht als eigenes Modul bauen. Rechtlich DE + teilhabefreundlich für erwachsene, teils technikferne Zielgruppe.

### P2 — Später / Komfort

- **Interessenten-Zweistufeneinstieg + Herkunftsquelle-Feld** — *M2* · Optionales leichtes Erst-Kontaktformular (Info-Abend/Interesse) → automatischer Mail-Link zum Vollantrag, mit Dedupe-Prüfung und Herkunftsquelle/Event-Feld für spätere Trichter-Auswertung. Für 20-60 TN bewusst schlank halten, nicht überbauen.
- **PDF-Vorschau, Link-als-Materialtyp, ZIP-Sammel-Download, Datei-Versionierung** — *M7* · In-Browser-PDF-Vorschau (nicht nur Download), externe Links (Bibelserver/YouVersion) als Materialtyp neben Datei, ZIP-Download je Ordner, 'Datei ersetzen' ohne Link-Bruch. Alles Komfort nach GoLive.
- **Impersonation für Support + Klartext-Rechte-Matrix + Advisor/Mentor-Feld** — *M10* · 'Als Teilnehmer anmelden' nur Admin, mit persistentem Banner + doppeltem Audit-Log (für Support beim Teams-Onboarding). Klartext-'Was darf wer?'-Matrix im Admin-Bereich gegen Fehlkonfiguration. Optionales Mentor-/Ansprechperson-Feld je TN (Empfänger der Anwesenheits-Frühwarnung), kein Advising-Apparat. Beratungs-/Eignungsnotizen leiter-only, verschlüsselt, nie für TN sichtbar.
- **Teilnehmer-Finanzsicht, Kontoauszug-PDF, Kurs-vs-Spende-Trennung** — *M4* · Read-only eigene Finanzdaten über vorbereiteten Schalter (Entscheidung 2, Phase 1 aus), 'Wie bezahle ich?'-Hinweis statt Bezahl-Button. Optional Semester-PDF-Statement — dabei Kursbeitrag klar von Spende trennen (keine Zuwendungsbescheinigung, gemeinnütziger Träger). Guthaben/negativer Saldo korrekt als 'Guthaben' darstellen.

## 6 · Rollen- & Rechte-Matrix

- **Administrator** — Technischer System-Admin: Einstellungen, SMTP, API-Keys/Webhooks, Optigem-Integration, Benutzer/Rollen, Backups, Audit-Log, DSGVO-Werkzeuge. Trifft KEINE fachlichen/paedagogischen Entscheidungen (Anmeldung genehmigen, Noten) im Regelbetrieb.
- **Schulleiter** — Fachlicher Vollverantwortlicher (Registrar + Dean + Admissions gebuendelt): Teilnehmer/Stammdaten, Anmeldungen genehmigen, Vorlagen/Formulare, Noten/Anwesenheit aller Faecher, Material, Pruefungen, Finanzuebersicht. KEINE technischen Systemeinstellungen.
- **Dozent** — Faculty, strikt auf eigene(s) zugeordnete(s) Fach gescopet (Row-Level, serverseitig gegen IDOR): Material hochladen, Pruefungen anlegen/bewerten, Anwesenheit/Noten im eigenen Fach. KEIN Zugriff auf Finanzen, vollstaendige Stammdaten oder fremde Faecher.
- **Teilnehmer** — Student im Self-Service: eigenes Profil pflegen, Material der eigenen Kurse abrufen, Pruefungen ablegen, Lektuere bestaetigen, eigene Ergebnisse/Anwesenheit sehen. Sieht ausschliesslich eigene Daten.

**Legende:** Voll = volle Rechte · Eigene = nur eigene Daten/eigenes Fach · Lesen = nur Ansicht · – = kein Zugriff

| Fähigkeit | Administrator | Schulleiter | Dozent | Teilnehmer |
|---|---|---|---|---|
| System-/Grundeinstellungen (Erscheinungsbild, Logo, Name) (M10) | Voll | – | – | – |
| SMTP/Absender konfigurieren, SPF/DKIM/DMARC (M3/M10) | Voll | – | – | – |
| API-Keys & Webhooks verwalten, OpenAPI (M5/M10) | Voll | – | – | – |
| Optigem-Integration/n8n-Sync konfigurieren (M4/M10) | Voll | – | – | – |
| Backups & Datenexporte, Retention/Loeschung (M1/M10) | Voll | – | – | – |
| Benutzer & Rollen verwalten, Fach-Zuordnung Dozenten (M10) | Voll | – | – | – |
| Audit-Log / System-Zugriffslogs einsehen (M10) | Voll | Lesen | – | – |
| Impersonation ('Log in as') fuer Support (M10) | Voll | – | – | – |
| DSGVO-Werkzeuge: Export/Auskunft/Anonymisierung ausfuehren (M1) | Voll | Lesen | – | Eigene |
| Schul-Struktur pflegen: Jahrgaenge/Semester/Faecher/Termine/Lektuere/Bewertungsschema (M10) | Voll | Voll | – | – |
| Anmeldeformular/Formular-Builder inhaltlich pflegen, Versionierung (M2) | Voll | Voll | – | – |
| Eigene Bewerbung ausfuellen/einreichen, Referenzgeber benennen (M2) | – | – | – | Eigene |
| Anmeldung genehmigen / ablehnen / auf Warteliste setzen (M2) | – | Voll | – | – |
| Bewerbungen inkl. Referenzen/sensibler Felder einsehen (M2) | Lesen | Voll | – | Eigene |
| Glaubensbekenntnis-/Covenant-Zustimmung (Art.9) einsehen (M2) | – | Lesen | – | Eigene |
| Teilnehmer-Stammdaten anlegen/bearbeiten (M1) | Voll | Voll | – | Eigene |
| Teilnehmer-Akte einsehen (Dokumente, Verlauf, interne Notizen) (M1) | Lesen | Voll | – | Eigene |
| Status-Lebenslauf aendern (Interessent->Aktiv->Absolvent/Pausiert) (M1) | – | Voll | – | – |
| Namens-/Kursliste der Teilnehmer sehen (M1/M6) | Lesen | Voll | Eigene | – |
| Listen/Filter/Segmente/Export ueber alle Teilnehmer (M1) | Voll | Voll | – | – |
| E-Mail-Vorlagen je Prozess erstellen/bearbeiten (M3) | Voll | Voll | – | – |
| Rundschreiben an gefilterte Segmente senden (M3) | Voll | Voll | – | – |
| Ankuendigung/Nachricht an Teilnehmer senden (M3) | Voll | Voll | Eigene | – |
| Versandprotokoll/Zustelllogs einsehen (M3) | Voll | Lesen | – | – |
| Eigene Benachrichtigungspraeferenzen setzen, Abmeldung Rundschreiben (M9) | Eigene | Eigene | Eigene | Eigene |
| Finanzuebersicht/OP-Ampel-Dashboard sehen (M4) | Lesen | Voll | – | – |
| Finanzsicht in Teilnehmer-Akte (Saldo, Zahlungen, Ermaessigung) (M4) | Lesen | Voll | – | – |
| Ehepartner-/Sonder-Ermaessigung (50%) zuweisen/bestaetigen (M4) | – | Voll | – | – |
| Zahlungserinnerung ausloesen (einzeln + Rundschreiben ueberfaellig) (M4) | – | Voll | – | – |
| Eigener Saldo/Zahlungshistorie (Schalter, Default aus) (M4/M9) | – | – | – | Eigene |
| Material hochladen/organisieren (Audio/PDF/Office/Bild bis 500MB) (M7) | – | Voll | Eigene | – |
| Material abrufen/herunterladen, Audio abspielen (M7/M9) | Lesen | Voll | Eigene | Eigene |
| Lektuereliste pflegen (M6/M10) | – | Voll | Eigene | – |
| Lektuere selbst bestaetigen (Haekchen) (M6) | – | – | – | Eigene |
| Pruefung anlegen/bearbeiten, Fragenkatalog pflegen (M8) | – | Voll | Eigene | – |
| Pruefung durchfuehren/ablegen (Zeitfenster, Auto-Save) (M8) | – | – | – | Eigene |
| Pruefung bewerten (Auto + Freitext/Ollama), Ergebnis freigeben (M8) | – | Voll | Eigene | – |
| Noten/Leistungen eintragen (M6) | – | Voll | Eigene | – |
| Noten nach Finalisierung aendern (Aenderungsantrag/Freigabe) (M6/M8) | – | Voll | – | – |
| Anwesenheit erfassen (mobil abhaken, 80%-Ampel) (M6) | – | Voll | Eigene | – |
| Entschuldigung mit Quotenwirkung genehmigen/ablehnen (M6) | – | Voll | – | – |
| Entschuldigung/Beleg selbst einreichen (M6) | – | – | – | Eigene |
| Eigene Ergebnisse/Anwesenheitsstand/Fortschritt sehen (M6/M9) | – | – | – | Eigene |
| Degree-Audit/Abschluss pruefen, Zertifikat/Transcript freigeben (M6) | – | Voll | – | – |
| Eigenes Zeugnis/Abschluss-PDF herunterladen (nach Freigabe) (M6/M9) | – | Lesen | – | Eigene |
| Kohorten-/Retention-/Abschlussreports ueber alle Faecher (Reporting) | Lesen | Voll | – | – |
| Noten-/Anwesenheitsstatistik des eigenen Fachs auswerten (Reporting) | Lesen | Voll | Eigene | – |

### Hinweise zu heiklen Rechten

- Art.-9-Daten (Glaubensbekenntnis/Covenant, Referenzen zu religioeser Ueberzeugung): fachliche Einsicht ausschliesslich Schulleiter. Administrator hat technisch Zugriff auf verschluesselte Felder nur wo betrieblich noetig und stets protokolliert - kein beilaeufiges Lesen.
- Trennung technisch/fachlich (analog Populi System-Admin vs. Academic Admin): Administrator baut Regeln/Struktur, trifft aber KEINE Zulassungs- oder Notenentscheidung; Schulleiter wendet sie an, hat aber KEINE SMTP-/API-/Backup-Rechte.
- IDOR-Schutz kritisch bei Dozent: 'own' muss serverseitig per Row-Level-Scoping auf die Fach-Zuordnung durchgesetzt werden (nicht nur UI-seitig), sonst Zugriff auf fremde Faecher/Teilnehmer moeglich. Gilt ebenso fuer Teilnehmer 'own' (nur eigene ID).
- Dozent sieht bewusst KEINE Finanzen (M4) und KEINE vollstaendigen Stammdaten/Sensibelfelder (IBAN, SV-Nr) - nur die fuer den Unterricht noetigen Kontaktdaten der eigenen Kursliste.
- Teilnehmer-Finanzsicht (eigener Saldo): Schalter vorbereitet, Default AUS - initial nur Schulleiter. Bei Aktivierung strikt nur eigene Daten; Ehepartner-Sicht nur mit expliziter Einwilligung.
- Impersonation ('Log in as') nur Administrator und immer mit Audit-Kennzeichnung; standardmaessig dem Admin vorbehalten, nicht dem Schulleiter.
- Audit-Log: Administrator sieht rohe System-/Zugriffslogs; Schulleiter nur fachliche Aenderungsprotokolle (z.B. Notenaenderung Alt->Neu). Jede Notenaenderung nach Finalisierung erzeugt Pflicht-Audit-Eintrag.
- Hard-Delete/Anonymisierung nur Administrator und nur mit Bestaetigung + Log-Eintrag (Retention-Pruefung); Schulleiter kann nicht hart loeschen.
- Referenzgeber/Pastor ist KEINE Login-Rolle: Zugriff nur ueber tokenisierten, zeit-/einmal-begrenzten Einmal-Link ohne Account; Antwort fuer den Bewerber vertraulich (nicht in 'own' des Teilnehmers enthalten).
- Optigem bleibt fuehrend: die Software bucht nichts (nur lesender OP-Sync). 'full' auf Finanzen bedeutet fuer Schulleiter Sicht + Erinnerungs-/Ermaessigungssteuerung, nicht Buchung.
- 'own' bei Teilnehmer = ausschliesslich eigenes Datensubjekt; kein Zugriff auf andere Teilnehmer, interne Notizen, nicht freigegebene Ergebnisse oder Musterloesungen vor Freigabe.
- Self-Check-in/Anwesenheit: Teilnehmer kann sich NICHT selbst auf 'anwesend' setzen ohne zeit-/ortsgebundene Verifikation (Missbrauchsschutz); daher kein 'own'-Schreibrecht auf Anwesenheitsstatus.

## 7 · Prozessflüsse (End-to-End)

Der vom Schulleiter gewünschte Prüfungs-Fluss (*gestalten → freigeben → Schüler benachrichtigen*) ist mit ⭐ markiert.

### Anmeldung → Genehmigung → Account & Willkommen

*Auslöser:* Interessent öffnet den öffentlichen Anmeldelink (kein Account nötig)

1. **[Interessent]** Füllt den geführten Formular-Wizard aus (Stammdaten, programmspezifische Fragen, optional Ehepaar-Kennzeichen)
   - ⚙️ *Automatisch:* Sensible Felder (IBAN, SV-Nr.) werden beim Speichern AES-256-GCM verschlüsselt; Fortschritt speicherbar, später fortsetzbar
2. **[Interessent]** Bestätigt Datenschutz-Checkbox und aktuelle Glaubensbekenntnis-Version, benennt 1–2 Referenzgeber (Pastor/Charakter) und reicht die Bewerbung ein
   - 📧 *Benachrichtigung:* Eingangsbestätigung per E-Mail an den Bewerber (Vorlage M3)
   - ⚙️ *Automatisch:* Consent-Version + Zeitstempel protokolliert; Status wird auf 'Angemeldet' gesetzt und erscheint in der Pipeline; bei Ehepaar zweiter verknüpfter Datensatz mit eigenem Link an den Partner
3. **[System]** Erzeugt je Referenzgeber einen tokenisierten Einmal-Link und stößt die Referenzanfragen an
   - 📧 *Benachrichtigung:* Referenz-Anforderung an Pastor/Charakterreferenz; interne Benachrichtigung/To-Do 'Neue Anmeldung prüfen' an den Schulleiter
   - ⚙️ *Automatisch:* Auto-Versand der Referenzanfragen bei Einreichung; Reminder-Kadenz bei Ausbleiben nach X Tagen
4. **[Referenzgeber]** Füllt die Empfehlung ohne Account aus und sendet sie ab
   - 📧 *Benachrichtigung:* Automatische Erinnerung an säumige Referenzgeber; Info an Schulleiter, sobald prüfbereit
   - ⚙️ *Automatisch:* Referenz wird als 'erhalten' markiert; Vollständigkeits-Checkliste (Formular + Bekenntnis + alle Pflichtreferenzen) aktualisiert; bei Vollständigkeit Auto-Status 'prüfbereit'
5. **[Schulleiter]** Öffnet die prüfbereite Bewerbung inkl. Referenzen/Dokumenten und entscheidet: Genehmigen, Ablehnen oder Warteliste (mit Begründung)
   - 📧 *Benachrichtigung:* Bei Ablehnung freundliche Absage mit Kontaktmöglichkeit; bei Warteliste Info zur Warteposition; jeweils Vorlage je Ausgang
   - ⚙️ *Automatisch:* Statuswechsel wird protokolliert (wer/wann/warum); passende Entscheidungs-Vorlage wird ausgelöst
6. **[Schulleiter]** Genehmigt die Bewerbung
   - 📧 *Benachrichtigung:* Zusage-Mail mit nächsten Schritten an den Bewerber; interne Info an Finanzstelle 'Debitor & Beitrag angelegt'
   - ⚙️ *Automatisch:* Ein-Klick-Übernahme Bewerber→Kartei ohne Doppelerfassung, Status 'Genehmigt'→'Aktiv', Zuordnung Jahrgang 2026–29; n8n-Webhook legt Optigem-Debitor + Abo-Artikel 'Semesterbeitrag' an (Ehepartner 50%)
7. **[System]** Aktiviert Teilnehmer-Rolle und passwortlosen Portalzugang
   - 📧 *Benachrichtigung:* Willkommens-/Onboarding-Mail mit Magic-Link (15 min), Starttermin, Material-Hinweis und ICS-Kalender aller Abende
   - ⚙️ *Automatisch:* Automatischer Magic-Link-Versand bei Statuswechsel auf 'Aktiv'; Kohorten-/Terminplan-Zuordnung (10 Dienstagabende ab 15.09.2026)
8. **[Teilnehmer]** Loggt sich per Magic-Link ein, arbeitet die Onboarding-Checkliste ab und vervollständigt sein Profil
   - 📧 *Benachrichtigung:* Erinnerung an offene Onboarding-To-Dos
   - ⚙️ *Automatisch:* Erstes Semester-Material wird zum Semesterstart automatisch freigeschaltet

### Online-Prüfung: gestalten → freigeben → benachrichtigen → ablegen → auswerten → Ergebnis-Release → fließt in Leistung ⭐

*Auslöser:* Dozent will für sein Fach eine Prüfungsleistung erheben (M8)

1. **[Dozent]** Legt eine neue Prüfung an (Titel, Anweisungen) und zieht Fragen aus dem wiederverwendbaren Fragenkatalog oder erstellt neue (MC, Wahr/Falsch, Zuordnung, Reihenfolge, Lückentext, Zahl, Kurzantwort, Freitext)
   - ⚙️ *Automatisch:* Punkte-Summe wird automatisch gebildet und gegen die angekündigte Gesamtpunktzahl auf Konsistenz geprüft; optional generiert Ollama lokal MC-Fragen + Distraktoren aus der Materialplattform als Entwurf
2. **[Dozent]** Hinterlegt bei Kurzantworten akzeptierte Antworten inkl. Teilpunkte, ordnet Freitextfragen eine Rubric zu und setzt Zeitfenster von–bis, ein Versuch (konfigurierbar), Randomisierung und Feedback-Sichtbarkeit
   - ⚙️ *Automatisch:* Prüfung wird als 'geplant' gespeichert und bleibt für Teilnehmer verborgen
3. **[Dozent]** Veröffentlicht die Prüfung bzw. plant den Öffnungszeitpunkt
   - 📧 *Benachrichtigung:* E-Mail + Portal-Hinweis an die Kohorte 'Neue Prüfung verfügbar ab TT.MM. bis TT.MM.' (kein Prüfungsinhalt im Betreff)
   - ⚙️ *Automatisch:* System schaltet die Prüfung zum Startzeitpunkt automatisch für die Fach-/Jahrgangskohorte frei und schließt sie bei Fensterende (Cron/n8n)
4. **[System]** Überwacht das Zeitfenster und erinnert noch nicht gestartete Teilnehmer
   - 📧 *Benachrichtigung:* Reminder-Mail an noch nicht Gestartete
   - ⚙️ *Automatisch:* Automatische Erinnerungs-Kaskade an säumige Teilnehmer vor Fensterende
5. **[Teilnehmer]** Startet die Prüfung via Magic-Link im Zeitfenster und beantwortet die Fragen
   - ⚙️ *Automatisch:* Laufende Zwischenspeicherung mit Wiederaufnahme nach Verbindungsabbruch; Countdown-/Restzeit-Anzeige; randomisierte Fragenreihenfolge je Teilnehmer
6. **[Teilnehmer]** Gibt die Prüfung ab (oder Auto-Abgabe bei Zeit-/Fensterablauf)
   - 📧 *Benachrichtigung:* Abgabebestätigung an den Teilnehmer
   - ⚙️ *Automatisch:* Alle geschlossenen Fragen (MC/Wahr-Falsch/Zuordnung/Reihenfolge/Lückentext/Zahl/hinterlegte Kurzantworten inkl. Teilpunkte) werden sofort automatisch ausgewertet; besteht die Prüfung nur daraus, ist sie vollständig benotet
7. **[Dozent]** Bewertet offene Freitext-Antworten je Rubric-Kriterium (optional anonymisiert für Fairness) und vergibt Punkte + Kommentar
   - 📧 *Benachrichtigung:* Interne Erinnerung an den Dozenten bei überfälligen Bewertungen
   - ⚙️ *Automatisch:* Ollama liefert lokal einen Rubric-basierten Punktevorschlag mit Begründung; Human-in-the-Loop, der Dozent bestätigt oder überschreibt; Ausreißer-Bewertungen werden markiert
8. **[Dozent]** Gibt das Ergebnis frei (explizites Release, ganze Kohorte auf einen Klick)
   - 📧 *Benachrichtigung:* E-Mail + Portal-Meldung an den Teilnehmer 'Deine Prüfungsergebnisse sind verfügbar' (nur Portal-Verweis, kein Ergebnis im Betreff); bei 'nicht bestanden' Hinweis auf Wiederholung/Rücksprache; interne Info an den Schulleiter bei nicht bestandenem Fach
   - ⚙️ *Automatisch:* Note + konfiguriertes Feedback werden sichtbar; Ergebnis fließt automatisch in die Leistungserfassung (M6), setzt bestanden/nicht-bestanden und aktualisiert die Abschluss-Voraussetzung — keine Doppelerfassung
9. **[Schulleiter]** Gewährt bei Bedarf eine Ausnahme (verlängerte Zeit, individuelles Fenster, Nachtermin, zusätzlicher Versuch)
   - 📧 *Benachrichtigung:* Benachrichtigung an den betroffenen Teilnehmer über den gewährten Termin/Versuch
   - ⚙️ *Automatisch:* Bei mehreren Versuchen wird die konfigurierte Wertungslogik (höchste/letzte/Durchschnitt) automatisch angewandt

### Anwesenheit am Unterrichtsabend mobil erfassen inkl. 80%-Warnung ⭐

*Auslöser:* Ein Dienstagabend-Termin beginnt bzw. endet

1. **[Dozent]** Öffnet mobil die Teilnehmerliste des aktuellen Termins seines Fachs
   - ⚙️ *Automatisch:* Alle Teilnehmer stehen per Default auf 'Anwesend' (Bulk-Default spart Klicks bei kleiner, meist vollzähliger Gruppe)
2. **[Dozent]** Stellt nur die Abweichungen um (Fehlend/Verspätet/Entschuldigt) und speichert
   - ⚙️ *Automatisch:* Quote je Teilnehmer wird sofort neu berechnet und über alle Semester kumulativ aggregiert; Ampel grün ≥80%, gelb im Grenzbereich, rot <80% — kein manuelles Nachzählen
3. **[System]** Prüft nach jeder Erfassung die erreichbare Rest-Quote gegen die 80%-Schwelle
   - 📧 *Benachrichtigung:* Frühwarn-Mail an den Teilnehmer 'Deine Anwesenheit nähert sich der 80%-Grenze'; Eskalations-Alert an den Schulleiter bei rot
   - ⚙️ *Automatisch:* Schwellwert-Trigger vollautomatisch: sobald rechnerisch nur noch wenig Puffer besteht → gelb, sobald 80% nicht mehr erreichbar → rot; gefährdete Teilnehmer erscheinen im Leiter-Dashboard
4. **[Teilnehmer]** Reicht für einen Fehltermin eine Entschuldigung mit Grund und optionalem Attest-Upload ein
   - 📧 *Benachrichtigung:* Eingangsbestätigung an den Teilnehmer; Aufgabe/Benachrichtigung an den Schulleiter
   - ⚙️ *Automatisch:* Beleg-Upload mit Magic-Bytes- und Path-Traversal-Schutz; Termin wird vorläufig als 'Entschuldigung beantragt' markiert; Frist-Logik (Beleg binnen X Tagen, sonst automatischer Verfall)
5. **[Schulleiter]** Prüft den Beleg und genehmigt (→ 'Entschuldigt') oder lehnt ab (→ bleibt 'Fehlend')
   - 📧 *Benachrichtigung:* Ergebnis-Mail (genehmigt/abgelehnt) an den Teilnehmer
   - ⚙️ *Automatisch:* Quote wird nach der Entscheidung automatisch neu berechnet
6. **[System]** Überwacht die Erfassungspflicht je Termin
   - 📧 *Benachrichtigung:* Reminder an den Dozenten
   - ⚙️ *Automatisch:* Erinnerung an den Dozenten, falls der Termin vorbei ist und die Erfassung fehlt

### Lektüre-Selbstbestätigung durch den Teilnehmer

*Auslöser:* Pflichtlektüre je Fach/Semester wird hinterlegt oder aktualisiert

1. **[Schulleiter]** Hinterlegt in der Administration (M10) die Pflichtlektüre je Fach/Semester
   - 📧 *Benachrichtigung:* Benachrichtigung an die Teilnehmer bei neuer/aktualisierter Lektüreliste
   - ⚙️ *Automatisch:* Lektüreliste wird dem Fach zugeordnet und im Portal des berechtigten Jahrgangs sichtbar
2. **[Teilnehmer]** Öffnet die Liste im Portal und hakt gelesene Titel selbst ab (bestätigt Lektüre)
   - ⚙️ *Automatisch:* Fortschritt fließt automatisch in die Fach- und die Abschluss-Übersicht ein
3. **[System]** Erinnert an noch offene Pflichtlektüre vor Semesterende
   - 📧 *Benachrichtigung:* Erinnerungs-Mail/Portal-Hinweis an den Teilnehmer
   - ⚙️ *Automatisch:* Auto-Erinnerung an unbestätigte Pflichtlektüre kurz vor Semesterende
4. **[Schulleiter]** Sieht den Lektüre-Stand und berücksichtigt ihn als Abschlussvoraussetzung
   - ⚙️ *Automatisch:* Eingang in die Abschluss-Checkliste/Degree-Audit automatisch

### Neues Material hochladen → Jahrgang benachrichtigen ⭐

*Auslöser:* Dozent will Unterrichtsmaterial für einen Abend bereitstellen (M7)

1. **[Dozent]** Öffnet sein Fach im aktuellen Semester und wählt bzw. erstellt die Lektion/den Ordner für den Unterrichtsabend
2. **[Dozent]** Lädt Dateien hoch (Audio bis 500 MB, PDF, Präsentation, Bilder) und ergänzt Titel/Beschreibung sowie optional einen Leseauftrag
   - ⚙️ *Automatisch:* Magic-Bytes-Validierung und Path-Traversal-Schutz, Fortschrittsbalken; Audio-Dauer wird ausgelesen und angezeigt; optional Ollama-Kurzbeschreibung als Suchhilfe
3. **[Dozent]** Setzt die Sichtbarkeit (sofort veröffentlichen oder 'sichtbar ab' Datum, z. B. Abend des Unterrichts) und veröffentlicht
   - ⚙️ *Automatisch:* Bei 'sichtbar ab' zeitgesteuerte Auto-Veröffentlichung per Cron
4. **[System]** Benachrichtigt den berechtigten Jahrgang über das neue Material
   - 📧 *Benachrichtigung:* Gebündelte E-Mail 'Neues Material in <Fach>' mit Deep-Link ins Portal; Portal-Badge 'neu' am Fach und im Startseiten-Widget
   - ⚙️ *Automatisch:* Empfänger werden automatisch aus der Jahrgangszugehörigkeit abgeleitet (kein manuelles Rechte-Setzen); mehrere Uploads werden zu einem Digest gebündelt statt als Einzelmails (Anti-Spam) via n8n

### Optigem offener Posten → gestaffelte Zahlungserinnerung

*Auslöser:* Geplanter n8n-Cron-Sync liest die offenen Posten aus Optigem

1. **[System (n8n)]** Liest je Debitor die offenen Posten (Rechnungsnummer + Saldo je Rechnung) aus Optigem
   - ⚙️ *Automatisch:* Periodischer Cron-Sync, idempotent per Rechnungsnummer + Saldo (keine Doppelzählung); Optigem bleibt führend, GBS Campus bucht nichts
2. **[System]** Aktualisiert das Finanz-Dashboard und ordnet Zahlungen gegen den Raten-/Beitragsplan zu
   - ⚙️ *Automatisch:* Ampel je Teilnehmer (bezahlt/teilbezahlt/offen/überfällig) aus OP-Saldo + Fälligkeit; Ehepartner-50%-Tarif korrekt berücksichtigt
3. **[Schulleiter]** Sieht den OP-Status in der Akte und im Ampel-Dashboard und kann eine Erinnerung auslösen oder ein Hinweis-Flag setzen
   - ⚙️ *Automatisch:* Teilnehmer-Finanzsicht vorerst nur für den Leiter (Schalter vorbereitet); Export für Buchhaltung/Beirat möglich
4. **[System]** Erkennt überfällige Rechnungen/Raten und fährt die gestaffelte Dunning-Kadenz
   - 📧 *Benachrichtigung:* Mehrstufige Zahlungserinnerungen an den Teilnehmer (Vorlage M3 mit Platzhaltern Name/Betrag/Fälligkeit/Rechnungsnr.); interne Benachrichtigung an den Schulleiter bei roter Stufe
   - ⚙️ *Automatisch:* Stufe 1 freundlich bei Fälligkeit, Stufe 2 +7 Tage, Stufe 3 deutlicher +14/+30 Tage; Ausnahme-Liste (kein Dunning bei aktivem, pünktlichem Ratenplan); seelsorglicher Ton statt harter Sperre
5. **[System]** Verarbeitet den Zahlungseingang beim nächsten Sync
   - 📧 *Benachrichtigung:* Optionale Zahlungseingangs-Bestätigung an den Teilnehmer
   - ⚙️ *Automatisch:* Bei Ausgleich (Saldo 0) stoppt die Mahnkette automatisch, Ampel wird grün

### Abschluss / Degree Audit → Zertifikatsausstellung

*Auslöser:* Teilnehmer nähert sich dem Ende des 6. Semesters oder stellt einen Abschlussantrag

1. **[System]** Prüft laufend die Abschlusskriterien je Teilnehmer
   - 📧 *Benachrichtigung:* Hinweis an den Schulleiter 'Teilnehmer X erfüllt die Abschlusskriterien — Zeugnis freigeben'
   - ⚙️ *Automatisch:* Echtzeit-Clearance: alle 7 Fächer bestanden + 80% Gesamtanwesenheit + Lektüre bestätigt + keine offenen Beiträge (Finanz-Ampel); markiert 'abschlussbereit', sobald alle Kriterien erfüllt sind
2. **[Schulleiter]** Öffnet den Degree Audit, prüft die Datengrundlage per Drill-down und gibt den Abschluss frei
   - ⚙️ *Automatisch:* Automatische Kriterienprüfung inkl. Finanz-Ampel; bei offenen Punkten Rückmeldung statt Freigabe
3. **[System]** Erzeugt den Abschlussnachweis und schließt den Lebenszyklus
   - 📧 *Benachrichtigung:* Gratulations-/Abschluss-Mail mit Verweis auf den Zeugnis-Download im Portal; Info an den Schulleiter über die erfolgten Abschlüsse des Jahrgangs
   - ⚙️ *Automatisch:* Zertifikat-/Abschluss-PDF aus M6-Daten im Corporate Design, Ablage in der Akte, Batch-Erzeugung für die ganze Kohorte möglich; Statuswechsel Aktiv→Absolvent + Alumni-Tag; n8n beendet das Optigem-Abo
4. **[Teilnehmer]** Lädt den Abschlussnachweis im Portal (M9) herunter

### Wiedereinschreibung je Semester (Re-Enrollment)

*Auslöser:* Vor Beginn eines neuen Semesters im 3-Jahres-Programm

1. **[System]** Startet die Re-Enrollment-Kampagne für alle aktiven Teilnehmer
   - 📧 *Benachrichtigung:* Re-Enrollment-Erinnerung an die Teilnehmer vor Semesterstart
   - ⚙️ *Automatisch:* Automatische Kampagne je Semester via n8n/Cron
2. **[Teilnehmer]** Bestätigt die Fortsetzung im Portal (leichter Schritt, keine Voll-Neubewerbung)
   - 📧 *Benachrichtigung:* Bestätigung der Wiedereinschreibung an den Teilnehmer
   - ⚙️ *Automatisch:* Kein erneutes Ausfüllen des Anmeldeformulars nötig
3. **[System]** Reaktiviert Beitragslauf und Terminzuordnung fürs neue Semester
   - ⚙️ *Automatisch:* Optigem-Rechnung/Abo fürs neue Semester wird über n8n angestoßen; Zuordnung zu Kohorte und Terminplan (10 Dienstagabende)
4. **[Schulleiter]** Sieht die Liste noch nicht rückbestätigter Teilnehmer und prüft Grenzfälle
   - 📧 *Benachrichtigung:* Leiter-Übersicht offener Rückbestätigungen; Vorschlag 'Pausiert' zur Bestätigung
   - ⚙️ *Automatisch:* Bei ausbleibender Bestätigung/Anwesenheit regelbasierter Vorschlag Statuswechsel auf 'Pausiert'; Rückkehrer durchlaufen den verkürzten Readmission-Workflow

### Rundschreiben / Ankündigung an ein Segment

*Auslöser:* Schulleiter oder Dozent will ein Segment informieren (Ausfall, Raumänderung, Terminerinnerung)

1. **[Schulleiter]** Filtert die Empfänger (Jahrgang/Status/Fach) und wählt eine Vorlage mit Platzhaltern oder verfasst frei
   - ⚙️ *Automatisch:* Gespeicherte Segmente als wiederverwendbare Mailinglisten
2. **[Schulleiter]** Führt einen Testversand an sich selbst durch und versendet dann an das Segment
   - 📧 *Benachrichtigung:* E-Mail an das Empfängersegment + Portal-Ankündigung
   - ⚙️ *Automatisch:* Platzhalter werden aufgelöst; Versand über eigenes SMTP mit Anzeigename + Reply-To; automatische Unterdrückung abgemeldeter/ungültiger Adressen
3. **[System]** Protokolliert Zustellung und Bounces
   - 📧 *Benachrichtigung:* Zustell-/Bounce-Rückmeldung an den Absender
   - ⚙️ *Automatisch:* Zustell-/Bounce-Status im Versandprotokoll (M3); optional zeitversetzter/geplanter Versand (z. B. Erinnerung 24 h vor dem Abend) via n8n/Cron

## 8 · UX/UI-Prinzipien — Apple-like & prozessgesteuert

1. **Passwortlos als Grundhaltung, nicht als Feature** — Jeder Zugang laeuft ueber Magic-Link (Teilnehmerportal 15 Min gueltig, Bewerber ohne Account in M2). Nirgends ein Passwort-Feld, nirgends 'Konto anlegen'. Das loest gezielt das Teams-Gastaccount-Chaos: Der berufstaetige Abendschueler tippt seine Mail, klickt den Link im Postfach und ist drin. Referenzgeber und (spaeter) Field-Supervisor bekommen genau EINEN tokenisierten Link zu genau EINEM Formular.
2. **Rollen-Dashboard beantwortet 'Was ist fuer mich jetzt dran?'** — Statt Menuebaum sieht jede der 4 Rollen nach dem Login 3-5 faellige Aktionen: Schulleiter = offene Anmeldungen, kritische Anwesenheitsquoten, offene Beitraege; Dozent = eigene Faecher mit offenen Bewertungen; Teilnehmer = naechster Dienstagabend, neues Material, offene Pruefung, Lektuere-Stand; Administrator = SMTP/Backup/Integrations-Status. Kein leerer Screen, jede Kachel ist ein Ein-Klick-Sprung in die Akte/Pruefung/Material.
3. **Ampel statt Zahlenwueste** — Die zwei GBS-Kernkennzahlen sind farbcodiert: 80%-Anwesenheit (M6) und Finanz-OP aus Optigem (M4) als gruen/gelb/rot am Profil, in Listen und im Dashboard. Kommuniziert wird das Kontingent ('noch 1 Fehlabend moeglich'), nicht nur der nackte Prozentwert. CREDO-Ampelfarben (gruen #6BAA24 / gelb #FBC900 / rot #E2001A) ueber Theme-Variablen, keine Farbverlaeufe.
4. **Gefuehrte Wizards mit Auto-Save statt Riesenformular** — Anmeldung (M2) und Pruefungs-Durchfuehrung (M8) laufen Schritt fuer Schritt mit sichtbarem Fortschritt und laufender Zwischenspeicherung. 'Speichern & Fortsetzen' erlaubt dem Bewerber, abends am Handy in mehreren Etappen fertig zu werden; der Pruefling verliert bei Verbindungsabbruch nichts. Sichtbare 'gespeichert'-Bestaetigung und Rest-Zeit-Countdown im Pruefungsfenster.
5. **Berechtigung formt die Oberflaeche, nicht nur den Zugriff** — Der Dozent sieht gar keine Finanz- oder Stammdaten-UI, der Teilnehmer keine Verwaltung. Verboten = ausgeblendet, nicht 'Zugriff verweigert'-Wand. Der Dozent arbeitet immer im sichtbaren Scope 'Fach X, Semester 3' und sieht nur eigene Faecher. UI-Ausblenden ist immer mit serverseitigem Rollen-Check gekoppelt (Auth-Check zuerst, dann Rolle, dann Validierung).
6. **Ein Klick, keine Doppelerfassung** — Genehmigen in M2 uebernimmt die Formulardaten 1:1 in die Kartei (M1), legt den Optigem-Debitor an und verschickt die Willkommensmail (M3) - kein Abtippen. Freigegebenes Pruefungsergebnis (M8) fliesst automatisch in die Leistungserfassung (M6). Es gibt pro Datum genau einen Wahrheitsort.
7. **Mobile-first fuer Teilnehmer und Anwesenheit** — Der Dienstagabend-Kontext ist mobil: Der Dozent hakt Anwesenheit mit grossen Tap-Zielen ab (Default 'alle da', nur Fehlende umstellen), der Teilnehmer hoert Vorlesungs-Audio (M7) und legt Pruefungen (M8) am Handy ab. Dozenten-Backend (Upload, Bewerten) darf desktop-optimiert sein - unterschiedliche Nutzungskontexte, unterschiedliches Layout.
8. **Leere Zustaende erklaeren den naechsten Schritt** — Nie eine blanke Tabelle. Neuer Jahrgang ohne Teilnehmer zeigt 'Noch keine Anmeldungen - Anmeldelink teilen' mit Kopier-Button; leeres Fach zeigt 'Erstes Material erscheint zum Semesterstart am 15.09.2026'; keine Pruefungen zeigt Blueprint-Vorschlag ('Semester-Abschluss: 20 MC + 2 Essays').
9. **Bestaetigung und Vorschau bei irreversiblen Schritten** — Ablehnung/Abbruch (M2/M1), Noten-Freigabe und Pruefung schliessen (M8), Abschluss-PDF (M6) erfordern einen bewussten zweiten Klick mit Dialog und Protokoll-Notiz. Der Release-Klick bei Pruefungen hat eine 'So sieht es der Teilnehmer'-Vorschau, damit niemand Teilergebnisse vor fertiger Freitext-Bewertung sieht. Statuswechsel sind eine State-Machine, die nur gueltige Folgezustaende anbietet.
10. **Konfigurierbarkeit statt Hardcoding** — Anmeldeformular (Formular-Builder mit Versionierung, M2), E-Mail-Vorlagen mit Platzhaltern (M3), Bewertungsschema (Default bestanden/nicht bestanden, M6), Struktur Jahrgang/Semester/Fach/Termine/Lektuerelisten (M10) sind alle vom Schulleiter/Admin editierbar - kein Entwickler noetig. Neue Jahrgaenge/Faecher werden aus dem Vorjahr geklont statt neu erfasst.
11. **Datenschutz sichtbar am sensiblen Feld** — Bei geistlichen/persoenlichen Angaben steht direkt am Feld 'Warum fragen wir das? Verschluesselt gespeichert' (AES-256-GCM). Die Datenschutz-Checkbox in M2 ist aktive Zustimmung (kein Vorabhaken). Referenz-/Mentoring-Notizen sind fuer den Betroffenen nie sichtbar. Am Profil erreichbar: Einwilligungs-Status und 'Datenkopie exportieren' fuer die DSGVO-Auskunft. Ergebnisse/Betraege nie in Mail-Betreff, nur 'im Portal ansehen'.
12. **Ein konsistentes System im CREDO-Design** — Gleiche Labels, Lucide-Icons, Radix-Primitives und Navigationsmuster ueber alle 10 Module - der Nutzer lernt EIN mentales Modell. Montserrat, Primaergrau #575756 fuer Buttons/Links, CREDO-Linie fuer Status, keine Farbverlaeufe, keine hartcodierten Hex-Werte. Basis WCAG 2.1 AA: Tastaturbedienung, sichtbarer Fokus, Kontrast, Audio mit Bedienelementen.

## 9 · Screen-Inventar

### Schulleiter-Dashboard (Startseite)

*Der Leiter (oft ehrenamtlich) steuert den gesamten Schulbetrieb aus einer Uebersicht und handelt sofort, ohne zu suchen.*

- KPI-Kacheln in CREDO-Ampelfarben: offene Anmeldungen (Badge-Zaehler), Teilnehmer unter 80%-Anwesenheit, offene Optigem-Posten, offene Freitext-Bewertungen
- Aktionsliste 'Zu genehmigen' mit Ein-Klick-Sprung in den Genehmigungs-Posteingang (M2)
- Jahrgangs-Umschalter oben (2026-29 aktiv) als globaler Filter fuer alle darunter liegenden Sichten
- Schnellsuche Name/E-Mail als schnellster Weg in jede Akte
- Leerer Zustand vor Semesterstart: Hinweis + 'Anmeldelink kopieren'

### Dozent-Dashboard (eigenes Fach)

*Der Dozent sieht am Dienstagabend nur seine Faecher und die drei Dinge, die er tun muss - keine Verwaltung, keine Finanzen.*

- Karten je eigenem Fach/Semester mit Kontext-Header 'Systematik, Semester 3'
- Badges: offene Bewertungen, naechster Termin, neu abgegebene Pruefungen
- Ein-Klick-Aktionen: Anwesenheit erfassen (mobil), Material hochladen, Pruefung anlegen/bewerten
- Bewusst KEINE Finanz-/Stammdaten-Kacheln (ausgeblendet, nicht gesperrt)
- Leerer Zustand: 'Noch kein Fach zugewiesen - der Schulleiter weist Faecher in der Administration zu'

### Teilnehmer-Portal-Home (M9)

*Der berufstaetige Erwachsene sieht nach dem Magic-Link-Login sofort seinen Stand und verpasst nichts.*

- 'Naechster Termin'-Karte (Datum/Fach/Ort des naechsten Dienstagabends)
- 'Neues Material' mit ungelesen-Markierung, Deep-Link ins Fach (M7)
- 'Offene Pruefungen' mit Frist und Countdown als klarer Call-to-Action (M8)
- Fortschritts-Ampeln: Anwesenheit (80%-Kontingent), Lektuere-Stand mit Selbstbestaetigung
- Eigene Daten pflegen (Adresse/Telefon inline editierbar), eigene Ergebnisse read-only, Finanzsicht nur wenn Schalter aktiv

### Administrator-Dashboard & Systemstatus

*Der technische Admin prueft auf einen Blick, ob Infrastruktur und Integrationen laufen.*

- Status-Kacheln: SMTP-Versand (Anzeigename/Reply-To/SPF-DKIM-DMARC), letzter Optigem-Sync via n8n, letztes Backup, API-Key-Ablauf
- Benutzer- und Rollenverwaltung mit Klartext 'Was darf wer?'-Matrix
- Erscheinungsbild: Logo/Schulname (M10)
- Impersonation mit persistentem Banner 'Sie handeln als [Name] - beenden'
- Durchsuchbares Audit-Log (wer hat wann was geaendert/gesehen)

### Oeffentlicher Anmelde-Wizard (M2)

*Der Interessent bewirbt sich abends am Handy in mehreren Etappen ohne Account und ohne Huerde.*

- Schrittweiser Ablauf mit Fortschrittsbalken, Validierung pro Schritt, Vor/Zurueck
- Speichern & Fortsetzen per Magic-Link, sichtbare 'gespeichert'-Bestaetigung
- Frei konfigurierte Fragen aus dem Formular-Builder (versionierte Fassung)
- Sensible/geistliche Felder mit Hinweis 'Warum? Verschluesselt gespeichert' (AES-256)
- Ehepaar-Anmeldung (Haushalt verknuepfen), aktive Datenschutz-Checkbox, danach Eingangsbestaetigung per Mail

### Genehmigungs-Posteingang / Bewerbungs-Pipeline (M2)

*Der Schulleiter entscheidet ueber Anmeldungen nachvollziehbar und ohne Medienbruch.*

- Kanban-/Listenansicht: Karten nach Status (Eingegangen/In Pruefung/Genehmigt/Warteliste/Abgelehnt) mit Vollstaendigkeits-Ampel
- Detailpanel mit allen Formularantworten, Ehepaar-Verknuepfung sichtbar
- Aktionen Genehmigen/Ablehnen/Warteliste - jede mit Pflicht-Notizfeld und Protokoll
- Genehmigen loest Ein-Klick-Matrikulation aus: Kartei (M1) + Optigem-Debitor (M4) + Willkommensmail (M3)
- Ablehnung/Abbruch mit Bestaetigungsdialog (destruktiv)

### Teilnehmer-Akte / 360-Grad-Profil (M1)

*Alles zu einer Person auf einer Landeseite - zentraler Arbeitsplatz von Leiter und Sekretariat.*

- Tabs: Stammdaten, Akte/Dokumente, Leistungen (M6), Finanzen (M4, nur Leiter), Kommunikation (M3), Verlauf
- Farbcodiertes Status-Badge mit gefuehrtem Statuswechsel (Interessent->Angemeldet->Genehmigt->Aktiv->Absolvent/Pausiert/Abgebrochen)
- Anwesenheits- und Finanz-Ampel prominent oben
- Ehepaar-Hinweis 'verheiratet mit X' mit Sprung zum Partnerprofil
- Verlauf als chronologische Timeline (Statuswechsel, Mails, Uploads); DSGVO-Werkzeuge (Einwilligung, Export)

### Mobile Anwesenheitsliste (M6)

*Der Dozent erfasst die Praesenz eines Dienstagabends in Sekunden auf dem Handy.*

- Roster des Jahrgangs je Termin, Default 'alle anwesend', ein Tap pro Fehlender
- Grosse Touch-Ziele, Ehepaare als Zeile gruppiert
- Live-Quote + Ampel beim Erfassen: Warnung, wenn ein weiterer Fehlabend jemanden unter 80% drueckt
- Andacht/Lektuere getrennt erfassbar, aber in Gesamt-Ampel zusammengefuehrt
- Nachtrag/Korrektur mit sichtbarem Audit-Eintrag

### Pruefungs-Editor (M8)

*Der Dozent baut eine Pruefung schnell und fehlerfrei, mit Wiederverwendung ueber 6 Semester.*

- Statuskette Entwurf->geplant->laufend->Bewertung->freigegeben mit passenden Aktionen
- Fragetypen: MC/Wahr-Falsch/Zuordnung/Lueckentext/Zahl (auto) + Freitext (manuell); Punkte je Frage mit Live-Punktesumme
- Wiederverwendbarer Fragenkatalog (Frage landet automatisch in der Bank, Import aus anderem Kurs)
- Zeitfenster von-bis getrennt vom Zeitlimit, Erklaerung 'Fenster schlaegt Zeitlimit', ein Versuch konfigurierbar
- Feedback-Sichtbarkeit als Schalterliste; Blueprint als Startpunkt statt leerer Seite

### Pruefungs-Bewertung & Freigabe (M8)

*Der Dozent bewertet Freitext konsistent und gibt Ergebnisse bewusst frei.*

- Frageweise Ansicht ueber alle Teilnehmer (statt teilnehmerweise) fuer einheitliche Bewertung, optional anonymisiert
- Optionaler Ollama-Vorschlag als klar gekennzeichnete 'KI-Vorbewertung' + Begruendung, Dozent bestaetigt/ueberschreibt (Human-in-the-Loop)
- Getrennter Release-Klick mit 'So sieht es der Teilnehmer'-Vorschau
- Sammelaktionen: alle freigeben, alle erinnern, Nachschreib-Fenster fuer Einzelne
- Freigabe schreibt Ergebnis automatisch in die Leistungserfassung (M6)

### Pruefungs-Durchfuehrung Teilnehmer (M8/M9)

*Der Pruefling legt die Pruefung abends am privaten Geraet ab, ohne Angst vor Datenverlust.*

- Ein-Frage-Fokus, Fortschrittsanzeige, Rest-Zeit-Countdown
- Laufende Zwischenspeicherung mit sichtbarer 'gespeichert'-Bestaetigung, Wiederaufnahme nach Abbruch
- Mobiltaugliches Layout, grosse Bedienelemente
- Bestaetigungsdialog vor endgueltigem Abgeben (irreversibel)
- Nachteilsausgleich sichtbar als Badge 'verlaengerte Zeit', falls gesetzt

### Materialplattform / Fach-Ordner (M7)

*Teilnehmer finden Unterlagen und Vorlesungs-Audio pro Abend an einem Ort statt im Teams-Chaos.*

- 3-Ebenen-Navigation Semester -> Fach -> Lektion/Abend mit Breadcrumb
- Datei-Kacheln PDF/Office/Bild/Audio (bis 500MB), neu/ungelesen-Markierung
- Browser-Audio-Player mit Wiedereinstiegs-Merker, Temporegler, Download-Button
- Sichtbarkeit implizit aus Jahrgang/Fachzuweisung; Entwurf vs. veroeffentlicht mit 'sichtbar-ab'-Datum fuer Dozenten
- Gebuendelte Benachrichtigung 'neues Material' (ein Digest je Abend, nicht pro Datei)

### Finanz-Dashboard & Optigem-Abgleich (M4)

*Der Schulleiter sieht Beitragsstand je Teilnehmer und mahnt gezielt - Optigem bleibt fuehrend, die Software bucht nichts.*

- Ampel-Uebersicht je Teilnehmer/Jahrgang (offener Posten je Rechnung, Saldo aus n8n-Sync, read-only)
- Semesterbeitrag 120 EUR, Ehepartner-Ermaessigung transparent ausgewiesen ('-50% = 60 EUR')
- Aging-/Offene-Posten-Report im CFO-Stil (Pareto: wer schuldet wie viel, wie alt)
- Ein-Klick 'Zahlungserinnerung senden' je roter Zeile; Bulk-Mahnung mit Vorschau + Test-Versand + Bestaetigung
- Feature-Schalter 'Teilnehmer-Finanzsicht' sichtbar (zunaechst aus)

### Administration: Struktur & Formular-Builder (M10/M2)

*Schulleiter/Admin konfigurieren Schule, Kommunikation und Anmeldung selbst - ohne Entwickler.*

- Struktur: Jahrgaenge/Semester/Faecher/Termine/Lektuerelisten/Bewertungsschema (Default bestanden/nicht bestanden + 80%), Klonen aus Vorjahr
- Formular-Builder mit frei konfigurierbaren Fragen und Versionierung, oeffentlicher Anmeldelink
- E-Mail-Vorlagen je Prozess mit Platzhaltern, Live-Vorschau, Pflicht-Test-Versand, Versandprotokoll
- Integrationen: API-Keys mit Rechten/Ablauf + Webhooks (M5), Optigem-Verbindung
- Benutzer/Rollen (4 Rollen ab Start aktiv), Erscheinungsbild Logo/Name

## 10 · Betriebs- & Go-Live-Ring

Der 10-Modul-Plan plus die riesige Ergänzungsliste ist inhaltlich außergewöhnlich vollständig: Fachliche Kernprozesse (Anmeldung inkl. Referenz-Workflow, Anwesenheit/80%, Prüfungen, Material, Portal), der DSGVO-Unterbau (Art.9-Consent, Retention/Löschung, zentrales Audit-Log) und die IDOR/Row-Level-Scoping-Blocker sind erkannt und korrekt priorisiert. Die verbleibenden echten Lücken liegen nicht mehr in der Fachlogik, sondern im Betriebs-/Go-Live-Ring drumherum: getesteter Restore, initiale Datenmigration aus Teams für die bereits laufenden Jahrgänge, eine globale Suche, Netzausfall-Härtung der Prüfung im Gemeindehaus-WLAN und Vertretungsregelungen. Diese sind überschaubar und für 20-60 Personen bewusst schlank zu halten - kein Uni-Overengineering nötig, aber ein blinder Restore oder ein fehlender Import der Altjahrgänge kippt den Go-Live genauso hart wie ein DSGVO-Verstoß. Empfehlung: die genannten P0/P1-Betriebspunkte als eigene Ops-Checkliste neben die drei fachlichen P0-Blocker stellen.

- 🔴 **P0** **Getesteter Restore / Disaster-Recovery-Drill (nicht nur Backup)** — Die Matrix nennt nur 'Backups & Datenexporte'. Bei EINER getrennten Docker-Instanz auf eigenem GBS-Server ist das ein Single Point of Failure mit echten Studierenden-, Noten- und Finanzdaten. Ein Backup, dessen Wiederherstellung nie getestet wurde, ist kein Backup. Vor Go-Live einmal real zurückspielen (DB + hochgeladenes Material bis 500MB), RTO/RPO grob festlegen, Ablage off-site. Ohne verifizierten Restore sind Zeugnis-Belastbarkeit und Art.5-Integrität nicht gesichert.
- 🟡 **P1** **Initialer Datenimport / Migration der bereits laufenden Jahrgänge aus Teams** — Nur die Sammel-EINSCHREIBUNG eines NEUEN Jahrgangs über die Bewerbung ist modelliert. Beim Teams-Ablöse-Go-Live 09/2026 existieren aber Alt-Kohorten (z.B. 2024-27, 2025-28), die mitten im 6-Semester-Programm stehen und mit bisheriger Anwesenheit/Leistung/Semesterstand importiert werden müssen - ohne Bewerbungs-Flow. Fehlt ein einmaliger Import-/Bulk-Anlage-Pfad (CSV o.Ä. + Dedupe gegen Optigem), müssen Bestandsteilnehmer abgetippt werden oder bleiben in Teams hängen.
- 🟡 **P1** **Globale Volltext-Suche für Leiter/Admin** — Suche wird in der Matrix nur implizit bei Dedupe erwähnt, ist aber als eigenständige Funktion nirgends verankert. Der Leiter muss über Jahrgänge hinweg schnell 'Person/Bewerbung/Akte' per Name/E-Mail finden (Telefonat, Rückfrage). Bei 20-60 aktiven + wachsendem Alumni-/Interessenten-Bestand reicht Filtern je Liste nicht; eine einfache serverseitig gescopte Suchleiste genügt - kein Elastic nötig.
- 🟡 **P1** **Netzausfall-/Offline-Härtung der Prüfung (Gemeindehaus-WLAN, mobil)** — M8 nennt laufende Zwischenspeicherung und Auto-Save-Recovery, aber die Zielsituation ist Abendschule im Gemeindehaus mit schwachem WLAN auf privaten Handys. Was passiert bei Verbindungsabbruch während laufendem Zeitlimit? Lokaler Draft-Puffer, klare 'offline/wieder verbunden'-Anzeige, Schutz vor Doppelabgabe beim Reconnect und eine Kulanz-/Nachschreibregel des Leiters sind nötig, sonst Streit um verlorene Antworten. Real am Handy im schlechten Netz testen.
- 🔵 **P2** **Rollen-Vertretung / Delegation (Dozenten-Abwesenheit, Co-Dozent, Leiter-Urlaub)** — Nur 'Leiter als Fallback' wird beiläufig genannt. In der Praxis fällt ein Dozent aus oder ein Fach wird zu zweit gehalten; der Leiter ist berufsbegleitend selbst nicht immer da. Ein schlanker Weg, einem zweiten Dozenten temporär Zugriff auf ein Fach zu geben bzw. Genehmigungen (Entschuldigung, Notenfreigabe) zu vertreten, verhindert Blockaden. Für diese Größe reicht 'zusätzlicher Dozent je Fach' + Leiter-Allzugriff, kein Rechte-Workflow-Apparat.
- 🔵 **P2** **Betriebs-Monitoring: Health-Check, Uptime-/Fehler-Alerting, SMTP-Zustellrate** — Einzelner Server, passwortloses Login komplett von E-Mail-Zustellung abhängig. Fällt SMTP oder die Instanz aus, merkt es niemand, bis Teilnehmer sich dienstagabends nicht einloggen können. Ein einfacher Health-Endpoint + Uptime-Ping + Alert an Admin (und Monitoring der Bounce-/Fehlerrate der Magic-Link-Mails) ist minimaler Ops-Standard, in keinem Modul verankert.
- 🔵 **P2** **Admin-Login-Härtung / zweiter Faktor für privilegierte Konten** — Der alleinige Kontoschlüssel ist der Magic-Link; das Admin-Konto kann SMTP, API-Keys, Backups, Impersonation und alle Daten. Ein kompromittierter E-Mail-Posteingang des Admins = Totalübernahme. Für 2-3 privilegierte Konten (Admin/Leiter) einen zweiten Faktor oder zumindest IP-/Geräte-Bestätigung erwägen; Teilnehmer bleiben beim reinen Magic-Link. Nicht überbauen, aber bewusst entscheiden statt implizit weglassen.
- 🔵 **P2** **Warteliste-Nachrück-Prozess** — Warteliste als Status ist vorgesehen, aber das Nachrücken (Platz frei → nächsten Wartenden benachrichtigen/aktivieren, Frist zum Bestätigen) ist nicht als Ablauf modelliert. Bei kleiner Schule selten, aber wenn es auftritt, soll es nicht manuell/vergessen laufen. Ein Ein-Klick 'nachrücken → Zusage-Mail mit Frist' genügt.
- 🔵 **P2** **Zertifikats-/Transcript-Verifikation für Dritte** — Abschluss-PDF ist bewusst auf 2029 gelegt. Für später (nicht Go-Live) sollte eingeplant sein, wie eine Gemeinde/ein Arbeitgeber die Echtheit eines Zeugnisses prüft (Prüf-URL oder Referenznummer gegen einen minimalen Verifikations-Endpoint). Jetzt nur im Datenmodell mitdenken, nicht bauen - daher niedrige Priorität.

## 11 · Aktualisierte Roadmap

Rückwärts geplant ab Kursstart 15.09.2026; die drei P0-Blocker sind in Phase 1 eingezogen. Termine = Richtwerte.

### Phase 0 — 14.–25.07.2026: Fundament

Projekt-Setup, Prisma-Datenmodell (Person-Core + Mehrfachrollen + Status-State-Machine), Auth (Magic-Link gehärtet + JWT), Rechte-Matrix als DB-Datensatz, Audit-Log-Gerüst, Docker-Instanz.

*Ergebnis:* Lauffähiges Gerüst mit Login, Rollen, Navigation.

### Phase 1 — 28.07.–29.08.2026: MVP: Verwalten · Anmelden · Kommunizieren (M1+M2+M3)

Teilnehmerkartei, Formular-Builder + öffentliches Formular + Genehmigungs-Pipeline, Referenz-/Pastoren-Workflow, Art.9-Consent + Löschkonzept, E-Mail-Modul mit SMTP/Test-Versand, SPF/DKIM/DMARC. Alle P0-Blocker enthalten.

*Ergebnis:* Anmeldeprozess produktiv, MS-Forms abgelöst — vor Kursstart.

### Kursstart — 15.09.2026: Jahrgang 2026–29 startet

Bestandsdaten-Migration laufender Jahrgänge aus Teams (Bulk-Import P1); minimale Anwesenheitserfassung für den ersten Abend.

*Ergebnis:* Betrieb läuft parallel weiter.

### Phase 2 — Sep–Okt 2026: Finanzen & Offenheit (M4+M5)

REST-API + Keys/Webhooks, n8n-Optigem-OP-Sync, Finanz-Dashboard mit Ampel, Raten-/Ehepartner-Logik, gestaffeltes Dunning, IDOR-/Row-Level-Scoping gehärtet.

*Ergebnis:* Offene Beiträge live, System integrierbar.

### Phase 3 — Okt–Nov 2026: Portal · Material · Leistung (M9+M7+M6)

Teilnehmerportal, Materialplattform mit Audio-Player (Range/Offline), Kursraum + Ankündigungen, Anwesenheit + Entschuldigungs-Workflow, Lektüre-Selbstbestätigung.

*Ergebnis:* Teams wird abgeschaltet.

### Phase 4 — Nov–Dez 2026: Online-Prüfungen (M8)

Prüfungs-Editor, Fragenkatalog, Auto-Auswertung, Rubric + Freitext, Release-Fluss mit Benachrichtigung, Ollama-Vorbewertung optional, Offline-Härtung.

*Ergebnis:* Prüfungen digital, Auswertung überwiegend automatisch.

### Phase 5 — 2027+: Feinschliff & Optionen

Kohorten-Reporting/Early-Alert, Vertretungsregeln, Monitoring/Health-Checks, Admin-2FA, Barrierefreiheits-Feinschliff. Zertifikat-PDF zum ersten Abschluss 2029.

*Ergebnis:* Komfort nach Praxiserfahrung.

## 12 · Offene To-dos & externe Abhängigkeiten

- **[Extern · P0] SMTP-Domain + DNS** — Absender-Postfach festlegen, SPF/DKIM/DMARC einrichten (mit IT/DNS). Ohne saubere Auth landen Magic-Links und Prozess-Mails im Spam. Voraussetzung für Phase 1.
- **[Extern · P1] Optigem-Mandant & Debitoren** — Mit der Buchhaltung: Mandant klären, Abo-Artikel „Semesterbeitrag“ je Teilnehmer anlegen. Prüfen: liefert Optigem Saldo UND Fälligkeit je Rechnung? Voraussetzung für Phase 2.
- **[Extern · P1] Bestandsdaten aus Teams** — Laufende Jahrgänge mit Anwesenheit/Leistung/Semesterstand exportieren — Grundlage für den einmaligen Bulk-Import zum Go-Live.
- **[Klärung · P2] Andacht/Chapel** — Ist eine Andacht-Quote abschlussrelevant und wer hakt sie ab? Als eigener Termintyp konfigurierbar vorgesehen.
- **[Klärung · P2] Glaubensbekenntnis-Version** — Aktuellen Text (versioniert, Art.9-Zustimmung) bereitstellen.

---

*Erstellt 12.07.2026 auf Basis von Softwarekonzept v1, den Anforderungen des Schulleiters und einer Multi-Agenten-Deep-Research mit den größten US-Bibelschulen/Seminaren als Benchmark. Ampel- und Prioritätsangaben sind Planungsempfehlungen.*

---

## 13 · Kritiker-Panel: Pushback & Prozess-Erweiterungen (v2)

> Ergänzt 12.07.2026. Ein 7-fach-Kritiker-Panel (Bibelschul-Kenner, Studienbüro/Registrar, Datenschutz, Ehrenamts-Betrieb, Lebenszyklus-Randfälle, Vereinsfinanzen, Gemeinde-/Öffentlichkeitsarbeit) plus Kenner-Gegenprobe hat die Prozesslandschaft adversariell zerlegt. Die Punkte sind in `1_Prozesslandschaft.html` (v2) und `4_Umsetzungsplan.html` (39 Arbeitspakete) eingearbeitet.

### Kernurteil (der „native smell“)

> Man merkt es an der Grammatik der Prozesslandschaft: Der Teilnehmer wird als Kunde durch einen Trichter geschoben — Interesse → Anmeldung → Unterricht → Prüfung → Zeugnis → Abschluss (Statuswechsel) — und gemessen wird, was zählbar ist: Anwesenheit abhaken, Note locken, Retention als KPI, Risiko als Ampel. Eine Gemeindebibelschule ist aber keine Volkshochschule mit Frömmigkeits-Modulen, sondern eine dreijährige Weggemeinschaft: Zugehörigkeit, Formung, Berufung, Aussendung — und getragen von 6 Gemeinden, deren Lehr-Einheit und deren gemeinsame Feier das Ganze erst zusammenhalten. Die verräterischen Stellen: alles ist auf den Abschluss-Track gepolt (kein Hörer denkbar), Gemeinschaft und das gemeinsame Essen sind unsichtbar, der Abschluss ist ein Flag statt ein Segnungsgottesdienst, und wer verschwindet, löst eine Risikoliste aus statt ein 'wir gehen ihm nach'. Gegenmittel: neben die administrative Achse eine zweite, geistlich-relationale 'Weg'-Achse legen (Zugehörigkeit, Begleitung, Berufung, Sendung, Trägergemeinschaft) — und die pastorale, feiernde, nachgehende Reaktion Aktionen auslösen lassen, statt KPIs Alarme auslösen zu lassen.


**Verdikt des Panels:** Die Prozesslandschaft ist ein gutes Verwaltungs-Gerüst mit klugem Scoping, aber sie modelliert derzeit einen VHS-Trichter, keine dreijährige Weggemeinschaft von 6 Trägergemeinden - und sie ist am Happy-Path zu naiv, um live tragfähig zu sein. Als Erstes gehören die drei strukturellen Wurzeln gebaut, weil sie ein Dutzend Folgeprozesse erst korrekt machen: (1) die explizite Status-Maschine mit Pause-/Terminal- und Hörer-Zuständen, (2) das Modell Zahlungspflichtiger ungleich Teilnehmer, (3) der fach-granulare Fortschritt statt Semester-Pass/Fail. Parallel und nicht verhandelbar: die versionierte Lehrgrundlage der 6 Träger (das trägerschafts-existenzielle Risiko), die zweite geistlich-relationale Achse (Mentoring + Dienstnachweis als echter K-Prozess), sowie die Governance-Basics (Beitrag/Spende-Trennung, DSAR-/Break-Glass-Routinen). Zurückstellen: Prüfungs-Engine, REST-API und Retention-Analytics - phasenweise GoLive mit Teams als Fallback, sonst optimiert das Produkt sauber den falschen Kern.

### Die drei strukturellen Wurzeln (zuerst bauen)

1. **Explizite Status-Maschine** mit Pause-/Terminal-/Hörer-Zuständen (ruhend/beurlaubt/abgebrochen/ausgeschlossen/verstorben/Hörer) — sonst feuern Beitrag, Dunning, Anwesenheit und Auto-Mails auf Aussteiger, Trauernde, Pausierende. Von 4 Blickwinkeln unabhängig gefordert.
2. **Zahlungspflichtiger ≠ Teilnehmer** — Fremdzahler (Gemeinde/Sponsor) und Ehepaar-Kopplung (auflösbar). Sonst peinliche Mahnungen an die Falschen.
3. **Fach-granularer Fortschritt** statt Semester-Pass/Fail — Grundlage für Nachschreib, Teilabschluss, Anerkennung.

### Wichtigste fehlende Prozesse (dedupliziert, nach Schwere)

| Lücke | Schwere | Wo | Empfehlung |
|---|---|---|---|
| **Explizite Status-Maschine mit Pause- und Terminalzuständen** — Die ganze Kette kennt fast nur Erfolgs-/Weiter-Zustände (K11 Aktiv->Absolvent). Die realen Nicht-Happy-Zustände - ruhend/beurlaubt, abgebrochen/exmatrikuliert, ausgeschlossen, verstorben - fehlen als erstklassige Status. Folge: bei jedem Ausnahmefall müssen Beitragslauf, Dunning, Anwesenheits-Uhr, Auto-Mails und Reporting einzeln von Hand abgestellt werden - und genau eins wird vergessen. Der peinlichste konkrete Fall: automatische Mahnung oder Re-Enrollment-Erinnerung an Hinterbliebene eines Verstorbenen. Das ist der strukturelle Unterbau, an dem Beurlaubung, Storno, Retention-Wahrheit und Dunning-Stopp gemeinsam hängen. | 🔴 hoch | NEU (quer zu K11/K12, U2, K6, F3) - unterlegt die bestehenden Prozesse | 6-7 explizite Status einführen, an die Beitragslauf, Dunning, Anwesenheits-Ampel, Auto-Mails und Reporting ALLE andocken. 'Beurlaubt' pausiert Beitrag+Dunning+Anwesenheits-Soll (mit Von/Bis + Grund, Schulleiter genehmigt). 'Verstorben' und 'Ausgeschlossen' sind harte Not-Aus für jede Automatik. 'Abgebrochen' stoppt atomar künftigen Beitrag/Terminplan, markiert Optigem-Debitor inaktiv (n8n) und startet die Retention-Uhr. Kein Uni-Overkill - eine kleine Zustandsmaschine reicht. |
| **Verbindliche Lehrgrundlage der 6 Träger + Doktrin-Meldeweg + Dozenten-Verpflichtung** — 6 freikirchliche Trägergemeinden = 6 dogmatische Akzente (Taufe, Geistesgaben, Endzeit, Ämter). Das ist die eingebaute Sprengladung. Es gibt keinen versionierten Bekenntnis-/Lehrrahmen, keine schriftliche Verpflichtung der Dozenten darauf, und keinen Kanal, wenn ein Dozent oder Teilnehmer abweichend lehrt. Kein anderes Risiko kann die Trägerschaft so schnell zerlegen - und keine Rechte-Matrix fängt es auf. | 🔴 hoch | NEU + Erweiterung K3 (Onboarding-Bestätigung), F5 (Dozenten-Verpflichtung) | (1) Eine vom Trägerkreis freigegebene, versionierte Lehrgrundlage/Statement of Faith mit klarer 'in Wesentlichem Einheit, im Übrigen Freiheit'-Regel; Dozenten UND Teilnehmer bestätigen sie einmalig beim Onboarding (Audit). (2) Ein einfacher, nicht-öffentlicher Lehr-/Anliegen-Meldeweg an den Schulleiter - kein Forum, kein Ticketsystem -, damit Bedenken kanalisiert statt über Flurfunk zwischen Gemeinden ausgetragen werden. |
| **Geistliche Formung als eigener Kernprozess: Mentoring + praktischer Dienstnachweis** — Die Landschaft kennt Dozent, Prüfung und Anwesenheit - aber keinen Menschen, der den Teilnehmer über 3 Jahre begleitet, und keine praktische Dienstübung mit Rückmeldung. Reife passiert im Zweiergespräch und beim ersten selbst gehaltenen Andacht/Predigt, nicht im Hörsaal. Ohne diese Achse ist GBS Campus ein Teams-Ersatz mit Notenbuch. Kein einziger der Kernprozesse K1-K12 berührt Formung - das, was die Schule von einer Weiterbildung unterscheidet, steht komplett außerhalb des Kerns. | 🔴 hoch | NEU (als K-Prozess neben den Verwaltungs-Lebenszyklus, nicht als Nice-to-have) | Leichtgewichtig: (1) Mentoring - Zuordnung Teilnehmer<->Mentor (oft der entsendende Pastor/ein Dozent), 1-2 Gespräche je Semester, vertrauliche Notiz nur für Mentor+Schulleiter, 'Gespräch stattgefunden'-Häkchen als weiche Clearance neben den 80%. (2) Dienstnachweis - pro Jahr 1-2 praktische Einheiten (Andacht/Predigt/Leitung) mit kurzem Feedback-Bogen des Heimat-Ältesten. Als eigene Clearance-Säule, NICHT in die Prüfungs-Engine reinquetschen. |
| **Fach-granularer Fortschritt statt Semester-Pass/Fail (+ Nachschreib, Teilabschluss, Anerkennung)** — Das Modell ist strikt kohorten-lockstep mit Pass/Fail pro Semester. Real besteht jemand 6 von 7 Fächern und muss NUR eins wiederholen; jemand ist am einzigen Prüfungsabend krank; ein Quereinsteiger will Fächer anerkannt bekommen; ein Abbrecher braucht einen Nachweis, WELCHE Fächer er hat. All das ist auf Semester-Ebene unmöglich abbildbar. Das ist die strukturelle Wurzel, an der Nachschreibprüfung, Teilabschluss und Anerkennung gemeinsam hängen. | 🔴 hoch | K7/K9 (Bewertungs-Unterbau), K10 (Teilabschluss-Vorlage) | Fortschritt pro Teilnehmer x Fach speichern (bestanden/offen/anerkannt/nicht bestanden), Semester-/Graduation-Clearance daraus aggregieren. Prüfungs-Status um 'nicht angetreten'/'nicht bestanden' erweitern; Re-Open mit neuem Termin + Versuchszähler statt zweitem Editor. Ein schlanker 'Anerkennung'-Eintrag (Häkchen + Begründung + Audit) deckt Quereinstieg ab. Teilabschluss-Bescheinigung als eine weitere K10-Vorlage - kein Credit-Transfer-System. |
| **Fortlaufende Gemeinde-Standing-Bestätigung + Zwei-Wege-Kommunikation mit dem Pastor** — Die Pastoren-/Charakter-Referenz (K3) ist ein einmaliges Zulassungs-Tor. Aber Gemeindestand und Charakter sind kein Zustand, den man einmal besteht: Austritt, Gemeindezucht, zerbrochene Ehe im 2. Jahr - der Teilnehmer läuft trotzdem Richtung Urkunde. Zugleich bekommt die entsendende Gemeinde, die ihn schickte und mitfinanziert, nach der Zulassung NIE wieder etwas zu hören - das Gate nimmt nur, gibt nie zurück und brennt die Pastoren aus, aus deren Gemeinden der nächste Jahrgang kommt. | 🔴 hoch | K12 (Standing-Abgleich), Erweiterung K3/U1 (Rückkanal), Gemeindefeld mit Historie | An den ohnehin geplanten Re-Enrollment-Schritt (K12) je Jahr eine Ein-Klick-Bestätigung der Heimatgemeinde koppeln ('X steht weiter in gutem Stand?' Ja/Nein/Rücksprache) plus Abgleich 'Pastor/Gemeinde unverändert?'. Bei Nein -> stiller Flag an Schulleiter, kein Automatik-Ausschluss. Getrennt davon ein granularer Consent 'Mein Pastor darf über meinen Studienstand informiert werden' -> 1x/Semester Kurz-Ampel + Anlass-Trigger bei Rot/Abbruch/Abschluss. Kein Dashboard-Zugang für Pastoren. |
| **Zahlungspflichtiger/Rechnungsempfänger getrennt vom Teilnehmer (Fremdzahler + Ehepaar)** — K4 legt Optigem-Debitor 1:1 zum Teilnehmer an - das setzt naiv voraus: Zahler=Teilnehmer. Bricht sofort, wenn eine Trägergemeinde den Beitrag für ihren Mann übernimmt (sehr häufig) oder ein Ehepaar über EIN Konto/EINE Mail läuft. Folge: peinliche Mahnungen an Leute, die selbst nie zahlen sollten, und bei Trennung ist ein Partner über ein fremdes Konto abgebucht und per totem Postfach ausgesperrt. | 🔴 hoch | K4 (Debitor-Anlage), U2 (Ampel/Mahnlauf), K2 (Ehepaar-Kopplung) | Zahlungspflichtiger als eigenes Feld getrennt vom Teilnehmer; Ampel und Mahnlauf richten sich nach dem Zahlungspflichtigen. Ein Sponsor/Gemeinde kann mehrere Teilnehmer tragen (Sammel-Sollstellung). Aktion 'Ehepaar-Kopplung auflösen' mit getrennten Logins/Konten/Sichtbarkeit ab Stichtag. Debitor-Modell explizit festlegen, BEVOR K4 gebaut wird. |
| **Hörer-/Gasthörerstatus - Teilnahme ohne Leistungsnachweis** — Die gesamte Kette unterstellt, dass jeder auf die Graduation zusteuert. In jeder realen Abendbibelschule sitzen aber Menschen im Raum, die NICHT den Abschluss anstreben: der mitkommende Ehepartner, das sich nährende Gemeindeglied, der Rentner, der ein Fach hört. Für sie erzeugt das System falsche Ampeln, unnötige Mahnungen und leere Zeugnis-Serienläufe. Das Selbstverständlichste überhaupt - und kein einziger der 7 Kritiker hat es gesehen. | 🔴 hoch | NEU (Status in der Status-Maschine), K2/K6/K7/K10 | Sauberer Status 'Hörer/Gast': mitschreiben ja, Prüfung/80%-Zwang/Zeugnisdruck nein, ggf. eigener (reduzierter) Beitrag. Nur ein weiterer Status in der oben geforderten Status-Maschine plus ein Flag im Beitrags-/Clearance-Regelwerk - minimaler Bau, großer Realitäts-Gewinn. |
| **Compliance als fristgetrackte Betriebsroutinen: DSAR-Uhr + Datenpanne-72h + Löschläufe** — F4 ist EIN Kasten und U6 eine Tool-Sammlung - kein Fall, keine Frist, kein Owner. In der Praxis kommt die Auskunftsanfrage per Mail an den ehrenamtlichen Schulleiter, versandet zwei Wochen, und die Art.12-Monatsfrist läuft ab. Datenpannen-Meldung (Art.33/34, 72h) fehlt komplett - bei durchgängigen Religions- und Bankdaten sofort meldepflichtig. Interessenten (K1) und abgelehnte Bewerber inkl. sensibler Referenz (K3) liegen ohne Löschregel jahrelang herum - genau die Kategorie, die eine Aufsichtsprüfung zuerst findet. | 🔴 hoch | F4 in mehrere Routinen zerlegen; U6-Tools an Fall-Objekte koppeln | In benannte Routinen mit Auslöser und Frist zerlegen: DSAR-Ticket (Typ, Eingang, auto +1 Monat, Erinnerung T-7); Datenpanne-Workflow (Schweregrad -> 72h-Countdown -> vorformuliertes LDI-NRW-Template); Löschlauf als Cron (Interessenten 6-12 Mon., abgelehnte Bewerber X Mon.); VVT als editierbare Tabelle (Optigem/n8n als Empfänger); Consent-Version mit Re-Consent-Prompt. Die U6-Tools hängen als Aktionen AM Fall, statt frei zu schweben. Eine Seite pro Routine, kein ISMS. |
| **Break-Glass-Admin / Credential-Escrow + Betriebs-Runbook (Bus-Faktor 1)** — Ein einziger Entwickler hält Server-Root, Domain, DB, S3, JWT-/Encryption-Keys und den n8n-Optigem-Key. Fällt er aus (Urlaub, Krankheit, Streit, Tod), kann niemand die Schule betreiben, kein Zeugnis drucken, keinen Login reparieren - und niemand kommt an die verschlüsselten Daten. Monitoring nützt nichts, wenn nur er den Alarm versteht. Das operative Wissen für die 8-10 Jahresroutinen (Rollover, Massendruck) steckt allein in seinem Kopf. | 🔴 hoch | NEU (Betriebs-/Governance-Ebene, quer zu allen U-Prozessen) | Versiegelter Notfall-Passworttresor (z.B. Vaultwarden) mit ALLEN Zugängen bei Schulleiter + 1 Vertrauensperson; dokumentierter Break-Glass-Ablauf; Encryption-Key-Recovery einmal echt getestet. Knappes, bebildertes Betriebshandbuch (10-15 S., lebende PDF) für die wiederkehrenden Abläufe. Einmal jährlich eine 'Dev ist weg'-Trockenübung: Zeugnis erzeugen und Login reparieren ohne ihn. |
| **Beitrag vs. Spende sauber trennen (Gemeinnützigkeits-Haftung)** — Der Semesterbeitrag ist Entgelt für eine Leistung - dafür darf NIEMALS eine Zuwendungsbescheinigung ausgestellt werden. Teilnehmer wollen aber 'die 120 EUR absetzen', zahlen aufgerundet, oder eine Gemeinde überweist Beitrag+Spende in einem Betrag. Erzeugt die Software einen Beleg, der wie eine Zuwendungsbescheinigung aussieht, ist das ein Gemeinnützigkeits-GAU mit Vorstandshaftung. Die Landschaft erwähnt die Unterscheidung mit keinem Wort. | 🔴 hoch | U2 (Zahlungsposition-Typ, Beleg-Vorlage), K10 (Quittungs-Vorlage) | Jede Zahlungsposition eindeutig als Typ 'Beitrag' oder 'Spende' führen. Software stellt für Beiträge ausdrücklich nur eine 'Zahlungsbestätigung/Beitragsquittung' aus, klar KEINE Zuwendungsbescheinigung (die bleiben bei Optigem/Vorstand). Überzahlung nie automatisch als Spende umdeklarieren - das entscheidet ein Mensch. Dazu ein simpler Soll/Ist-Report (erwartete Beiträge minus Rabatte/Erlasse/Fremdzahler vs. Optigem-Eingänge) für Kassenprüfer/Beirat. |
| **Härtefall-/Ermessens-Override (Gnade bei 80%, Fristen, Mahnung)** — Die 80%-Anwesenheit, Prüfungs-/Abgabefristen und das Mahnwesen sind als harte Regeln modelliert. Real: Todesfall, Langzeitkrankheit, und jemand landet bei 75% oder in einer Seelsorge-Situation. Eine ehrenamtlich getragene Gemeindeschule WILL Gnade üben können - aber es fehlt der dokumentierte, nachvollziehbare Ermessensweg. Ohne ihn wird entweder stur die Ampel befolgt (unfair) oder informell/undokumentiert übersteuert (Willkür-Vorwurf, kein Audit). | 🟡 mittel | NEU (quer zu K6, K8, F2, U2) | Ein Härtefall-/Ausnahme-Flag, das nur der Schulleiter setzen kann, mit Pflicht-Begründung und optionaler Auflage (Ersatzleistung). Überschreibt gezielt die 80%-Clearance, eine Frist oder eine Mahn-Eskalation für diesen einen Teilnehmer, für alle sichtbar im Audit-Log. Die rote Ampel ist der Trigger, nicht das Ende - sie muss eine definierte Konsequenz/Remediation auslösen. |
| **Aktive Alumni-Pflege: Verbleib/Dienst-Vermittlung + Aussendungs-/Abschlussgottesdienst** — K11 behandelt den Abschluss als Statuswechsel + Alumni-Tag - ein Datenbank-Flag. Der eigentliche ERTRAG der 3 Jahre ist aber, wo die Absolventen dienen (die Frucht-Kennzahl, die den 6 Gemeinden zeigt, wofür ihre Beiträge und Leute gut waren), und der Abschluss selbst ist in Wirklichkeit ein Aussendungsgottesdienst mit Segnung, den entsendenden Pastoren und allen Gemeinden - nicht der Nachlauf zum Zeugnisdruck. Ein bloßer Tag wirft beides weg. | 🟡 mittel | K11 (Verbleib-Feld + Aussendungs-Event), F3 (Frucht-Kennzahl), U1 (Alumni-Verteiler) | Beim Statuswechsel ein minimales Verbleib-Feld (Dienst/Gemeinde, 1x/Jahr Selbstauskunft) für den Trägerbericht (F3); einfache Bedarfsmeldung der Gemeinden als Aushang für den Schulleiter (manuelle Vermittlung, keine Matching-Automatik); Alumni-Rundbrief mit Opt-in (Rechtsgrundlage!) über U1. Den Abschluss als eigenen Organisations-/Einladungsprozess (Termin, Programm, Gäste, Foto-Consent, Urkundenübergabe live) modellieren, nicht als Flag. |
| **Native Bibelschul-Formate & Aufnahme-Substanz (Info-Abend, Rüstzeit, Kinderbetreuung, Glaubenszeugnis)** — Das Datenmodell kennt nur '10 Dienstagabende/Semester' und misst bei der Aufnahme Bankdaten und Fremd-Referenz. Es fehlen: der Info-/Schnupperabend als Konversionsschritt (fast niemand verpflichtet sich für 3 Jahre allein per Web-Formular); die jährliche Rüstzeit/Studienfahrt (das Format, in dem aus der Kursgruppe eine Weggemeinschaft wird - mit eigenen Kosten); Kinderbetreuung am Abend (ohne sie kommen die jungen Familien nicht - genau die Zielgruppe); und das persönliche Glaubens-/Taufzeugnis + verbindliche Gemeindezugehörigkeit als eigentliche Aufnahmefrage. | 🟡 mittel | NEU zwischen K1/K2 (Info-Abend), K5/Termine (Rüstzeit), K2 (Aufnahme-Substanz + Kinderbetreuung) | Alles leichtgewichtig: Info-Abend als Event-Objekt (Einladung via U1, 'war da', Ein-Klick 'zur Bewerbung'). Rüstzeit als Termin außerhalb des Dienstag-Rasters mit An-/Abmeldung + eigenem Kostenpunkt. Kinderbetreuung als Anmelde-Häkchen + Betreuungs-Beitrag (Aufsichts-/Minderjährigen-Datenschutz beachten). Glaubens-/Taufzeugnis + Gemeindeglied-Status als Felder im Bewerbungs-Flow (K2) - wichtiger als jede IBAN. |

### Die schärfsten Pushbacks (gegen das, was drinstand)

- **U2 - gestaffeltes automatisches Dunning/Mahnwesen** — Automatisch eskalierende 2./3. Mahnstufen an Geschwister aus 6 Gemeinden über 120 EUR sind im Gemeindekontext beziehungsschädigend und pastoral falsch - eine Mahnmail an jemanden, dessen Ehepartner gerade gestorben ist oder der finanziell klamm ist, verbrennt Vertrauen, das man sonntags wiedersieht. Der Schulleiter wird die Automatik ohnehin ständig manuell übersteuern; dann ist sie keine Entlastung, sondern eine Fehlerquelle, die peinliche Mahnungen rausschickt, bevor jemand eingreift. (Konsens Betrieb + Finanzbuchhalter, beide hoch.) → *Besser:* Vom Push- auf ein Vorschlags-Modell umstellen: Software erzeugt eine Mahn-Vorschlagsliste, ein Mensch gibt frei. Ein setzbarer Härtefall-/Seelsorge-Stopp muss den Lauf hart blockieren können. Optigem macht das Formale. Lieber ein Klick mehr als eine Mahnung an den Falschen.
- **K12 - Wiedereinschreibung als reibungsloser 'Ein-Klick-Bestätigen'-Schritt** — Die Semester-Wiedereinschreibung ist genau der EINE wiederkehrende Moment, an dem alle Ausnahmen zusammenlaufen: nicht bezahlt, Vorsemester nicht bestanden, unter 80%, will pausieren, Guthaben offen, Gemeinde gewechselt. Als glatter Klick modelliert, gated das System die Progression nie - jeder rutscht automatisch weiter, egal in welchem Zustand. (Konsens Registrar + Lebenszyklus-Randfälle.) → *Besser:* Re-Enrollment als Clearance-Gate mit Verzweigung bauen: prüft Zahlung (U2), Vorsemester-Bestehen (K9), Anwesenheit (K6). Grün = Ein-Klick (bleibt der Normalfall). Rot = definierter Ausnahmepfad (Härtefall, Wiederholung, Beurlaubung, Ratenplan, Anrechnung) an den Schulleiter. Der Klick bleibt, ist aber nicht mehr der einzige Zweig.
- **F2/K9 - 'Bestanden' aus 80% + Prüfungen als alleinige Graduation-Clearance** — Hier wird stillschweigend 'bestanden' mit 'für den Dienst geeignet' gleichgesetzt. Für eine Dienst-Vorbereitungsschule ist das gefährlich: Man kann jede Klausur bestehen und trotzdem charakterlich oder in der Lehre nicht tragfähig sein. Eine reine Academic-Clearance produziert zertifizierte, aber ungeprüfte Absolventen. (Geistliche Formung, Kern-Pushback.) → *Besser:* Clearance zweispurig denken: akademisch (Prüfungen/Anwesenheit, automatisierbar) UND geistlich (Mentoring stattgefunden, Dienstnachweis erbracht, Gemeindestand bestätigt - qualitativ, vom Schulleiter freigegeben). Die Abschlussurkunde bezeugt Teilnahme/Wissen; eine getrennte, optionale Dienst-Empfehlung bezeugt Reife. Nie beides vermischen.
- **F4 Compliance als EIN Führungsprozess + U6 'DSGVO-Werkzeuge' als Tool-Sammlung** — Compliance ist kein Prozess, sondern ein Bündel wiederkehrender Routinen mit unterschiedlichen Auslösern, Fristen und Ownern. Als ein Kasten wird faktisch keine davon je getriggert - ein Sammelbecken, in dem nominell alles 'drin' ist und real nichts läuft. Werkzeuge ohne fristgetrackten Fall erzeugen Scheinsicherheit ('wir haben doch die Tools'). (Datenschutz-Lens, zwei hoch-Pushbacks.) → *Besser:* In benannte Routinen mit Kadenz und Owner zerlegen (DSAR ad hoc/Monatsfrist, Datenpanne <72h, VVT jährlich, Löschlauf quartalsweise, AV-/TOM-Review jährlich). Jedes U6-Werkzeug an ein Fall-/Ticket-Objekt mit Frist und Protokoll koppeln - das Tool ist die Aktion AM Fall, nie der Prozess selbst.
- **F3 - Retention-KPIs / Early-Alert-Risikoliste aus Anwesenheits-Ampel und Noten** — Falsche Altitude: Das ist Uni-/Learning-Analytics-Sprache für eine kleine ehrenamtliche Erwachsenenschule. Der Teilnehmer, der wirklich in Gefahr ist, hat oft 100% Anwesenheit und driftet geistlich weg (Ehekrise, Zweifel, Gemeindekonflikt) - die Ampel leuchtet grün, während der Mensch innerlich schon gegangen ist. Ohne Ruhend-Status erscheinen zudem Beurlaubte/Kranke als 'Risiko' und verfälschen die Zahlen an den Beirat. (Konsens Geistliche Formung + Betrieb + Lebenszyklus.) → *Besser:* Early-Alert um einen pastoralen Flag ergänzen, den Mentor/Schulleiter manuell setzen kann ('braucht Zuwendung'), gleichberechtigt neben den harten Zahlen. Beurlaubte aus den Metriken herausrechnen. Im Zweifel die banale Regel statt Dashboard: '2x unentschuldigt gefehlt -> Schulleiter ruft an'.
- **U2 - 'Ehepartner -50%' als fest verdrahteter, einmal gesetzter Rabatt-Flag** — Erstens verstößt ein hartcodierter Rabatt gegen eure eigene CLAUDE.md-Regel (Vorlagen/Regeln admin-editierbar, nie hardcoded). Zweitens denkt er zu klein: Ehepartner-Rabatt ist nur EIN Fall von Beitragsermäßigung (morgen Geschwister-Rabatt, Erlass, Sponsor). Drittens ist er an einen veränderlichen Beziehungsstatus gekoppelt, wird aber als einmaliges Flag behandelt - Trennung/Scheidung/früherer Abschluss eines Partners rechnet über 6 Semester still falsch. (Konsens Registrar + Lebenszyklus + Finanzbuchhalter.) → *Besser:* Alle Beitragsabweichungen (Ehepartner, Härtefall, Sponsor, Storno, Hörer) über EIN admin-pflegbares Ermäßigungs-/Beitragsschema abbilden; Ehepartner-50% ist ein konfigurierter Rabatt-Typ. Pro Semester/pro Person beim Beitragslauf/Re-Enrollment neu bewerten, nicht einmalig setzen.
- **Gesamt-Zuschnitt: Big-Bang-Ablösung von Teams durch einen Solo-Dev + vollwertige REST-API (U4) + volle Prüfungs-Engine (K7)** — Scope- und Termin-Naivität: K1-K12 plus U1-U7 gleichzeitig live an Tag 1 mit Jahrgangsstart und Bus-Faktor 1 ist ein Alles-oder-nichts-Risiko am schlechtestmöglichen Tag. Eine general-purpose API mit Key-/Scope-Verwaltung ist für 60 Personen spekulativer Overhead (einzige reale Integration: n8n<->Optigem), und eine Online-Klausur-Engine mit Auto-Grading für 10 Abende/Semester ist schwer und wartungsintensiv, wo die Prüfung real oft mündlich/Essay ist. (Betriebs-Realist, mehrere Pushbacks; YAGNI.) → *Besser:* Phasen-GoLive: zuerst nur, was ein Dienstagabend braucht (Login, Material, Ankündigungen, Anwesenheit, E-Mail), Teams ein Semester als Fallback parallel. Prüfung erst als Aufgaben-Upload + manuelles Pass/Fail, Auto-Grading nur bei nachgewiesenem Bedarf. Kein API-Produkt - genau den einen n8n-Webhook umsetzen, den Optigem braucht. Audio dumm halten (Download/Link statt Streaming-Infra).

### Vom Kenner zusätzlich aufgedeckt (Selbstverständlichkeiten)

- 🔴 hoch **Hörer-/Gasthörerstatus — Teilnahme ohne Leistungsnachweis** — Die gesamte Kernprozesskette K1–K12 unterstellt, dass jeder auf die Graduation zusteuert (Prüfung, Note, Clearance, Urkunde). In jeder realen Abendbibelschule sitzen aber Menschen im Raum, die NICHT den Abschluss anstreben: der Ehepartner, der mitkommt; das Gemeindeglied, das sich nähren lassen will; der Rentner, der ein Fach hört. Für sie braucht es einen sauberen Status 'Hörer' (mitschreiben ja, Prüfung/80%-Zwang/Zeugnisdruck nein, ggf. eigener Beitrag) — sonst produziert das System für ein Drittel der Anwesenden falsche Ampeln, Mahnungen und leere Zeugnis-Serienläufe. Kein Kritiker hat das erwähnt; es ist das Selbstverständlichste überhaupt.
- 🔴 hoch **Lehrgrundlage-Harmonisierung der 6 Trägergemeinden + Verpflichtung der Dozenten auf das Bekenntnis** — Kritiker 1 sah nur Lehrabweichung bei TEILNEHMERN. Der eigentliche Zündstoff sitzt oben: 6 freikirchliche Gemeinden lehren nicht deckungsgleich (Taufe, Geistesgaben, Endzeit, Frauendienst). Wer legt fest, was in Dogmatik/Ekklesiologie gelehrt werden DARF, wie mit Streitfragen umgegangen wird ('in Wesentlichem Einheit, im Übrigen Freiheit'), und wie jeder Dozent vor seinem ersten Abend schriftlich auf diese Lehrgrundlage verpflichtet wird? Ohne diesen Prozess zerlegt der erste Streit über die Geistestaufe die Trägergemeinschaft — und keine Software-Rechte-Matrix fängt das auf.
- 🟡 mittel **Aussendungs-/Abschluss-Gottesdienst als geistliche Feier mit den Trägergemeinden** — K11 modelliert den Abschluss als 'Statuswechsel Aktiv→Absolvent + Alumni-Tag' — ein Datenbank-Flag. In Wirklichkeit ist der Abschluss 2029 ein Aussendungsgottesdienst: Segnung/Handauflegung, die entsendenden Pastoren vorne, Familien, Festprogramm, Einladungen an alle 6 Gemeinden, gemeinsame Feier. Das ist ein eigener Organisations- und Einladungsprozess (Termin, Programm, Gäste, Fotografie-Consent, Urkundenübergabe LIVE), nicht der Nachlauf zum Zeugnisdruck. Ein Kenner merkt sofort, dass hier das Herzstück des Jahrgangs fehlt.
- 🟡 mittel **Rüstzeit / Studienfahrt / Wochenend-Retreat — Gemeinschaft jenseits der 10 Dienstagabende** — Das ganze Datenmodell kennt nur '10 Dienstagabende/Semester'. Fast jede Bibelschule hat pro Jahr mindestens eine Wochenend-Rüstzeit, einen Studientag oder eine Fahrt — das intensive Gemeinschaftsformat, in dem aus einer Kursgruppe eine 3-Jahres-Weggemeinschaft wird. Dafür braucht es An-/Abmeldung, Kosten (nicht im 120€-Beitrag), Unterbringung, ggf. Anrechnung auf Anwesenheit. Fehlt komplett und lässt sich mit dem starren Dienstagabend-Terminraster gar nicht abbilden.
- 🟡 mittel **Kinderbetreuung während des Abends** — Berufsbegleitende Erwachsene mit jungen Familien am Dienstagabend — ohne Kinderbetreuung kommen die jungen Eltern schlicht nicht, und genau die sind die Zielgruppe. Wer betreut, wer meldet Kinder an, gibt es einen Betreuungs-Beitrag, Aufsichts-/Datenschutzfragen für Minderjährige? Das ist kein Nice-to-have, sondern entscheidet über die Anwesenheit einer ganzen Teilnehmergruppe. Ein Techniker sieht 'Teilnehmer = Erwachsener' und übersieht die Kinder im Nebenraum.
- 🟡 mittel **Glaubens-/Taufzeugnis und Gemeindeglied-Status als Substanz der Aufnahme** — K2/K3 erfassen Bankdaten (verschlüsselt), Consent und die Pastoren-REFERENZ über den Bewerber. Die eigentliche Aufnahmefrage einer Bibelschule fehlt aber: das persönliche Glaubens-/Bekehrungszeugnis des Bewerbers, Taufe (wann/wo), aktive Gemeindezugehörigkeit. Für eine Gemeindebibelschule ist 'Bist du wiedergeboren, getauft, in einer Gemeinde verbindlich?' wichtiger als jede IBAN — und das ist nicht dasselbe wie die Fremd-Referenz des Pastors.
- 🔵 niedrig **Dozenten-Aufwand: Fahrtkosten-/Honorarerfassung** — Die Finanzsicht (U2) und selbst der Buchhalter-Kritiker schauen nur auf den Geldfluss VOM Teilnehmer. Dozenten sind aber oft ehrenamtliche Älteste/Pastoren, die aus anderen Städten anreisen und Fahrtkostenerstattung oder eine Aufwandsentschädigung bekommen. Dieser Geldfluss ZUM Dozenten (Erfassung, Beleg, Übergabe an Optigem) ist ein realer, wiederkehrender Prozess, der nirgends auftaucht — und gemeinnützigkeitsrechtlich (Ehrenamtspauschale) sauber laufen muss.

### Was schon richtig gut ist

- 'Optigem bleibt führend, die Software bucht nichts' ist goldrichtig und wurde von 4 Kritikern (Datenschutz, Betrieb, Finanzbuchhalter, Öffentlichkeitsarbeit) unabhängig gelobt: die Schule wird keine Schatten-Buchhaltung, man vermeidet die doppelte Kontenwahrheit und die Wartungs-/Haftungslast eines nachgebauten Finanzsystems - genau richtig fürs Ehrenamt.
- Dass K3 überhaupt ein Charakter-/Pastoren-Referenz-Gate hat und die Zulassung an die entsendende Gemeinde koppelt, ist ein starker theologischer wie praktischer Instinkt - viele Bibelschulen lassen jeden rein, der zahlt, oder handhaben die Entsendung informell per Zuruf. Die Gemeinde-Schnittstelle ist im Kern schon systematisch verankert (muss nur über die Zulassung hinaus Lebensdauer bekommen).
- Das Datenschutz-Fundament steht überraschend solide: Art.9-Consent von Anfang an mitgedacht, Append-only Audit-Log als Rechenschafts-Basis (Art.5 Abs.2), Verschlüsselung sensibler Felder (IBAN) und Impersonation nur mit Banner+Audit. Genau dieses Gerüst trägt die noch fehlenden vertraulichen Mentoring-/Seelsorge-Ebenen.
- K10 Bescheinigungswesen (admin-editierbarer Vorlagen-Editor + Serienerzeugung + Versionierung + Audit) trifft die zertifikatslastige Realität und reduziert die Bus-Faktor-1-Abhängigkeit dort, wo jährlich Anpassungen anfallen. Es ist zugleich der Unterbau, an den Teilabschluss-, Zweitschrift- und Korrektur-Vorlagen später ohne Neubau andocken.
- Richtige Instinkte in der Grobstruktur, nur zu naiv ausgestaltet: K12 als eigener wiederkehrender Lebenszyklus-Schritt (statt Neuanmeldung), Ehepaar-Anmeldung mit 50% (erkennt geistliche Ausbildung im Ehe-Kontext an), und ein mitgedachter Ratenplan + Retention-Bewusstsein zeigen realistisches Gespür für eine berufsbegleitende Erwachsenen-Kohorte.

### Konsequenz für die Umsetzung

Alle Punkte sind als verfolgbare Arbeitspakete in `4_Umsetzungsplan.html` verankert: **39 Arbeitspakete** über 6 Bau-Phasen mit Status/Priorität/Abhängigkeit, plus ein Register **14 offener Entscheidungen** (E-1 bis E-14), die vor dem jeweiligen Paket zu klären sind. Empfohlener Start: **Phase 0 (Fundament & Governance-Unterbau)** mit den drei strukturellen Wurzeln. Zurückgestellt: volle Prüfungs-Engine mit Auto-Grading, REST-API-Produkt, Retention-Analytics. Vorgehen: **Phasen-GoLive** mit Teams ein Semester als Fallback.
