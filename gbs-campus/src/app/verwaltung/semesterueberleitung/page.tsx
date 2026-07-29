import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { zahl } from "@/lib/einstellungen";
import { semesterZeitraum } from "@/lib/semester";
import { UeberleitungStarten } from "./ueberleitung-starten";

export const dynamic = "force-dynamic";

export default async function SemesterueberleitungSeite() {
  const benutzer = await ladeMitRecht(RECHT.SEMESTER_VERWALTEN);
  if (!benutzer) redirect("/anmelden");

  const [semester, bestaetigtRows, offenRows, o1, o2, o3] = await Promise.all([
    prisma.semester.findMany({ orderBy: { start: "asc" } }),
    prisma.teilnahme.groupBy({ by: ["semesterId"], where: { bestaetigtAm: { not: null } }, _count: true }),
    prisma.teilnahme.groupBy({
      by: ["semesterId"],
      where: { bestaetigtAm: null, bestaetigungTokenHash: { not: null } },
      _count: true,
    }),
    zahl("SEMESTER_ERINNERUNG_1_TAGE"),
    zahl("SEMESTER_ERINNERUNG_2_TAGE"),
    zahl("SEMESTER_ERINNERUNG_3_TAGE"),
  ]);

  const bestaetigtMap = new Map(bestaetigtRows.map((r) => [r.semesterId, r._count]));
  const offenMap = new Map(offenRows.map((r) => [r.semesterId, r._count]));

  const laufend = semester.find((s) => s.istAktuell);

  const ziele = semester
    .filter((s) => s.id !== laufend?.id)
    .map((s) => ({ id: s.id, bezeichnung: s.bezeichnung, zeitraum: semesterZeitraum(s.start, s.ende) }));

  // Semester, für die schon eingeladen wurde (offen oder bestätigt) — der Stand
  // der Rückmeldungen.
  const staende = semester
    .map((s) => {
      const bestaetigt = bestaetigtMap.get(s.id) ?? 0;
      const offen = offenMap.get(s.id) ?? 0;
      return { id: s.id, bezeichnung: s.bezeichnung, zeitraum: semesterZeitraum(s.start, s.ende), bestaetigt, offen };
    })
    .filter((s) => s.bestaetigt + s.offen > 0);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/verwaltung" className="text-sm text-muted-foreground underline underline-offset-4">
        ← Verwaltung
      </Link>

      <h1 className="mt-6 text-2xl font-bold tracking-tight">Semesterüberleitung</h1>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Lädt den Jahrgang des laufenden Semesters ins Folgesemester ein: Jeder aktive Teilnehmer bekommt
        eine Einladung mit einem persönlichen „Ich bin dabei"-Link. Wer nicht zusagt, wird{" "}
        {o1}, {o2} und {o3} Tage vor Semesterstart automatisch erinnert.
      </p>

      {!laufend ? (
        <p className="mt-6 rounded-lg border border-border bg-credo-gelb/15 px-4 py-3 text-sm">
          Zurzeit ist kein Semester als laufend gesetzt. Die Überleitung geht immer vom laufenden
          Semester aus — bitte zuerst unter{" "}
          <Link href="/verwaltung/semester" className="underline underline-offset-2">
            Semester
          </Link>{" "}
          das aktuelle Semester festlegen.
        </p>
      ) : (
        <>
          <h2 className="mt-10 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Überleitung starten
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Aus dem laufenden Semester <span className="font-medium text-foreground">{laufend.bezeichnung}</span>{" "}
            in ein Folgesemester. Ein zweiter Start lädt niemanden doppelt ein.
          </p>
          <div className="mt-4">
            <UeberleitungStarten ziele={ziele} laufend={laufend.bezeichnung} />
          </div>
        </>
      )}

      <h2 className="mt-12 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Stand der Rückmeldungen
      </h2>
      {staende.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
          Noch wurde für kein Semester eine Überleitung gestartet.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {staende.map((s) => {
            const gesamt = s.bestaetigt + s.offen;
            return (
              <li key={s.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{s.bezeichnung}</span>
                  <span className="text-xs text-muted-foreground">{s.zeitraum}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 font-medium">
                    {gesamt} eingeladen
                  </span>
                  <span className="inline-flex rounded-full bg-credo-gruen/15 px-2.5 py-0.5 font-medium">
                    {s.bestaetigt} bestätigt
                  </span>
                  <span className="inline-flex rounded-full bg-credo-gelb/20 px-2.5 py-0.5 font-medium">
                    {s.offen} offen
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
