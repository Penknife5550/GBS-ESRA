import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { euro } from "@/lib/honorar";
import { ladeAbrechnungsUebersicht, abrechnungStatusText } from "@/lib/honorar-abrechnung-io";
import { Inhalt, Seitenkopf } from "@/components/ui/seitenkopf";
import { LeererZustand } from "@/components/ui/hinweis";
import { LadeHinweis } from "@/components/ui/lade-hinweis";
import { AbrechnungStatusPunkt } from "../abrechnungs-status";
import { SemesterWahl } from "../semester-wahl";
import { AbrechnenKnopf } from "./abrechnen-knopf";

export const metadata = { title: "Honorar-Abrechnungen" };
export const dynamic = "force-dynamic";

export default async function AbrechnungenSeite({ searchParams }: { searchParams: Promise<{ semester?: string }> }) {
  const benutzer = await ladeMitRecht(RECHT.HONORAR_ABRECHNEN);
  if (!benutzer) redirect("/anmelden");

  const sp = await searchParams;
  const semesters = await prisma.semester.findMany({ orderBy: { start: "desc" } });
  const zurueck = { href: "/verwaltung/honorar", text: "Honorar" };

  if (semesters.length === 0) {
    return (
      <main>
        <Seitenkopf zurueck={zurueck} titel="Abrechnungen" />
        <Inhalt breite="lesen">
          <LeererZustand icon="semester" titel="Noch ist kein Semester angelegt." />
        </Inhalt>
      </main>
    );
  }

  const laufend = semesters.find((s) => s.istAktuell);
  const gewaehltId = sp.semester ?? laufend?.id ?? semesters[0].id;
  const semester = semesters.find((s) => s.id === gewaehltId) ?? semesters[0];

  const zeilen = await ladeAbrechnungsUebersicht(semester.id);

  return (
    <main>
      <Seitenkopf zurueck={zurueck} titel="Abrechnungen">
        <SemesterWahl semesters={semesters} gewaehltId={semester.id} pfad="/verwaltung/honorar/abrechnungen" />
      </Seitenkopf>
      <Inhalt breite="mittel">
        {zeilen.length === 0 ? (
          <LeererZustand icon="honorar" titel="Noch kein gehaltener Abend">
            In diesem Semester hat noch kein Dozent einen Abend gehalten.
          </LeererZustand>
        ) : (
          // Am Rechner eine Tabelle, am Handy wird jede Zeile ein Block mit Beschriftungen — so bleibt
          // „Abrechnen …“ im Bild, statt seitlich aus der Tabelle zu scrollen.
          <table className="block w-full text-sm lg:table">
            <thead className="hidden lg:table-header-group">
              <tr className="border-b border-linie text-left text-[11.5px] uppercase tracking-[0.06em] text-dezent">
                <th scope="col" className="pb-2 pr-3 font-semibold">Dozent</th>
                <th scope="col" className="px-3 pb-2 text-right font-semibold">Gehalten</th>
                <th scope="col" className="px-3 pb-2 font-semibold">Offen</th>
                <th scope="col" className="px-3 pb-2 font-semibold">Abrechnungen</th>
                <th scope="col" className="pb-2 pl-3 font-semibold">
                  <span className="sr-only">Aktion</span>
                </th>
              </tr>
            </thead>
            <tbody className="block lg:table-row-group">
              {zeilen.map((z) => (
                <tr
                  key={z.dozentId}
                  className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 border-b border-linie py-3 first:pt-0 lg:table-row lg:py-0"
                >
                  <td className="w-full font-semibold lg:w-auto lg:py-3 lg:pr-3 lg:font-medium">{z.name}</td>
                  <td className="text-muted-foreground lg:px-3 lg:py-3 lg:text-right lg:tabular-nums">
                    {z.gehalten}
                    <span className="lg:hidden"> gehalten</span>
                  </td>
                  <td className="lg:px-3 lg:py-3">
                    <span className="text-muted-foreground lg:hidden">· offen: </span>
                    {z.offenAbende > 0 ? (
                      <span className="whitespace-nowrap">
                        {z.offenAbende === 1 ? "1 Abend" : `${z.offenAbende} Abende`} ·{" "}
                        <span className="font-medium tabular-nums">{euro(z.offenBetrag)}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className={`w-full lg:w-auto lg:px-3 lg:py-3 ${z.abrechnungen.length === 0 ? "hidden lg:table-cell" : ""}`}>
                    {z.abrechnungen.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <ul className="flex flex-col gap-1.5">
                        {z.abrechnungen.map((a) => (
                          <li key={a.id}>
                            <Link
                              href={`/verwaltung/honorar/abrechnungen/${a.id}`}
                              className="rounded-md hover:underline hover:underline-offset-4"
                            >
                              <AbrechnungStatusPunkt status={a.status}>
                                {abrechnungStatusText(a.status)} · {euro(a.summe)}
                              </AbrechnungStatusPunkt>
                              <LadeHinweis className="ml-2" />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className={`w-full lg:w-auto lg:py-2 lg:pl-3 lg:text-right ${z.offenAbende > 0 ? "" : "hidden lg:table-cell"}`}>
                    {z.offenAbende > 0 && (
                      <AbrechnenKnopf
                        dozentId={z.dozentId}
                        semesterId={semester.id}
                        dozentName={z.name}
                        abende={z.offenAbende}
                        summe={z.offenBetrag}
                        betrag={euro(z.offenBetrag)}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Inhalt>
    </main>
  );
}
