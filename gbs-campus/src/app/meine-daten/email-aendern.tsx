"use client";

import { useState } from "react";
import { sendeAnfrage } from "@/lib/api-client";
import { knopf } from "@/components/ui/knopf";
import { MeldungsBox, type Meldung } from "@/components/ui/meldung";

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
  const [meldung, setMeldung] = useState<Meldung | null>(null);

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
              "darauf gilt die neue Adresse — bis dahin melden Sie sich weiterhin mit der bisherigen an. " +
              "Kommt nichts an (auch im Spam-Ordner nachsehen), melden Sie sich bitte bei der Schulleitung.",
          }
        : {
            art: "warnung",
            text:
              "Der Versand des Bestätigungslinks hat nicht geklappt. Bitte melden Sie sich bei der " +
              "Schulleitung — bis dahin gilt weiterhin Ihre bisherige Adresse.",
          },
    );
  }

  return (
    <form onSubmit={beantragen} className="flex flex-col">
      <p className="text-sm">
        Hinterlegt ist <span className="font-medium break-all">{bisherige}</span>. Über diese Adresse läuft
        Ihr Zugang zum Portal.
      </p>

      {offenerAntrag && (
        <p className="mt-4 max-w-prose rounded-lg bg-credo-gelb/15 px-3 py-2 text-sm">
          Es läuft bereits ein Antrag auf{" "}
          <span className="font-medium break-all">{offenerAntrag.neueEmail}</span>. Der Bestätigungslink in
          der Mail an diese Adresse gilt bis {offenerAntrag.gueltigBis}. Bis Sie ihn anklicken, bleibt Ihre
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
        className="mt-1.5 min-h-11 w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm"
      />
      <p id="neue-email-hinweis" className="mt-1 max-w-prose text-xs text-muted-foreground">
        Wir schicken einen Bestätigungslink an die neue Adresse. Bis Sie ihn anklicken, bleibt alles beim
        Alten — so kann ein Tippfehler Sie nicht aussperren.
      </p>

      <button
        type="submit"
        disabled={laeuft || email.trim().length === 0}
        className={`${knopf("primaer")} mt-4 w-full sm:w-auto sm:self-end`}
      >
        {laeuft ? "Wird gesendet …" : "Bestätigungslink anfordern"}
      </button>

      <MeldungsBox meldung={meldung} className="mt-4" />
    </form>
  );
}
