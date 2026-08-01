/**
 * GBS Campus — Personen-Kopf
 *
 * Der gemeinsame Kopf der Detailakte (/verwaltung/personen/[id]) und der
 * Schüler-Selbst-Akte (/meine-daten): Initialen-Avatar, Name, Status-/Form-Badges,
 * Kontaktzeile und eine kleine Faktentabelle. `rechts` nimmt rollenspezifische
 * Inhalte auf — Admin-Aktionen in der Verwaltung, eine Sprungnavigation beim
 * Schüler. Rein darstellend (Server-Komponente).
 */

import type { ReactNode } from "react";

function initialen(vorname: string, nachname: string): string {
  return `${vorname.trim()[0] ?? ""}${nachname.trim()[0] ?? ""}`.toUpperCase() || "?";
}

export function PersonKopf({
  vorname,
  nachname,
  badges,
  kontakt,
  facts,
  rechts,
}: {
  vorname: string;
  nachname: string;
  badges?: ReactNode;
  kontakt?: ReactNode;
  facts: { bezeichnung: string; wert: ReactNode }[];
  rechts?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 gap-4">
          <span
            aria-hidden="true"
            className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground"
          >
            {initialen(vorname, nachname)}
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight">
              {vorname} {nachname}
            </h1>
            {badges && <div className="mt-1.5 flex flex-wrap items-center gap-2">{badges}</div>}
            {kontakt && <div className="mt-1.5 break-words text-sm text-muted-foreground">{kontakt}</div>}
          </div>
        </div>
        {rechts && <div className="flex-none">{rechts}</div>}
      </div>

      {facts.length > 0 && (
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border pt-4 sm:grid-cols-4">
          {facts.map((f) => (
            <div key={f.bezeichnung} className="min-w-0">
              <dt className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{f.bezeichnung}</dt>
              <dd className="mt-0.5 break-words text-sm font-medium">{f.wert}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
