"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { sendeAnfrage } from "@/lib/api-client";

/**
 * Ein Klick, ein POST. Dasselbe Muster wie beim Anmeldelink: Ein GET würde von
 * Link-Scannern in Mail-Sicherheitslösungen abgerufen und der Token wäre
 * verbraucht, bevor der Empfänger überhaupt klickt.
 */
export function EmailBestaetigen({ token }: { token: string }) {
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [neueAdresse, setNeueAdresse] = useState<string | null>(null);
  const erfolgRef = useRef<HTMLParagraphElement>(null);

  // Mit dem Erfolg verschwindet der Knopf — und mit ihm der Fokus. Ohne diesen
  // Sprung landet die Tastatur wieder ganz oben und Vorleseprogramme sagen
  // nichts.
  useEffect(() => {
    if (neueAdresse) erfolgRef.current?.focus();
  }, [neueAdresse]);

  async function bestaetigen() {
    setLaeuft(true);
    setFehler(null);

    const antwort = await sendeAnfrage<{ bestaetigt: boolean; email: string }>(
      "/api/meine-daten/email/bestaetigen",
      { methode: "POST", rumpf: { token } },
    );
    setLaeuft(false);

    if (!antwort.ok) {
      setFehler(antwort.meldung);
      return;
    }
    setNeueAdresse(antwort.daten.email);
  }

  if (neueAdresse) {
    return (
      <div className="mt-8">
        <p
          ref={erfolgRef}
          tabIndex={-1}
          role="status"
          className="rounded-lg bg-credo-gruen/10 px-4 py-3 text-sm"
        >
          Deine E-Mail-Adresse ist jetzt <span className="font-medium break-all">{neueAdresse}</span>. Ab
          sofort läuft dein Zugang zum Portal über diese Adresse.
        </p>
        <Link
          href="/anmelden"
          className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Zur Anmeldung
        </Link>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={bestaetigen}
        disabled={laeuft}
        className="mt-8 min-h-11 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {laeuft ? "Wird bestätigt …" : "Neue Adresse bestätigen"}
      </button>

      {fehler && (
        <p role="alert" className="mt-6 rounded-lg border border-credo-rot/40 bg-credo-rot/5 px-4 py-3 text-sm">
          {fehler}
        </p>
      )}
    </>
  );
}
