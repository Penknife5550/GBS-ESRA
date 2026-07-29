"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";

/**
 * Liest den Anmelde-Token aus dem URL-FRAGMENT (#token=…) und löst ihn per POST
 * ein.
 *
 * Warum aus dem Fragment und nicht aus dem Query-String: Das Fragment schickt
 * der Browser nicht an den Server, es steht also in keinem Zugriffslog des
 * Reverse Proxy. Der Token ist ein vollwertiger Kontoschlüssel — er darf nicht
 * im Klartext in ein Log geraten.
 */
export function AnmeldungBestaetigen() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [bereit, setBereit] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
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

    const antwort = await sendeAnfrage("/api/auth/token", { methode: "POST", rumpf: { token } });

    if (!antwort.ok) {
      setLaeuft(false);
      setFehler(antwort.meldung);
      return;
    }
    router.push("/verwaltung");
    router.refresh();
  }

  // Vor dem Auslesen des Fragments nichts anzeigen — verhindert ein Aufblitzen
  // der „unvollständig"-Meldung, bevor der Token gelesen ist.
  if (!bereit) return null;

  if (!token) {
    return (
      <p className="mt-8 rounded-lg border border-credo-rot/40 bg-credo-rot/5 px-4 py-3 text-sm">
        Der Link war unvollständig.{" "}
        <a href="/anmelden" className="underline underline-offset-2">
          Neuen Link anfordern
        </a>
      </p>
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
        {laeuft ? "Wird angemeldet …" : "Jetzt anmelden"}
      </button>

      {fehler && (
        <p role="alert" className="mt-6 rounded-lg border border-credo-rot/40 bg-credo-rot/5 px-4 py-3 text-sm">
          {fehler}{" "}
          <a href="/anmelden" className="underline underline-offset-2">
            Neuen Link anfordern
          </a>
        </p>
      )}
    </>
  );
}
