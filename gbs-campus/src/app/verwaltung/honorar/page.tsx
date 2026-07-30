import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ladeMitRecht, hatRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { euro } from "@/lib/honorar";
import { ladeHonorarUebersicht } from "@/lib/honorar-io";

export const dynamic = "force-dynamic";

/**
 * Read-only Honorar-Übersicht je Semester: gehaltene Unterrichtsabende je Dozent,
 * jeder Abend zu dem Satz, der zu seinem Datum galt (Satz-Historie). Die
 * Genehmigung der Sätze läuft über die Unterseite „Sätze"; die Auszahlung folgt.
 */
export default async function HonorarSeite({
  searchParams,
}: {
  searchParams: Promise<{ semester?: string }>;
}) {
  const benutzer = await ladeMitRecht(RECHT.HONORAR_LESEN);
  if (!benutzer) redirect("/anmelden");

  const sp = await searchParams;
  const semesters = await prisma.semester.findMany({ orderBy: { start: "desc" } });

  if (semesters.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <Link href="/verwaltung" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Verwaltung
        </Link>
        <h1 className="mt-6 text-2xl font-bold tracking-tight">Dozentenhonorar</h1>
        <p className="mt-4 rounded-lg border border-border bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
          Noch ist kein Semester angelegt.
        </p>
      </main>
    );
  }

  const laufend = semesters.find((s) => s.istAktuell);
  const gewaehltId = sp.semester ?? laufend?.id ?? semesters[0].id;
  const semester = semesters.find((s) => s.id === gewaehltId) ?? semesters[0];

  const uebersicht = await ladeHonorarUebersicht(semester.id);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/verwaltung" className="text-sm text-muted-foreground underline underline-offset-4">
        ← Verwaltung
      </Link>
      <div className="mt-6 flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Dozentenhonorar</h1>
        {hatRecht(benutzer, RECHT.HONORAR_SATZ_GENEHMIGEN) && (
          <Link
            href="/verwaltung/honorar/saetze"
            className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:border-primary"
          >
            Sätze verwalten
          </Link>
        )}
      </div>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Gehaltene Unterrichtsabende je Dozent, jeder Abend zu dem Satz, der zu seinem Datum galt (aktuell
        {" "}
        {euro(uebersicht.aktuellerSatz)} je Abend). Nur zur Übersicht — die Auszahlung folgt in einem
        späteren Schritt. Die Sätze werden unter „Sätze verwalten" genehmigt; die Zuordnung der Dozenten
        läuft über den Stundenplan.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {semesters.map((s) => (
          <Link
            key={s.id}
            href={`/verwaltung/honorar?semester=${s.id}`}
            aria-current={s.id === semester.id ? "page" : undefined}
            className={`rounded-full px-3 py-1 text-sm ${
              s.id === semester.id
                ? "bg-primary text-primary-foreground"
                : "border border-border text-muted-foreground hover:border-primary"
            }`}
          >
            {s.bezeichnung}
          </Link>
        ))}
      </div>

      {uebersicht.zeilen.length === 0 ? (
        <p className="mt-8 rounded-lg border border-border bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
          In diesem Semester ist noch kein Abend einem Dozenten zugeordnet.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="bg-muted text-left text-xs uppercase tracking-[0.08em] text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-semibold">Dozent</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Abende</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Honorar</th>
              </tr>
            </thead>
            <tbody>
              {uebersicht.zeilen.map((z) => (
                <tr key={z.dozentId} className="border-t border-border">
                  <td className="px-4 py-2.5">{z.name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{z.abende}</td>
                  <td className="px-4 py-2.5 font-medium">{euro(z.betrag)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/50">
                <td className="px-4 py-2.5 font-semibold">Summe</td>
                <td className="px-4 py-2.5" />
                <td className="px-4 py-2.5 font-semibold">{euro(uebersicht.summe)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </main>
  );
}
