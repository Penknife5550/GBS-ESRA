"use client";

import { useEffect, useState } from "react";
import { sendeAnfrage } from "@/lib/api-client";

/**
 * Liest den „bin dabei"-Token aus dem URL-FRAGMENT (#token=…) und bestätigt die
 * Teilnahme per POST.
 *
 * Aus dem Fragment und nicht aus dem Query-String — wie beim Anmelde- und
 * Auskunftslink: Das Fragment schickt der Browser nicht an den Server, es landet
 * in keinem Zugriffslog, und ein Link-Scanner löst den Token nicht vorab ein.
 */
type Antwort = { status: "ok" | "schon_bestaetigt"; semester: string; vorname: string; faecher: string[] };

export function DabeiBestaetigen() {
  const [token, setToken] = useState<string | null>(null);
  const [bereit, setBereit] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [ergebnis, setErgebnis] = useState<Antwort | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const wert = new URLSearchParams(hash).get("token");
    setToken(wert && /^[0-9a-f-]{36}$/i.test(wert) ? wert : null);
    setBereit(true);
  }, []);

  async function bestaetigen() {
    if (!token) return;
    setLaeuft(true);
    setFehler(null);

    const antwort = await sendeAnfrage<Antwort>("/api/ueberleitung/bestaetigen", {
      methode: "POST",
      rumpf: { token },
    });
    setLaeuft(false);

    if (!antwort.ok) {
      setFehler(antwort.meldung);
      return;
    }
    setErgebnis(antwort.daten);
  }

  // Vor dem Auslesen des Fragments nichts anzeigen — verhindert ein Aufblitzen
  // der „unvollständig"-Meldung, bevor der Token gelesen ist.
  if (!bereit) return null;

  if (!token) {
    return (
      <p className="mt-8 rounded-lg border border-credo-rot/40 bg-credo-rot/5 px-4 py-3 text-sm">
        Der Link war unvollständig. Bitte öffne den Link aus der E-Mail vollständig, oder wende dich an
        die Schulverwaltung.
      </p>
    );
  }

  if (ergebnis) {
    return (
      <div className="mt-8">
        <p role="status" className="rounded-lg bg-credo-gruen/10 px-4 py-3 text-sm">
          {ergebnis.status === "ok"
            ? `Schön, dass du dabei bist, ${ergebnis.vorname}! Deine Teilnahme am ${ergebnis.semester} ist bestätigt.`
            : `Deine Teilnahme am ${ergebnis.semester} war schon bestätigt — schön, dass du dabei bist, ${ergebnis.vorname}.`}
        </p>

        {ergebnis.faecher.length > 0 && (
          <div className="mt-6">
            <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Diese Fächer erwarten dich
            </h2>
            <ul className="mt-3 space-y-1.5 text-sm">
              {ergebnis.faecher.map((fach) => (
                <li key={fach} className="rounded-lg border border-border bg-card px-3 py-2">
                  {fach}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={bestaetigen}
        disabled={laeuft}
        className="mt-8 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {laeuft ? "Wird gespeichert …" : "Ja, ich bin dabei"}
      </button>

      {fehler && (
        <p role="alert" className="mt-6 rounded-lg border border-credo-rot/40 bg-credo-rot/5 px-4 py-3 text-sm">
          {fehler}
        </p>
      )}
    </>
  );
}
