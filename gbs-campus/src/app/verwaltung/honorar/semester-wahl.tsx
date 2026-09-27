/**
 * Semesterwahl der Honorarseiten (Übersicht und Abrechnungen).
 *
 * Oberflächenplan 09/2026: ein Knopf mit dem gewählten Semester neben dem
 * Titel, dahinter die Semester als Links — die Wahl wirkt sofort, ohne
 * „Anzeigen“, und steht wie bisher im Query-Parameter `semester`. Bei vielen
 * Semestern bleibt die Werkzeugleiste so schmal (eine Reihe Pillen wuchs mit
 * jedem Semester).
 */

import { Icon } from "@/components/icons";
import { knopf } from "@/components/ui/knopf";
import { Menue } from "@/components/ui/menue";

export function SemesterWahl({
  semesters,
  gewaehltId,
  pfad,
}: {
  semesters: { id: string; bezeichnung: string; istAktuell: boolean }[];
  gewaehltId: string;
  /** Seite, auf die die Wahl führt, z. B. „/verwaltung/honorar“. */
  pfad: string;
}) {
  const gewaehlt = semesters.find((s) => s.id === gewaehltId);
  return (
    <Menue
      label="Semester wählen"
      ausrichtung="links"
      ausloeserKlasse={`${knopf("sekundaer")} max-w-full`}
      ausloeser={
        <>
          <span className="sr-only">Semester: </span>
          <span className="truncate">{gewaehlt?.bezeichnung ?? "Semester"}</span>
          <Icon name="aufklappen" className="h-4 w-4 shrink-0 text-dezent" />
        </>
      }
      punkte={semesters.map((s) => ({
        text: s.istAktuell ? `${s.bezeichnung} · läuft` : s.bezeichnung,
        href: `${pfad}?semester=${s.id}`,
      }))}
    />
  );
}
