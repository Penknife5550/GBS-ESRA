import { Segment } from "@/components/ui/segment";
import { SemesterWahl } from "./semesterwahl";

type SemesterEintrag = { id: string; bezeichnung: string; start: Date; ende: Date; istAktuell: boolean };

/**
 * Semesterwahl und Umschalter „Noten · Zeugnisse“ im Seitenkopf beider Seiten
 * (Oberflächenplan 09/2026: ein Menüpunkt „Noten & Zeugnisse“). Der Umschalter
 * behält das gewählte Semester, die Zeugnisseite zusätzlich die Art (`typ`).
 */
export function NotenZeugnisseFilter({
  semesters,
  gewaehltId,
  ansicht,
  typ = "SEMESTER",
}: {
  semesters: readonly SemesterEintrag[];
  gewaehltId: string;
  ansicht: "noten" | "zeugnisse";
  typ?: string;
}) {
  const noten = (id: string) => `/verwaltung/noten?semester=${id}`;
  const zeugnisse = (id: string) => `/verwaltung/zeugnisse?semester=${id}&typ=${typ}`;
  return (
    <div className="flex flex-wrap items-center gap-2 lg:gap-3">
      <SemesterWahl semesters={semesters} gewaehltId={gewaehltId} href={ansicht === "noten" ? noten : zeugnisse} />
      <Segment
        label="Noten oder Zeugnisse"
        eintraege={[
          { text: "Noten", href: noten(gewaehltId), aktiv: ansicht === "noten" },
          { text: "Zeugnisse", href: zeugnisse(gewaehltId), aktiv: ansicht === "zeugnisse" },
        ]}
      />
    </div>
  );
}
