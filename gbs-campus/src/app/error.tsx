"use client";

/**
 * Auffangseite für Fehler in Server- und Client-Komponenten.
 *
 * Ohne sie zeigt Next.js seine englische Standardfehlerseite — bei einem
 * Datenbankausfall also ausgerechnet dem Bewerber, mitten im Anmeldeformular.
 * Die Hausregel verlangt deutsche Fehlermeldungen; hier zählt sie am meisten.
 */
export default function Fehlerseite({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-lg px-6 py-24">
      <h1 className="text-2xl font-bold tracking-tight">Da ist etwas schiefgelaufen</h1>
      <p className="mt-3 text-muted-foreground">
        Wir konnten die Seite gerade nicht laden. Meistens hilft es, es noch einmal zu versuchen.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        Wenn das Problem bleibt, wende dich bitte an die Schulleitung der Gemeindebibelschule Minden.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-8 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground"
      >
        Erneut versuchen
      </button>
    </main>
  );
}
