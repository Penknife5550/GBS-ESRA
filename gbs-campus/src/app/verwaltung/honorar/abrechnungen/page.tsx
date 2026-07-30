import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { euro } from "@/lib/honorar";
import { ladeAbrechnungsUebersicht, abrechnungStatusText } from "@/lib/honorar-abrechnung-io";
import type { HonorarAbrechnungStatus } from "@prisma/client";
import { AbrechnenKnopf } from "./abrechnen-knopf";

export const dynamic = "force-dynamic";

const BADGE: Record<HonorarAbrechnungStatus, string> = {
  OFFEN: "bg-credo-gelb/15 text-foreground",
  FREIGEGEBEN: "bg-credo-blau/15 text-foreground",
  AUSGEZAHLT: "bg-credo-gruen/15 text-foreground",
};

export default async function AbrechnungenSeite({ searchParams }: { searchParams: Promise<{ semester?: string }> }) {
  const benutzer = await ladeMitRecht(RECHT.HONORAR_ABRECHNEN);
  if (!benutzer) redirect("/anmelden");

  const sp = await searchParams;
  const semesters = await prisma.semester.findMany({ orderBy: { start: "desc" } });

  if (semesters.length === 0) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12">
        <Link href="/verwaltung/honorar" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Dozentenhonorar
        </Link>
        <h1 className="mt-6 text-2xl font-bold tracking-tight">Honorar-Abrechnungen</h1>
        <p className="mt-4 rounded-lg border border-border bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
          Noch ist kein Semester angelegt.
        </p>
      </main>
    );
  }

  const laufend = semesters.find((s) => s.istAktuell);
  const gewaehltId = sp.semester ?? laufend?.id ?? semesters[0].id;
  const semester = semesters.find((s) => s.id === gewaehltId) ?? semesters[0];

  const zeilen = await ladeAbrechnungsUebersicht(semester.id);

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link href="/verwaltung/honorar" className="text-sm text-muted-foreground underline underline-offset-4">
        ← Dozentenhonorar
      </Link>
      <h1 className="mt-6 text-2xl font-bold tracking-tight">Honorar-Abrechnungen</h1>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Je Dozent die gehaltenen Abende, davon die noch offenen (nicht abgerechneten), und die bestehenden
        Abrechnungen mit Status. „Abrechnen" fasst alle offenen Abende des Dozenten in diesem Semester zu
        einer Abrechnung zusammen und friert die Beträge ein.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {semesters.map((s) => (
          <Link
            key={s.id}
            href={`/verwaltung/honorar/abrechnungen?semester=${s.id}`}
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

      {zeilen.length === 0 ? (
        <p className="mt-8 rounded-lg border border-border bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
          In diesem Semester hat noch kein Dozent einen Abend gehalten.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted text-left text-xs uppercase tracking-[0.08em] text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-semibold">Dozent</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Gehalten</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Offen</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Abrechnungen</th>
                <th scope="col" className="px-4 py-2.5 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {zeilen.map((z) => (
                <tr key={z.dozentId} className="border-t border-border align-top">
                  <td className="px-4 py-2.5 font-medium">{z.name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{z.gehalten}</td>
                  <td className="px-4 py-2.5">
                    {z.offenAbende > 0 ? (
                      <span>
                        {z.offenAbende} Abende · <span className="font-medium">{euro(z.offenBetrag)}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {z.abrechnungen.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {z.abrechnungen.map((a) => (
                          <Link
                            key={a.id}
                            href={`/verwaltung/honorar/abrechnungen/${a.id}`}
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium hover:underline ${BADGE[a.status]}`}
                          >
                            {abrechnungStatusText(a.status)} · {euro(a.summe)}
                          </Link>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {z.offenAbende > 0 && (
                      <AbrechnenKnopf dozentId={z.dozentId} semesterId={semester.id} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
