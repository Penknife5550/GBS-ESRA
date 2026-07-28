-- =============================================================================
-- GBS Campus — Trigger-Meldung nennt die betroffene Tabelle
--
-- Die Funktion wird von den Sperren auf `audit_log` UND `einwilligungen`
-- genutzt, meldete aber immer „audit_log". Beim Test nach dem Review kam so
-- beim Loeschen einer Einwilligung die Meldung „DELETE auf audit_log ist nicht
-- zulaessig" — das schickt jeden, der das spaeter untersucht, in die falsche
-- Richtung.
--
-- Zweiter Punkt, hier nur dokumentiert: Das Loeschen einer Person scheitert
-- jetzt am Audit-Log. `audit_log.akteurId` steht auf ON DELETE SET NULL, das
-- ausgeloeste UPDATE trifft den Append-only-Trigger. Fuer Release 0.1 ist das
-- richtig so — es gibt keine Loeschfunktion, und ein stilles Loeschen waere
-- schlimmer. Wer spaeter ein Loeschkonzept nach DSGVO Art. 17 baut, muss die
-- Person anonymisieren statt sie zu loeschen; darauf weist diese Meldung hin.
-- =============================================================================

CREATE OR REPLACE FUNCTION audit_log_ist_unveraenderlich()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    '% auf % ist nicht zulaessig: Diese Tabelle ist append-only. Eintraege werden ergaenzt, nie geaendert oder geloescht. Personen werden anonymisiert statt geloescht.',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
