"use client";

import { useEffect, useState } from "react";
import { MeldungsBox, type Meldung } from "@/components/ui/meldung";

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
  // Erfolg und Fehler über die MeldungsBox — beide Live-Regionen stehen immer
  // im DOM, sonst sagen Screenreader die erst eingefügte Meldung oft nicht an.
  const [meldung, setMeldung] = useState<Meldung | null>(null);

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const wert = new URLSearchParams(hash).get("token");
    setToken(wert && /^[0-9a-f-]{36}$/i.test(wert) ? wert : null);
    setBereit(true);
  }, []);

  async function herunterladen() {
    if (!token) return;
    setLaeuft(true);
    setMeldung(null);

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
      setMeldung({ art: "fehler", text: "Die Verbindung ist abgerissen. Bitte versuchen Sie es noch einmal." });
      return;
    }

    if (!antwort.ok) {
      let text = "Der Abruf hat nicht geklappt. Bitte fordern Sie die Auskunft erneut an.";
      try {
        const inhalt = (await antwort.json()) as { error?: string };
        if (inhalt?.error) text = inhalt.error;
      } catch {
        /* Bei 5xx kommt HTML statt JSON — die Vorgabemeldung passt. */
      }
      setLaeuft(false);
      setMeldung({ art: "fehler", text });
      return;
    }

    // Auch das Lesen des Rumpfs kann scheitern — die 30-Sekunden-Grenze läuft
    // weiter, und eine abreißende Verbindung wirft erst hier. Ohne diesen Block
    // stünde der Knopf dauerhaft auf „Wird erstellt …“ (Code-Review 4).
    try {
      const blob = await antwort.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Datenauskunft-GBS-Campus.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMeldung({
        art: "ok",
        text: "Die Auskunft wurde heruntergeladen. Solange der Link gilt, können Sie sie erneut abrufen.",
      });
    } catch {
      setMeldung({
        art: "fehler",
        text: "Der Download ist abgebrochen. Bitte versuchen Sie es noch einmal — der Link gilt weiterhin.",
      });
    } finally {
      setLaeuft(false);
    }
  }

  // Vor dem Auslesen des Fragments nichts anzeigen — verhindert ein Aufblitzen
  // der „unvollständig"-Meldung, bevor der Token gelesen ist.
  if (!bereit) return null;

  if (!token) {
    return (
      <p className="mt-6 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
        Der Link war unvollständig. Bitte öffnen Sie den Link aus der E-Mail vollständig, oder fordern Sie die
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

      <MeldungsBox meldung={meldung} className="mt-4" />
    </div>
  );
}
