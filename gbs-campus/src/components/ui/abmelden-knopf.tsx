"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { sendeAnfrage } from "@/lib/api-client";

/**
 * Abmelden. Fehlte vorher vollständig — in einer Schule mit geteiltem iPad und
 * Verwaltungsrechner blieb die Sitzung offen, bis sie von selbst ablief.
 *
 * Weitergeleitet wird nur, wenn der Server das Abmelden bestätigt hat. Vorher
 * ging es auch bei einem Fehler (Netzabbruch, 502 während eines Deploys) auf
 * /anmelden — die Person hielt sich für abgemeldet, das httpOnly-Cookie blieb
 * aber gültig, und der Browser kann es selbst nicht löschen.
 */
export function AbmeldenKnopf() {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function abmelden() {
    setLaeuft(true);
    setFehler(null);

    const antwort = await sendeAnfrage("/api/auth/abmelden", { methode: "POST" });

    if (!antwort.ok) {
      setLaeuft(false);
      // Kein „oder den Browser schließen": Das Cookie hat eine feste Laufzeit
      // (AUTH_SITZUNG_STUNDEN) und übersteht das Schließen des Browsers.
      setFehler("Abmelden hat nicht geklappt — du bist auf diesem Gerät noch angemeldet. Bitte versuche es noch einmal.");
      return;
    }

    router.push("/anmelden");
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={laeuft}
        onClick={abmelden}
        className="rounded-lg border border-input px-4 py-2 text-sm font-medium disabled:opacity-60"
      >
        {laeuft ? "Wird abgemeldet …" : "Abmelden"}
      </button>
      {fehler && (
        <span role="alert" className="max-w-[16rem] text-right text-xs text-credo-rot">
          {fehler}
        </span>
      )}
    </div>
  );
}
