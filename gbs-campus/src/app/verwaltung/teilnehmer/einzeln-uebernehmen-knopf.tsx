"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { MeldungsBox, type Meldung } from "@/components/ui/meldung";

/**
 * Übernimmt EINE zuletzt abgemeldete Person ins laufende Semester. Die
 * Sammelübernahme lässt sie bewusst aus — sie hat für ihr letztes Semester
 * abgesagt oder nicht geantwortet. Deshalb fragt der Knopf vorher nach und nennt
 * die Absage noch einmal.
 */
export function EinzelnUebernehmenKnopf({
  semesterId,
  personId,
  name,
  semester,
  warum,
}: {
  semesterId: string;
  personId: string;
  name: string;
  /** Bezeichnung des laufenden Semesters. */
  semester: string;
  /** Letztes Semester und Grund der Abmeldung, z. B. „Herbstsemester 2026: hat abgesagt …". */
  warum: string;
}) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<Meldung | null>(null);

  async function uebernehmen() {
    if (
      !window.confirm(
        `${name} ins laufende Semester „${semester}“ übernehmen?\n\n` +
          `Zuletzt abgemeldet — ${warum}.\n\n` +
          "Übernehmen Sie die Person nur, wenn sie wieder dabei sein will: Sie steht danach in allen Listen " +
          "dieses Semesters (Anwesenheit, Noten, Excel-Liste, Zeugnisse).",
      )
    ) {
      return;
    }

    setLaeuft(true);
    setMeldung(null);
    const antwort = await sendeAnfrage(`/api/semester/${semesterId}/teilnehmer`, {
      methode: "POST",
      rumpf: { personId },
    });
    setLaeuft(false);

    if (!antwort.ok) {
      setMeldung({ art: "fehler", text: antwort.meldung });
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={uebernehmen}
        disabled={laeuft}
        aria-label={`${name} ins laufende Semester übernehmen`}
        className="min-h-11 rounded-lg border border-border px-3 py-2 text-sm font-medium disabled:opacity-60"
      >
        {laeuft ? "Wird übernommen …" : "Übernehmen"}
      </button>
      <MeldungsBox meldung={meldung} className="max-w-xs" />
    </div>
  );
}
