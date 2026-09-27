"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { Blatt, BlattKnopf } from "@/components/ui/blatt";
import { knopf } from "@/components/ui/knopf";
import { MeldungsBox, type Meldung } from "@/components/ui/meldung";
import { Menue } from "@/components/ui/menue";
import { SemesterFormular, type SemesterEingabefelder } from "./semester-formular";

/** „Neues Semester“ oben rechts: das Anlegeformular im Blatt statt dauerhaft über der Liste. */
export function NeuesSemester() {
  return (
    <BlattKnopf text="Neues Semester" icon="plus" titel="Neues Semester" breit>
      {(schliessen) => <SemesterFormular mitAktuellSchalter onAbbrechen={schliessen} />}
    </BlattKnopf>
  );
}

export type SemesterAuswahl = {
  id: string;
  bezeichnung: string;
  istAktuell: boolean;
  felder: SemesterEingabefelder;
};

/**
 * „Bearbeiten“ und das Menü „…“ am gewählten Semester. „Als laufendes Semester
 * setzen“ ist selten und folgenreich (Teilnehmerliste und neue Anmeldungen
 * hängen daran) — deshalb im Menü und mit Rückfrage.
 */
export function SemesterAktionen({
  semester,
  bisherLaufend,
}: {
  semester: SemesterAuswahl;
  /** Bezeichnung des Semesters, das gerade läuft — für die Rückfrage. */
  bisherLaufend: string | null;
}) {
  const router = useRouter();
  const [bearbeiten, setBearbeiten] = useState(false);
  // Jedes Öffnen beginnt beim gespeicherten Stand (neuer Schlüssel = frisches Formular).
  const [oeffnungen, setOeffnungen] = useState(0);
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<Meldung | null>(null);

  async function alsLaufendSetzen() {
    // Der Wechsel entwertet still das bisherige Semester: Die Teilnehmerliste
    // zeigt danach andere Personen und neue Anmeldungen landen woanders. Das
    // darf kein Fehlklick auslösen.
    if (
      !window.confirm(
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
    if (!antwort.ok) return setMeldung({ art: "fehler", text: antwort.meldung });
    setMeldung({ art: "ok", text: `„${semester.bezeichnung}" ist jetzt das laufende Semester.` });
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => {
            setOeffnungen((n) => n + 1);
            setBearbeiten(true);
          }}
          aria-haspopup="dialog"
          className={knopf("leise")}
        >
          Bearbeiten
        </button>
        {!semester.istAktuell && (
          <Menue
            label={`Weitere Aktionen für ${semester.bezeichnung}`}
            punkte={[
              {
                text: laeuft ? "Wird gesetzt …" : "Als laufendes Semester setzen",
                icon: "wechseln",
                aktion: alsLaufendSetzen,
                deaktiviert: laeuft,
              },
            ]}
          />
        )}
      </div>
      <MeldungsBox meldung={meldung} className="max-w-sm" />
      <Blatt breit offen={bearbeiten} onSchliessen={() => setBearbeiten(false)} titel={`${semester.bezeichnung} bearbeiten`}>
        <SemesterFormular
          key={`${semester.id}-${oeffnungen}`}
          id={semester.id}
          vorbelegung={semester.felder}
          onAbbrechen={() => setBearbeiten(false)}
        />
      </Blatt>
    </div>
  );
}
