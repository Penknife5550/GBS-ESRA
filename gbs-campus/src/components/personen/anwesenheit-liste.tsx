/**
 * GBS Campus — Anwesenheits-Timeline (read-only) für die Personen-Detailakte
 *
 * Zeigt je Semester die Quote-Ampel und darunter jeden vergangenen Abend mit
 * Datum, Fach und Zustand. Bewusst reine Einsicht: erfasst wird an der Quelle beim
 * Dozenten (/dozent), „entschuldigt" entscheidet die Schule an anderer Stelle.
 * Server-Komponente ohne Interaktion.
 */

import { QuoteAmpel } from "@/components/ui/quote-ampel";
import { AnwesenheitBadge } from "@/components/ui/badges";
import type { EigeneTerminGruppe } from "@/lib/stundenplan-io";

export function AnwesenheitListe({ gruppen }: { gruppen: EigeneTerminGruppe[] }) {
  if (gruppen.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">
        Für diese Person sind noch keine vergangenen Unterrichtsabende erfasst.
      </p>
    );
  }

  return (
    <div className="space-y-6 p-4">
      {gruppen.map((gruppe) => (
        <div key={gruppe.teilnahmeId}>
          <h3 className="mb-2 text-sm font-semibold">{gruppe.semesterBezeichnung}</h3>
          <QuoteAmpel quote={gruppe.quote} sicht="verwaltung" />
          <ul className="mt-3 space-y-2">
            {gruppe.termine.map((termin) => (
              <li
                key={termin.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium">{termin.text}</span>
                  {termin.kurstitel && <span className="ml-2 text-sm text-muted-foreground">· {termin.kurstitel}</span>}
                </div>
                {/* Derselbe Badge wie in der Schüler-Akte — ein Abend hat für
                    Schulleitung und Schüler dieselbe Farbe. */}
                <AnwesenheitBadge status={termin.status} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
