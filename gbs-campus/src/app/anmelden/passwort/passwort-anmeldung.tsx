"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";

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
    <form onSubmit={absenden} className="mt-8 space-y-4">
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
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
          className="min-h-11 w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm disabled:opacity-60"
        />
      </div>

      <div>
        <label htmlFor="passwort" className="mb-1.5 block text-sm font-medium">
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
          className="min-h-11 w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm disabled:opacity-60"
        />
      </div>

      <button
        type="submit"
        disabled={laeuft}
        className="min-h-11 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {laeuft ? "Wird geprüft …" : "Anmelden"}
      </button>

      {fehler && (
        <p role="alert" className="rounded-lg border border-credo-rot/40 bg-credo-rot/5 px-4 py-3 text-sm">
          {fehler}
        </p>
      )}
    </form>
  );
}
