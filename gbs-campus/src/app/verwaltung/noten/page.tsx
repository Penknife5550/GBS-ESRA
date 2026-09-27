import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { ladeNotenUebersicht } from "@/lib/leistung-io";
import { NotenMatrix } from "@/components/noten/noten-matrix";
import { LeererZustand } from "@/components/ui/hinweis";
import { knopf } from "@/components/ui/knopf";
import { Inhalt, Seitenkopf } from "@/components/ui/seitenkopf";
import { NotenZeugnisseFilter } from "./noten-kopf";

export const metadata = { title: "Noten" };
export const dynamic = "force-dynamic";

/**
 * Notenverwaltung der Schulleitung (Recht NOTEN_VERWALTEN, alle Fächer) — mit
 * den Zeugnissen unter einem Menüpunkt „Noten & Zeugnisse“. Je Kurseinheit des
 * Semesters eine Zeile mit dem Stand; die Noten der aktiven Schüler trägt man im
 * Blatt ein. Hörer und für das Semester Abgemeldete stehen nicht darin (sie
 * werden nicht benotet).
 */
export default async function NotenSeite({
  searchParams,
}: {
  searchParams: Promise<{ semester?: string }>;
}) {
  const benutzer = await ladeMitRecht(RECHT.NOTEN_VERWALTEN);
  if (!benutzer) redirect("/anmelden");

  const sp = await searchParams;
  const semesters = await prisma.semester.findMany({ orderBy: { start: "asc" } });

  if (semesters.length === 0) {
    return (
      <main>
        <Seitenkopf titel="Noten & Zeugnisse" />
        <Inhalt>
          <LeererZustand
            icon="abschluss"
            titel="Noch ist kein Semester angelegt"
            aktion={
              <Link href="/verwaltung/semester" className={knopf("sekundaer")}>
                Zu den Semestern
              </Link>
            }
          />
        </Inhalt>
      </main>
    );
  }

  const laufend = semesters.find((s) => s.istAktuell);
  const gewaehltId = sp.semester ?? laufend?.id ?? semesters[0].id;
  const semester = semesters.find((s) => s.id === gewaehltId) ?? laufend ?? semesters[0];

  const kurseinheiten = await ladeNotenUebersicht(semester.id);

  return (
    <main>
      <Seitenkopf titel="Noten & Zeugnisse">
        <NotenZeugnisseFilter semesters={semesters} gewaehltId={semester.id} ansicht="noten" />
      </Seitenkopf>
      <Inhalt breite="mittel">
        {/* Neu je Semester: Ein Entwurf gehört zu den Schülern dieses Semesters. */}
        <NotenMatrix key={semester.id} semesterId={semester.id} kurseinheiten={kurseinheiten} endpunkt="/api/noten" />
      </Inhalt>
    </main>
  );
}
