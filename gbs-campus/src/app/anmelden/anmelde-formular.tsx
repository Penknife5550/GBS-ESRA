"use client";

import { useEffect, useRef, useState } from "react";
import { sendeAnfrage } from "@/lib/api-client";
import { knopf } from "@/components/ui/knopf";
import { MeldungsBox, type Meldung } from "@/components/ui/meldung";
import { FELD, FELD_TITEL } from "./oeffentlich";

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
      {linkFehler && <p className="mt-6 rounded-xl bg-credo-rot/10 px-4 py-3 text-sm text-foreground">{linkFehler}</p>}

      <form onSubmit={absenden} className="mt-7">
        <label htmlFor="email" className={FELD_TITEL}>
          E-Mail-Adresse
        </label>
        <input
          ref={eingabe}
          id="email"
          type="email"
          required
          autoComplete="email"
          placeholder="Ihre E-Mail-Adresse"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={zustand !== "bereit"}
          className={`${FELD} h-12 border-input`}
        />

        <button type="submit" disabled={zustand !== "bereit"} className={`${knopf("primaer", "gross")} mt-3.5`}>
          {zustand === "laeuft" ? "Wird gesendet …" : "Link senden"}
        </button>
      </form>

      <MeldungsBox meldung={meldung} className="mt-4" />

      {zustand === "gesendet" && (
        <button
          ref={andereAdresseKnopf}
          type="button"
          onClick={andereAdresse}
          className={`${knopf("sekundaer", "gross")} mt-3`}
        >
          Andere Adresse eingeben
        </button>
      )}
    </>
  );
}
