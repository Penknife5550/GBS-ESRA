"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { knopf } from "@/components/ui/knopf";
import { FELD, FELD_TITEL } from "../oeffentlich";

export function PasswortAnmeldung() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [passwort, setPasswort] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function absenden(ereignis: React.FormEvent) {
    ereignis.preventDefault();
    setLaeuft(true);
    setFehler(null);

    const antwort = await sendeAnfrage("/api/auth/passwort", {
      methode: "POST",
      rumpf: { email, passwort },
    });

    if (!antwort.ok) {
      setLaeuft(false);
      setFehler(antwort.meldung);
      return;
    }

    // Ladezustand bleibt gesetzt, bis die neue Seite steht — sonst sieht das
    // Formular für einen Moment wieder bedienbar aus.
    router.push("/verwaltung");
    router.refresh();
  }

  return (
    <form onSubmit={absenden} className="mt-7 space-y-4">
      <div>
        <label htmlFor="email" className={FELD_TITEL}>
          E-Mail-Adresse
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={laeuft}
          className={`${FELD} h-12 border-input`}
        />
      </div>

      <div>
        <label htmlFor="passwort" className={FELD_TITEL}>
          Passwort
        </label>
        <input
          id="passwort"
          type="password"
          required
          autoComplete="current-password"
          value={passwort}
          onChange={(e) => setPasswort(e.target.value)}
          disabled={laeuft}
          className={`${FELD} h-12 border-input`}
        />
      </div>

      <button type="submit" disabled={laeuft} className={knopf("primaer", "gross")}>
        {laeuft ? "Wird geprüft …" : "Anmelden"}
      </button>

      {fehler && (
        <p role="alert" className="rounded-xl bg-credo-rot/10 px-4 py-3 text-sm text-foreground">
          {fehler}
        </p>
      )}
    </form>
  );
}
