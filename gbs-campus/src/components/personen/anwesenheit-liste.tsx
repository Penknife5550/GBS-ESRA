/**
 * GBS Campus — Anwesenheits-Timeline (read-only) für die Personen-Detailakte
 *
 * Zeigt je Semester die Quote-Ampel und darunter jeden vergangenen Abend mit
 * Datum, Fach und Zustand. Bewusst reine Einsicht: erfasst wird an der Quelle beim
 * Dozenten (/dozent), „entschuldigt" entscheidet die Schule an anderer Stelle.
 * Server-Komponente ohne Interaktion.
 */

import { anwesenheitName } from "@/lib/stundenplan";
import { QuoteAmpel } from "@/components/ui/quote-ampel";
import type { EigeneTerminGruppe } from "@/lib/stundenplan-io";

const ZUSTAND_TON: Record<string, string> = {
  ANWESEND: "bg-credo-gruen/15 text-foreground",
  NACHGEARBEITET: "bg-credo-blau/12 text-foreground",
  GEFEHLT: "bg-credo-rot/12 text-foreground",
  ENTSCHULDIGT: "bg-credo-gelb/25 text-foreground",
};

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
          <QuoteAmpel quote={gruppe.quote} />
          <ul className="mt-3 space-y-2">
            {gruppe.termine.map((termin) => (
              <li
                key={termin.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium">{termin.text}</span>
                  {termin.fach && <span className="ml-2 text-sm text-muted-foreground">· {termin.fach}</span>}
                </div>
                <span
                  className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    termin.status ? ZUSTAND_TON[termin.status] ?? "bg-muted text-muted-foreground" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {termin.status ? anwesenheitName(termin.status) : "noch offen"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
