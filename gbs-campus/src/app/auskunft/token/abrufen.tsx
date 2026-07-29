"use client";

import { useEffect, useState } from "react";

/**
 * Liest den Auskunfts-Token aus dem URL-FRAGMENT (#token=…) und lädt die PDF per
 * POST herunter.
 *
 * Warum aus dem Fragment und nicht aus dem Query-String: Das Fragment schickt der
 * Browser nicht an den Server, es steht also in keinem Zugriffslog des Reverse
 * Proxy und in keinem Next.js-Request-Log. Der Token führt zur vollständigen
 * Datenkopie (Glaubensangaben nach Art. 9, IBAN im Klartext) und ist bis zu drei
 * Tage gültig — er darf nicht im Klartext in einem Log landen.
 *
 * Direkter `fetch` statt des JSON-Helfers `sendeAnfrage`: Die Antwort ist im
 * Erfolgsfall eine PDF (Blob), kein JSON. Nur im Fehlerfall kommt JSON zurück.
 */
export function AuskunftAbrufen() {
  const [token, setToken] = useState<string | null>(null);
  const [bereit, setBereit] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [fehlerText, setFehlerText] = useState<string | null>(null);
  const [fertig, setFertig] = useState(false);

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const wert = new URLSearchParams(hash).get("token");
    setToken(wert && /^[0-9a-f-]{36}$/i.test(wert) ? wert : null);
    setBereit(true);
  }, []);

  async function herunterladen() {
    if (!token) return;
    setLaeuft(true);
    setFehlerText(null);

    let antwort: Response;
    try {
      antwort = await fetch("/api/auskunft/abrufen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      setLaeuft(false);
      setFehlerText("Die Verbindung ist abgerissen. Bitte versuche es noch einmal.");
      return;
    }

    if (!antwort.ok) {
      let meldung = "Der Abruf hat nicht geklappt. Bitte fordere die Auskunft erneut an.";
      try {
        const inhalt = (await antwort.json()) as { error?: string };
        if (inhalt?.error) meldung = inhalt.error;
      } catch {
        /* Bei 5xx kommt HTML statt JSON — die Vorgabemeldung passt. */
      }
      setLaeuft(false);
      setFehlerText(meldung);
      return;
    }

    const blob = await antwort.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Datenauskunft-GBS-Campus.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    setLaeuft(false);
    setFertig(true);
  }

  // Vor dem Auslesen des Fragments nichts anzeigen — verhindert ein Aufblitzen
  // der „unvollständig"-Meldung, bevor der Token gelesen ist.
  if (!bereit) return null;

  if (!token) {
    return (
      <p className="mt-6 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
        Der Link war unvollständig. Bitte öffne den Link aus der E-Mail vollständig, oder fordere die
        Auskunft über die Schulverwaltung erneut an.
      </p>
    );
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={herunterladen}
        disabled={laeuft}
        className="min-h-11 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {laeuft ? "Wird erstellt …" : "Auskunft als PDF herunterladen"}
      </button>

      {fertig && (
        <p role="status" className="mt-4 rounded-lg bg-credo-gruen/10 px-3 py-2 text-sm">
          Die Auskunft wurde heruntergeladen. Solange der Link gilt, kannst du sie erneut abrufen.
        </p>
      )}

      {fehlerText && (
        <p role="alert" className="mt-4 rounded-lg bg-credo-rot/10 px-3 py-2 text-sm">
          {fehlerText}
        </p>
      )}
    </div>
  );
}
