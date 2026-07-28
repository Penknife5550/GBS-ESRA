"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { SemesterEingabefelder, SemesterFormular } from "./semester-formular";

export type SemesterAnzeige = {
  id: string;
  bezeichnung: string;
  code: string;
  zeitraum: string;
  anmeldefenster: string | null;
  istAktuell: boolean;
  teilnehmer: number;
  felder: SemesterEingabefelder;
};

export function SemesterZeile({
  semester,
  bisherLaufend,
}: {
  semester: SemesterAnzeige;
  /** Bezeichnung des Semesters, das gerade läuft — für die Rückfrage. */
  bisherLaufend: string | null;
}) {
  const router = useRouter();
  const [bearbeiten, setBearbeiten] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);

  async function alsLaufendSetzen() {
    // Der Wechsel entwertet still das bisherige Semester: Die Teilnehmerliste
    // zeigt danach andere Personen und neue Anmeldungen landen woanders. Das
    // darf kein Fehlklick auslösen.
    if (
      !confirm(
        `„${semester.bezeichnung}" als laufendes Semester setzen?\n\n` +
          (bisherLaufend ? `„${bisherLaufend}" verliert dabei die Markierung.\n\n` : "") +
          "Ab dann zeigt die Teilnehmerliste die Personen dieses Semesters, und neue Anmeldungen " +
          "werden ihm zugeordnet.",
      )
    ) {
      return;
    }

    setLaeuft(true);
    setMeldung(null);

    const antwort = await sendeAnfrage(`/api/semester/${semester.id}/aktuell`, { methode: "POST" });
    setLaeuft(false);

    if (!antwort.ok) {
      setMeldung(antwort.meldung);
      return;
    }
    router.refresh();
  }

  return (
    <li className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">
            {semester.bezeichnung}{" "}
            <span className="font-normal text-muted-foreground">({semester.code})</span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{semester.zeitraum}</p>
          {semester.anmeldefenster && (
            <p className="text-sm text-muted-foreground">Anmeldung: {semester.anmeldefenster}</p>
          )}
          <p className="mt-2 text-sm">
            {semester.teilnehmer === 0
              ? "Noch niemand zugeordnet"
              : `${semester.teilnehmer} ${semester.teilnehmer === 1 ? "Person" : "Personen"} zugeordnet`}
          </p>
        </div>

        {semester.istAktuell && (
          <span className="inline-flex rounded-full bg-credo-gruen/15 px-2.5 py-0.5 text-xs font-medium">
            Laufendes Semester
          </span>
        )}
      </div>

      {meldung && (
        <p role="alert" className="mt-3 rounded-lg bg-credo-rot/10 px-3 py-2 text-sm">
          {meldung}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        {!semester.istAktuell && (
          <button
            type="button"
            onClick={alsLaufendSetzen}
            disabled={laeuft}
            className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {laeuft ? "Wird gesetzt …" : "Als laufendes Semester setzen"}
          </button>
        )}
        <button
          type="button"
          onClick={() => setBearbeiten((bisher) => !bisher)}
          aria-expanded={bearbeiten}
          aria-controls={`bearbeiten-${semester.id}`}
          className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium"
        >
          {bearbeiten ? "Bearbeiten schließen" : "Bearbeiten"}
        </button>
      </div>

      {bearbeiten && (
        <div id={`bearbeiten-${semester.id}`} className="mt-4">
          <SemesterFormular
            id={semester.id}
            vorbelegung={semester.felder}
            onAbbrechen={() => setBearbeiten(false)}
          />
        </div>
      )}
    </li>
  );
}
