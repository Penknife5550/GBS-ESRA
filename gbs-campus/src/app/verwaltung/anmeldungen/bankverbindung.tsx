"use client";

import { useState } from "react";
import { sendeAnfrage } from "@/lib/api-client";

/**
 * Zeigt die Bankverbindung auf ausdrückliche Anforderung.
 *
 * Standardmäßig stehen nur die letzten vier Stellen da — genug, um einen
 * Datensatz zuzuordnen, zu wenig für eine Lastschrift. Der Klartext kommt erst
 * auf Klick, und jeder dieser Klicks steht mit Namen im Audit-Log.
 */
export function Bankverbindung({ personId, maskiert }: { personId: string; maskiert: string | null }) {
  const [iban, setIban] = useState<string | null>(null);
  const [inhaber, setInhaber] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  if (!maskiert) {
    return <span className="text-muted-foreground">keine hinterlegt</span>;
  }

  if (iban) {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono">{iban}</span>
        {inhaber && <span className="text-xs text-muted-foreground">({inhaber})</span>}
        <button
          type="button"
          onClick={() => {
            setIban(null);
            setInhaber(null);
          }}
          className="text-xs underline underline-offset-2"
        >
          verbergen
        </button>
      </span>
    );
  }

  async function anzeigen() {
    setLaeuft(true);
    setFehler(null);

    const antwort = await sendeAnfrage<{ iban: string; kontoinhaber: string | null }>(
      `/api/personen/${personId}/bankverbindung`,
    );
    setLaeuft(false);

    if (!antwort.ok) {
      setFehler(antwort.meldung);
      return;
    }
    setIban(antwort.daten.iban);
    setInhaber(antwort.daten.kontoinhaber);
  }

  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span className="font-mono">{maskiert}</span>
      <button
        type="button"
        onClick={anzeigen}
        disabled={laeuft}
        className="text-xs underline underline-offset-2 disabled:opacity-60"
        title="Der Zugriff wird protokolliert"
      >
        {laeuft ? "wird geladen …" : "vollständig anzeigen"}
      </button>
      {fehler && <span className="text-xs text-credo-rot">{fehler}</span>}
    </span>
  );
}
