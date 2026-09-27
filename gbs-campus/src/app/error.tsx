"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { EINRICHTUNG } from "@/lib/constants";

/**
 * Auffangseite für Fehler in Server- und Client-Komponenten.
 *
 * Ohne sie zeigt Next.js seine englische Standardfehlerseite — bei einem
 * Datenbankausfall also ausgerechnet dem Bewerber, mitten im Anmeldeformular.
 * Die Hausregel verlangt deutsche Fehlermeldungen; hier zählt sie am meisten.
 *
 * „Erneut versuchen" lädt die Seite beim Server neu und setzt erst dann die
 * Fehlergrenze zurück. Ein reines reset() rendert nur die Client-Seite erneut —
 * ein Server-Fehler (etwa die Datenbank kurz weg) bliebe stehen, obwohl er
 * längst behoben ist. Der Fehlercode (digest) ist derselbe, den Next.js im
 * Server-Log neben den Fehler schreibt; so lässt sich eine Meldung zuordnen,
 * ohne dass die Seite Einzelheiten preisgibt.
 */
export default function Fehlerseite({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [laeuft, starte] = useTransition();

  useEffect(() => {
    console.error(error);
  }, [error]);

  function erneutVersuchen() {
    starte(() => {
      router.refresh();
      reset();
    });
  }

  return (
    <main className="mx-auto max-w-lg px-6 py-24">
      <h1 className="text-2xl font-bold tracking-tight">Da ist etwas schiefgelaufen</h1>
      <p className="mt-3 text-muted-foreground">
        Wir konnten die Seite gerade nicht laden. Meistens hilft es, es noch einmal zu versuchen.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        Wenn das Problem bleibt, wenden Sie sich bitte an die Schulleitung der {EINRICHTUNG.name}
        {error.digest ? " und nennen Sie den Fehlercode." : "."}
      </p>
      {error.digest && (
        <p className="mt-2 text-sm text-muted-foreground">
          Fehlercode: <span className="font-mono text-foreground">{error.digest}</span>
        </p>
      )}
      <button
        type="button"
        disabled={laeuft}
        onClick={erneutVersuchen}
        className="mt-8 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {laeuft ? "Wird geladen …" : "Erneut versuchen"}
      </button>
    </main>
  );
}
