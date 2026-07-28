"use client";

import { useState } from "react";
import { sendeAnfrage } from "@/lib/api-client";

export type OffenerEmailAntrag = {
  neueEmail: string;
  /** Bereits deutsch formatiert — der Server rechnet, die Anzeige zeigt nur. */
  gueltigBis: string;
};

/**
 * Antrag auf eine neue E-Mail-Adresse.
 *
 * Der Text erklärt ausdrücklich, dass sich zunächst nichts ändert. Ohne diese
 * Erklärung würde jemand die Adresse eintragen, das Portal schließen und beim
 * nächsten Anmeldeversuch die neue Adresse eingeben — die dann nicht gilt.
 */
export function EmailAendern({
  bisherige,
  offenerAntrag,
}: {
  bisherige: string;
  offenerAntrag: OffenerEmailAntrag | null;
}) {
  const [email, setEmail] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<{ art: "ok" | "warnung" | "fehler"; text: string } | null>(null);

  async function beantragen(ereignis: React.FormEvent) {
    ereignis.preventDefault();
    setLaeuft(true);
    setMeldung(null);

    const antwort = await sendeAnfrage<{ beantragt: boolean; mailGesendet: boolean }>(
      "/api/meine-daten/email",
      { methode: "POST", rumpf: { email } },
    );
    setLaeuft(false);

    if (!antwort.ok) {
      setMeldung({ art: "fehler", text: antwort.meldung });
      document.getElementById("neue-email")?.focus();
      return;
    }

    setEmail("");

    // Zwei bewusste Zurückhaltungen im Erfolgstext: Erstens kann der Versand
    // scheitern, zweitens geht bei einer bereits vergebenen Adresse absichtlich
    // kein Link an den Antragsteller. „Wir haben einen Link geschickt" wäre in
    // beiden Fällen falsch.
    setMeldung(
      antwort.daten.mailGesendet
        ? {
            art: "ok",
            text:
              "Falls die Adresse verwendbar ist, ist ein Bestätigungslink unterwegs. Erst nach dem Klick " +
              "darauf gilt die neue Adresse — bis dahin meldest du dich weiterhin mit der bisherigen an. " +
              "Kommt nichts an (auch im Spam-Ordner nachsehen), melde dich bitte bei der Schulleitung.",
          }
        : {
            art: "warnung",
            text:
              "Der Versand des Bestätigungslinks hat nicht geklappt. Bitte melde dich bei der " +
              "Schulleitung — bis dahin gilt weiterhin deine bisherige Adresse.",
          },
    );
  }

  return (
    <form onSubmit={beantragen} className="rounded-lg border border-border bg-card p-5">
      <p className="text-sm">
        Hinterlegt ist <span className="font-medium break-all">{bisherige}</span>. Über diese Adresse läuft
        dein Zugang zum Portal.
      </p>

      {offenerAntrag && (
        <p className="mt-4 max-w-prose rounded-lg bg-credo-gelb/15 px-3 py-2 text-sm">
          Es läuft bereits ein Antrag auf{" "}
          <span className="font-medium break-all">{offenerAntrag.neueEmail}</span>. Der Bestätigungslink in
          der Mail an diese Adresse gilt bis {offenerAntrag.gueltigBis}. Bis du ihn anklickst, bleibt deine
          bisherige Adresse gültig. Ein neuer Antrag ersetzt diesen.
        </p>
      )}

      <label htmlFor="neue-email" className="mt-4 block text-sm font-medium">
        Neue E-Mail-Adresse
      </label>
      <input
        id="neue-email"
        name="neue-email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          setMeldung(null);
        }}
        aria-describedby="neue-email-hinweis"
        className="mt-1.5 min-h-11 w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm sm:max-w-md"
      />
      <p id="neue-email-hinweis" className="mt-1 max-w-prose text-xs text-muted-foreground">
        Wir schicken einen Bestätigungslink an die neue Adresse. Bis du ihn anklickst, bleibt alles beim
        Alten — so kann ein Tippfehler dich nicht aussperren.
      </p>

      <button
        type="submit"
        disabled={laeuft || email.trim().length === 0}
        className="mt-4 min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {laeuft ? "Wird gesendet …" : "Bestätigungslink anfordern"}
      </button>

      {meldung && (
        <p
          role={meldung.art === "fehler" ? "alert" : "status"}
          className={`mt-4 max-w-prose rounded-lg px-3 py-2 text-sm ${
            meldung.art === "ok"
              ? "bg-credo-gruen/10"
              : meldung.art === "warnung"
                ? "bg-credo-gelb/15"
                : "bg-credo-rot/10"
          }`}
        >
          {meldung.text}
        </p>
      )}
    </form>
  );
}
