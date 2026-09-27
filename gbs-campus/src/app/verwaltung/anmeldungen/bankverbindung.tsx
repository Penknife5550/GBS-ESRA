"use client";

import { useState } from "react";
import { sendeAnfrage } from "@/lib/api-client";

/**
 * Zeigt die Bankverbindung auf ausdrückliche Anforderung.
 *
 * Standardmäßig steht nur „hinterlegt" da — keine einzige Stelle der IBAN. Die
 * Seite kennt nur, OB eine verschlüsselte IBAN existiert; jede Ziffer daraus
 * hieße entschlüsseln, und das geschieht ausschließlich über den protokollierten
 * Weg. (Vorher stand hier eine Maske „•••• •••• XXXX" aus einem Platzhalter —
 * sie sah nach den letzten vier Stellen aus, war aber für jede Person gleich.)
 * Der Klartext kommt erst auf Klick, und jeder dieser Klicks steht mit Akteur
 * und Zeitpunkt im Audit-Log (BANKVERBINDUNG_EINGESEHEN).
 */
export function Bankverbindung({ personId, hinterlegt }: { personId: string; hinterlegt: boolean }) {
  const [iban, setIban] = useState<string | null>(null);
  const [inhaber, setInhaber] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  if (!hinterlegt) {
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

    // POST, obwohl nur gelesen wird: Die Route nimmt nur POST an, damit die
    // Herkunftsprüfung der Middleware greift (siehe Route).
    const antwort = await sendeAnfrage<{ iban: string; kontoinhaber: string | null }>(
      `/api/personen/${personId}/bankverbindung`,
      { methode: "POST" },
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
      <span>hinterlegt</span>
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
