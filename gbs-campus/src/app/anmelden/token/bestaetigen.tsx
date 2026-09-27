"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { knopf } from "@/components/ui/knopf";

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
      <p className="mt-8 rounded-xl bg-credo-rot/10 px-4 py-3 text-sm text-foreground">
        Der Link war unvollständig.{" "}
        <a href="/anmelden" className="font-medium underline underline-offset-2">
          Neuen Link anfordern
        </a>
      </p>
    );
  }

  return (
    <>
      <button type="button" onClick={bestaetigen} disabled={laeuft} className={`${knopf("primaer", "gross")} mt-8`}>
        {laeuft ? "Wird angemeldet …" : "Jetzt anmelden"}
      </button>

      {fehler && (
        <p role="alert" className="mt-4 rounded-xl bg-credo-rot/10 px-4 py-3 text-sm text-foreground">
          {fehler}{" "}
          <a href="/anmelden" className="font-medium underline underline-offset-2">
            Neuen Link anfordern
          </a>
        </p>
      )}
    </>
  );
}
