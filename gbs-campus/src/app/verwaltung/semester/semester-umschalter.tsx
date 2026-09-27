import { Segment } from "@/components/ui/segment";

/** „Semester · Kursraster“ — derselbe Umschalter im Kopf beider Seiten (Oberflächenplan 09/2026). */
export function SemesterUmschalter({ aktiv }: { aktiv: "semester" | "kursraster" }) {
  return (
    <Segment
      label="Semester oder Kursraster"
      eintraege={[
        { text: "Semester", href: "/verwaltung/semester", aktiv: aktiv === "semester" },
        { text: "Kursraster", href: "/verwaltung/faecher", aktiv: aktiv === "kursraster" },
      ]}
    />
  );
}
