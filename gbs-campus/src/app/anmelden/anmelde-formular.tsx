"use client";

import { useState } from "react";
import { sendeAnfrage } from "@/lib/api-client";

export function AnmeldeFormular({ linkFehler }: { linkFehler: string | null }) {
  const [email, setEmail] = useState("");
  const [zustand, setZustand] = useState<"bereit" | "laeuft" | "gesendet">("bereit");
  const [meldung, setMeldung] = useState<string | null>(null);

  async function absenden(ereignis: React.FormEvent) {
    ereignis.preventDefault();
    setZustand("laeuft");
    setMeldung(null);

    const antwort = await sendeAnfrage<{ hinweis: string }>("/api/auth/anmelden", {
      methode: "POST",
      rumpf: { email },
    });

    if (!antwort.ok) {
      setMeldung(antwort.meldung);
      setZustand("bereit");
      return;
    }

    setMeldung(antwort.daten.hinweis);
    setZustand("gesendet");
  }

  return (
    <>
      {linkFehler && (
        <p className="mt-6 rounded-lg border border-credo-rot/40 bg-credo-rot/5 px-4 py-3 text-sm">{linkFehler}</p>
      )}

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
            disabled={zustand !== "bereit"}
            className="min-h-11 w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm disabled:opacity-60"
          />
        </div>

        <button
          type="submit"
          disabled={zustand !== "bereit"}
          className="min-h-11 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {zustand === "laeuft" ? "Wird gesendet …" : "Anmeldelink anfordern"}
        </button>
      </form>

      {meldung && (
        <p
          role="status"
          className="mt-6 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground"
        >
          {meldung}
        </p>
      )}
    </>
  );
}
