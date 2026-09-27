import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { ladeNotenUebersicht } from "@/lib/leistung-io";
import { ZurueckLeiste } from "@/components/ui/zurueck-leiste";
import { NotenMatrix } from "@/components/noten/noten-matrix";
import { SemesterWahl } from "./semesterwahl";

export const metadata = { title: "Noten" };
export const dynamic = "force-dynamic";

/**
 * Notenverwaltung der Schulleitung (Recht NOTEN_VERWALTEN, alle Fächer). Je
 * Semester die unterrichteten Kurseinheiten mit ihren aktiven Teilnehmern und
 * den bereits erfassten Bewertungen.
 */
export default async function NotenSeite({
  searchParams,
}: {
  searchParams: Promise<{ semester?: string }>;
}) {
  const benutzer = await ladeMitRecht(RECHT.NOTEN_VERWALTEN);
  if (!benutzer) redirect("/anmelden");

  const sp = await searchParams;
  const semesters = await prisma.semester.findMany({ orderBy: { start: "desc" } });

  if (semesters.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <ZurueckLeiste href="/verwaltung" label="Verwaltung" breadcrumb="Verwaltung · Noten" />
        <h1 className="mt-6 text-2xl font-bold tracking-tight">Noten</h1>
        <p className="mt-4 rounded-lg border border-border bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
          Noch ist kein Semester angelegt.
        </p>
      </main>
    );
  }

  const laufend = semesters.find((s) => s.istAktuell);
  const gewaehltId = sp.semester ?? laufend?.id ?? semesters[0].id;
  const semester = semesters.find((s) => s.id === gewaehltId) ?? semesters[0];

  const kurseinheiten = await ladeNotenUebersicht(semester.id);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <ZurueckLeiste href="/verwaltung" label="Verwaltung" breadcrumb="Verwaltung · Noten" />
      <h1 className="mt-6 text-2xl font-bold tracking-tight">Noten</h1>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Bewertung je Fach eines Semesters. Pflicht ist nur das Ergebnis (teilgenommen, erfolgreich
        teilgenommen, bestanden, nicht bestanden); Punkte und Note sind optional — real wird nur die
        Bibelkunde benotet, der Rest verbal. Hörer stehen hier nicht: Sie werden nicht benotet und bekommen
        eine Teilnahmebescheinigung. Für das Semester Abgemeldete fehlen ebenfalls.
      </p>

      <div className="mt-6">
        <SemesterWahl
          semesters={semesters.map((s) => ({ id: s.id, bezeichnung: s.bezeichnung }))}
          gewaehltId={semester.id}
        />
      </div>

      <div className="mt-8">
        <NotenMatrix semesterId={semester.id} kurseinheiten={kurseinheiten} endpunkt="/api/noten" />
      </div>
    </main>
  );
}
