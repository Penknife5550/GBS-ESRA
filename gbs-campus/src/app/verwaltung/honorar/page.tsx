import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ladeMitRecht, hatRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { euro } from "@/lib/honorar";
import { ladeHonorarUebersicht } from "@/lib/honorar-io";
import { Inhalt, Seitenkopf } from "@/components/ui/seitenkopf";
import { knopf } from "@/components/ui/knopf";
import { Hinweis, LeererZustand } from "@/components/ui/hinweis";
import { LadeHinweis } from "@/components/ui/lade-hinweis";
import { SemesterWahl } from "./semester-wahl";

export const metadata = { title: "Dozentenhonorar" };
export const dynamic = "force-dynamic";

/**
 * Read-only Honorar-Übersicht je Semester: gehaltene Unterrichtsabende je Dozent,
 * jeder Abend zu dem Satz, der zu seinem Datum galt (Satz-Historie). Die
 * Genehmigung der Sätze läuft über die Unterseite „Sätze"; Abrechnen, Freigeben
 * (Zahlungsbeleg ans DMS) und das Festhalten der Auszahlung über „Abrechnungen".
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

  // Unterseiten als helle Knöpfe: Diese Seite liest nur, eine Hauptaktion hat sie nicht.
  const aktionen = (
    <>
      {hatRecht(benutzer, RECHT.HONORAR_SATZ_GENEHMIGEN) && (
        <Link href="/verwaltung/honorar/saetze" className={knopf("sekundaer")}>
          <span>
            Sätze
            <LadeHinweis className="ml-1.5" />
          </span>
        </Link>
      )}
      {hatRecht(benutzer, RECHT.HONORAR_ABRECHNEN) && (
        <Link href="/verwaltung/honorar/abrechnungen" className={knopf("sekundaer")}>
          <span>
            Abrechnungen
            <LadeHinweis className="ml-1.5" />
          </span>
        </Link>
      )}
    </>
  );

  if (semesters.length === 0) {
    return (
      <main>
        <Seitenkopf titel="Honorar" aktionen={aktionen} />
        <Inhalt breite="lesen">
          <LeererZustand icon="semester" titel="Noch ist kein Semester angelegt." />
        </Inhalt>
      </main>
    );
  }

  const laufend = semesters.find((s) => s.istAktuell);
  const gewaehltId = sp.semester ?? laufend?.id ?? semesters[0].id;
  const semester = semesters.find((s) => s.id === gewaehltId) ?? semesters[0];

  const uebersicht = await ladeHonorarUebersicht(semester.id);

  return (
    <main>
      <Seitenkopf titel="Honorar" aktionen={aktionen}>
        <SemesterWahl semesters={semesters} gewaehltId={semester.id} pfad="/verwaltung/honorar" />
      </Seitenkopf>
      <Inhalt breite="lesen">
        {uebersicht.zeilen.length === 0 ? (
          <LeererZustand icon="honorar" titel="Noch kein gehaltener Abend">
            In diesem Semester ist noch kein Abend einem Dozenten zugeordnet.
          </LeererZustand>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-linie text-left text-[11.5px] uppercase tracking-[0.06em] text-dezent">
                  <th scope="col" className="pb-2 pr-3 font-semibold">Dozent</th>
                  <th scope="col" className="px-3 pb-2 text-right font-semibold">Abende</th>
                  <th scope="col" className="pb-2 pl-3 text-right font-semibold">Honorar</th>
                </tr>
              </thead>
              <tbody>
                {uebersicht.zeilen.map((z) => (
                  <tr key={z.dozentId} className="border-b border-linie">
                    <td className="py-2.5 pr-3 font-medium">{z.name}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{z.abende}</td>
                    <td className="py-2.5 pl-3 text-right tabular-nums">{euro(z.betrag)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="py-2.5 pr-3 font-semibold">Summe</td>
                  <td className="px-3 py-2.5" />
                  <td className="py-2.5 pl-3 text-right font-semibold tabular-nums">{euro(uebersicht.summe)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <Hinweis className="mt-6">
          Jeder Abend zählt mit dem Satz, der an seinem Tag galt, derzeit {euro(uebersicht.aktuellerSatz)} je Abend.
          Abgerechnet, zur Auszahlung freigegeben und als ausgezahlt markiert wird unter „Abrechnungen“.
        </Hinweis>
      </Inhalt>
    </main>
  );
}
