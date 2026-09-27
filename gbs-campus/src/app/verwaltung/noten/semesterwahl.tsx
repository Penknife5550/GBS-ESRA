/**
 * Semesterwahl der Seiten Unterricht, Noten und Zeugnisse (Oberflächenplan
 * 09/2026): ein Knopf mit dem gewählten Semester, dahinter die Semester als
 * Links — oben das laufende und die kommenden, darunter die früheren. Die Wahl
 * steht in der Adresse (`?semester=`), wirkt sofort und lässt sich merken;
 * gewechselt wird erst mit dem Klick auf einen Eintrag, nicht schon beim
 * Durchblättern (WCAG 3.2.2) — deshalb kein „Anzeigen“ mehr.
 *
 * Als Link ist der Wechsel ein echter Seitenwechsel innerhalb der App: Ungesicherte
 * Noten bleiben im Blatt markiert („ungespeichert“), und Neuladen oder Schließen
 * fragt weiter über `beforeunload` in der Notenmatrix nach.
 */

import { Icon } from "@/components/icons";
import { knopf } from "@/components/ui/knopf";
import { Menue, type MenuePunkt } from "@/components/ui/menue";
import { ordneSemester } from "@/lib/semesterplan";

type SemesterEintrag = { id: string; bezeichnung: string; start: Date; ende: Date; istAktuell: boolean };

export function SemesterWahl({
  semesters,
  gewaehltId,
  href,
}: {
  semesters: readonly SemesterEintrag[];
  gewaehltId: string;
  /** Adresse der Seite für ein Semester, etwa `/verwaltung/noten?semester=…`. */
  href: (semesterId: string) => string;
}) {
  const { aktuelle, fruehere } = ordneSemester(semesters, new Date());
  const gewaehlt = semesters.find((s) => s.id === gewaehltId);
  const punkt = (s: SemesterEintrag, trenner: boolean): MenuePunkt => ({
    text: s.istAktuell ? `${s.bezeichnung} · läuft` : s.bezeichnung,
    icon: s.id === gewaehltId ? "haken" : "kalender",
    href: href(s.id),
    trenner,
  });
  const punkte = [...aktuelle.map((s) => punkt(s, false)), ...fruehere.map((s, i) => punkt(s, i === 0 && aktuelle.length > 0))];

  return (
    <Menue
      label="Semester wählen"
      ausrichtung="links"
      punkte={punkte}
      ausloeserKlasse={knopf("sekundaer")}
      ausloeser={
        <>
          <span className="sr-only">Semester: </span>
          {gewaehlt?.bezeichnung ?? "Semester"}
          <Icon name="aufklappen" className="h-4 w-4 text-muted-foreground" />
        </>
      }
    />
  );
}
