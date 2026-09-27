"use client";

/**
 * GBS Campus — Lade-Hinweis für einen Link
 *
 * Rückmeldung beim Seitenwechsel: Alle Verwaltungsseiten sind force-dynamic, nach
 * dem Klick blieb die alte Seite ohne jedes Zeichen stehen, bis die neue vom
 * Server kam. Steht innerhalb eines <Link> und zeigt „Wird geladen …", solange
 * genau dieser Link lädt (useLinkStatus).
 *
 * Bewusst KEINE loading.tsx: Sie legt eine Suspense-Grenze um die Seite, Next.js
 * schickt dann Kopf und Platzhalter sofort mit 200. Die Weiterleitungen der
 * Seiten (redirect() ohne Anmeldung oder Recht, 307) und notFound() (404) kämen
 * nur noch als Meta-Refresh im Rumpf an — der Durchstich prüft genau diese Codes.
 *
 * Die Live-Region bleibt immer im DOM (leer im Ruhezustand), damit Screenreader
 * den Wechsel ansagen. Der Text selbst bleibt voll deckend: Pulsierte er, fiele
 * sein Kontrast in jedem Zyklus unter 4,5:1 (WCAG 1.4.3). Pulsieren darf nur
 * ein dekorativer Punkt davor, und nur während des Ladens.
 */

import { useLinkStatus } from "next/link";

export function LadeHinweis({ className = "" }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <span role="status" className={`inline-block text-xs font-normal text-muted-foreground ${className}`}>
      {pending && (
        <>
          <span aria-hidden="true" className="motion-safe:animate-pulse">
            ●
          </span>{" "}
          Wird geladen …
        </>
      )}
    </span>
  );
}
