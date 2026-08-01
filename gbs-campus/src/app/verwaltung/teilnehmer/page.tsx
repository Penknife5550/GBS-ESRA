import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hatRecht, ladeMitRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { EXPORT_SPALTEN, deutscherTag } from "@/lib/semester";
import { ladeTeilnehmer, zaehleOhneTeilnahme } from "@/lib/teilnehmerliste";
import { UebernehmenKnopf } from "./uebernehmen-knopf";

export const dynamic = "force-dynamic";

export default async function TeilnehmerSeite() {
  const benutzer = await ladeMitRecht(RECHT.PERSON_LESEN_ALLE);
  if (!benutzer) redirect("/anmelden");

  const semester = await prisma.semester.findFirst({ where: { istAktuell: true } });

  const zeilen = semester ? await ladeTeilnehmer(semester.id) : [];
  const ohneTeilnahme = semester ? await zaehleOhneTeilnahme(semester.id) : 0;

  const darfExportieren = hatRecht(benutzer, RECHT.PERSON_EXPORTIEREN);
  const darfSemesterVerwalten = hatRecht(benutzer, RECHT.SEMESTER_VERWALTEN);

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <Link href="/verwaltung" className="text-sm text-muted-foreground underline underline-offset-4">
        ← Verwaltung
      </Link>

      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Aktive dieses Semester</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {semester
              ? `${semester.bezeichnung} · ${deutscherTag(semester.start)} bis ${deutscherTag(semester.ende)}`
              : "Kein laufendes Semester gesetzt."}
          </p>
        </div>

        {semester && darfExportieren && zeilen.length > 0 && (
          <a
            href={`/api/semester/${semester.id}/export`}
            className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Als Excel-Datei herunterladen
          </a>
        )}
      </div>

      {!semester ? (
        <p className="mt-10 rounded-lg border border-border bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
          Solange kein Semester als laufend gesetzt ist, gibt es keine Liste.
          {darfSemesterVerwalten && (
            <>
              {" "}
              <Link href="/verwaltung/semester" className="underline underline-offset-4">
                Semester anlegen
              </Link>
              .
            </>
          )}
        </p>
      ) : (
        <>
          {ohneTeilnahme > 0 && darfSemesterVerwalten && (
            <UebernehmenKnopf semesterId={semester.id} anzahl={ohneTeilnahme} />
          )}

          {zeilen.length === 0 ? (
            <p className="mt-10 rounded-lg border border-border bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
              Diesem Semester ist noch niemand zugeordnet.
            </p>
          ) : (
            <>
              <p className="mt-8 text-sm text-muted-foreground">
                {zeilen.length} {zeilen.length === 1 ? "Person" : "Personen"}
              </p>

              {/* Die Tabelle rollt in ihrem eigenen Rahmen — die Seite selbst
                  darf auf dem Telefon nicht seitlich verrutschen. */}
              <div className="mt-3 overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[52rem] text-left text-sm">
                  <caption className="sr-only">
                    Teilnehmer des laufenden Semesters — {semester.bezeichnung}
                  </caption>
                  <thead className="bg-muted">
                    <tr>
                      {EXPORT_SPALTEN.map((spalte) => (
                        <th key={spalte.titel} scope="col" className="whitespace-nowrap px-4 py-2.5 font-medium">
                          {spalte.titel}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {zeilen.map((zeile) => (
                      <tr key={zeile.personId} className="border-t border-border transition-colors hover:bg-muted/40">
                        {EXPORT_SPALTEN.map((spalte) => (
                          <td key={spalte.titel} className="whitespace-nowrap px-4 py-2.5">
                            {/* Die Namensspalte führt in die Detailakte; der Rest bleibt
                                Text. Die Link-Logik lebt hier in der Seite, nicht in
                                EXPORT_SPALTEN — sonst bräche der Excel-Export. */}
                            {spalte.titel === "Nachname" ? (
                              <Link
                                href={`/verwaltung/personen/${zeile.personId}`}
                                className="font-medium text-foreground underline-offset-4 hover:underline"
                              >
                                {spalte.wert(zeile) || "—"}
                              </Link>
                            ) : (
                              spalte.wert(zeile) || "—"
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="mt-4 max-w-prose text-xs text-muted-foreground">
                Die Bankverbindung steht bewusst weder in dieser Liste noch in der Excel-Datei. Sie ist in der
                Anmeldeansicht einzeln abrufbar, und jeder Abruf wird protokolliert.
              </p>
            </>
          )}
        </>
      )}
    </main>
  );
}
