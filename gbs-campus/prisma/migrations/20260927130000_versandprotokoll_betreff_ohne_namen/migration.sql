-- =============================================================================
-- GBS Campus — Versandprotokoll: Betreffs ohne Personennamen (Bestand)
--
-- Befund M6b aus dem Code-Review vom 26.09.2026: Drei Mails an die Verwaltung
-- trugen den Namen der Person im Betreff („Neue Anmeldung: Max Muster",
-- „Stammdaten geändert: …", „Kommt nicht ins Portal: …"). Der gefuellte Betreff
-- steht in `email_versand.betreff` — an der personId der EMPFAENGER bzw. ganz
-- ohne personId (Ausfallzeile des Verteilers, `meldeAusfall`). Die
-- Anonymisierung findet solche Zeilen nur ueber den AKTUELLEN Vor- und
-- Nachnamen; nach einer Namensaenderung blieben sie stehen, und die frei
-- getippten Namen aus dem Hilfeformular gehoeren zu Menschen ohne Akte, die
-- keine Anonymisierung je erreicht.
--
-- Die Vorlagen und die Ersatzbetreffs im Code sind seitdem namenlos. Hier wird
-- der Bestand EINMALIG auf dieselben Texte gesetzt. Erkannt wird eine Zeile am
-- festen Anfang des alten Betreffs, eingeschraenkt auf die passende Vorlage oder
-- auf Zeilen ohne Vorlage (die Ausfallzeile schreibt keinen `vorlageCode`).
--
-- Nur UPDATEs auf `email_versand` (keine Trigger dort), keine Schema-Aenderung.
-- Ein zweiter Lauf findet nichts mehr (die neuen Betreffs haben keinen
-- Doppelpunkt).
-- =============================================================================

UPDATE "email_versand"
SET "betreff" = 'Neue Anmeldung eingegangen'
WHERE "betreff" LIKE 'Neue Anmeldung:%'
  AND ("vorlageCode" = 'ANMELDUNG_VERWALTUNG' OR "vorlageCode" IS NULL);

UPDATE "email_versand"
SET "betreff" = 'Stammdaten geändert'
WHERE "betreff" LIKE 'Stammdaten geändert:%'
  AND ("vorlageCode" = 'DATENAENDERUNG_VERWALTUNG' OR "vorlageCode" IS NULL);

UPDATE "email_versand"
SET "betreff" = 'Meldung zum Portalzugang'
WHERE "betreff" LIKE 'Kommt nicht ins Portal:%'
  AND ("vorlageCode" = 'ZUGANG_HILFE_MELDUNG' OR "vorlageCode" IS NULL);
