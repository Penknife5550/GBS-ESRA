"use client";

import { useEffect, useRef, useState } from "react";
import { sendeAnfrage } from "@/lib/api-client";
import { MeldungsBox, type Meldung } from "@/components/ui/meldung";

export function AnmeldeFormular({ linkFehler }: { linkFehler: string | null }) {
  const [email, setEmail] = useState("");
  const [zustand, setZustand] = useState<"bereit" | "laeuft" | "gesendet">("bereit");
  // Erfolg und Fehler über die MeldungsBox: Beide Live-Regionen stehen immer im
  // DOM — eine erst mit dem Text eingefügte Region sagen Screenreader oft nicht
  // an. Ein Fehler (ungültige Adresse, gedrosselt, Netz) steht dabei in der
  // roten Box, nicht in derselben wie die Erfolgsmeldung (Code-Review 4).
  const [meldung, setMeldung] = useState<Meldung | null>(null);
  const eingabe = useRef<HTMLInputElement>(null);
  const andereAdresseKnopf = useRef<HTMLButtonElement>(null);

  // Nach dem Senden bleiben Feld und Knopf gesperrt, der Fokus fiele auf die
  // Seite zurück. Die Meldung sagt die Live-Region an; der Fokus landet auf dem
  // nächsten möglichen Schritt (erst nach dem Zeichnen, dann gibt es den Knopf).
  useEffect(() => {
    if (zustand === "gesendet") andereAdresseKnopf.current?.focus();
  }, [zustand]);

  async function absenden(ereignis: React.FormEvent) {
    ereignis.preventDefault();
    setZustand("laeuft");
    setMeldung(null);

    const antwort = await sendeAnfrage<{ hinweis: string }>("/api/auth/anmelden", {
      methode: "POST",
      rumpf: { email },
    });

    if (!antwort.ok) {
      setMeldung({ art: "fehler", text: antwort.meldung });
      setZustand("bereit");
      // Der Knopf war während des Sendens gesperrt, der Fokus ist also weg —
      // zurück ins Feld, damit sich die Adresse gleich korrigieren lässt.
      requestAnimationFrame(() => eingabe.current?.focus());
      return;
    }

    setMeldung({ art: "ok", text: antwort.daten.hinweis });
    setZustand("gesendet");
  }

  // Nach dem Senden blieben Feld und Knopf vorher gesperrt — wer sich vertippt
  // hatte, kam ohne Neuladen nicht weiter. Die Adresse bleibt stehen, damit
  // sich ein Tippfehler direkt korrigieren lässt.
  function andereAdresse() {
    setMeldung(null);
    setZustand("bereit");
    // Das Feld ist erst nach dem Neuzeichnen wieder freigegeben.
    requestAnimationFrame(() => eingabe.current?.focus());
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
            ref={eingabe}
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

      <MeldungsBox meldung={meldung} className="mt-6" />

      {zustand === "gesendet" && (
        <button
          ref={andereAdresseKnopf}
          type="button"
          onClick={andereAdresse}
          className="mt-3 min-h-11 w-full rounded-lg border border-input px-4 py-2.5 text-sm font-medium"
        >
          Andere Adresse eingeben
        </button>
      )}
    </>
  );
}
