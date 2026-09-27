import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hatRecht, ladeMitRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { EXPORT_SPALTEN, abmeldegrundText, deutscherTag } from "@/lib/semester";
import {
  ladeTeilnehmer,
  teileNochNichtZugeordnete,
  zaehleAbgemeldete,
  type TeilnehmerZeile,
  type UebernahmeKandidat,
} from "@/lib/teilnehmerliste";
import { ZurueckLeiste } from "@/components/ui/zurueck-leiste";
import { LadeHinweis } from "@/components/ui/lade-hinweis";
import { UebernehmenKnopf } from "./uebernehmen-knopf";
import { EinzelnUebernehmenKnopf } from "./einzeln-uebernehmen-knopf";

export const metadata = { title: "Teilnehmerliste" };
export const dynamic = "force-dynamic";

const NIEMAND_OFFEN: { uebernehmbar: UebernahmeKandidat[]; zuletztAbgemeldet: UebernahmeKandidat[] } = {
  uebernehmbar: [],
  zuletztAbgemeldet: [],
};

export default async function TeilnehmerSeite() {
  const benutzer = await ladeMitRecht(RECHT.PERSON_LESEN_ALLE);
  if (!benutzer) redirect("/anmelden");

  const semester = await prisma.semester.findFirst({ where: { istAktuell: true } });

  const darfExportieren = hatRecht(benutzer, RECHT.PERSON_EXPORTIEREN);
  const darfSemesterVerwalten = hatRecht(benutzer, RECHT.SEMESTER_VERWALTEN);

  // Wer noch fehlt, braucht nur, wer übernehmen darf. Dieselbe Abfrage wie die
  // Sammelübernahme (`teileNochNichtZugeordnete`) — die Zahl ist genau die, die
  // der Knopf einlöst; die zuletzt Abgemeldeten stehen getrennt.
  const [zeilen, offen, abgemeldet] = await Promise.all([
    semester ? ladeTeilnehmer(semester.id) : Promise.resolve([] as TeilnehmerZeile[]),
    semester && darfSemesterVerwalten ? teileNochNichtZugeordnete(prisma, semester) : Promise.resolve(NIEMAND_OFFEN),
    semester ? zaehleAbgemeldete(semester.id) : Promise.resolve(0),
  ]);
  const ohneTeilnahme = offen.uebernehmbar.length;
  const zuletzt = offen.zuletztAbgemeldet;

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <ZurueckLeiste href="/verwaltung" label="Verwaltung" breadcrumb="Verwaltung · Teilnehmerliste" />

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

          {zuletzt.length > 0 && darfSemesterVerwalten && (
            <section aria-labelledby="zuletzt-abgemeldet" className="mt-6 rounded-lg border border-border px-4 py-4 text-sm">
              <h2 id="zuletzt-abgemeldet" className="font-medium">
                {`Zuletzt abgemeldet (bin raus / keine Rückmeldung): ${zuletzt.length} — einzeln übernehmen`}
              </h2>
              <p className="mt-1 max-w-prose text-xs text-muted-foreground">
                {zuletzt.length === 1 ? "Diese Person hat" : "Diese Personen haben"} für ihr letztes Semester
                abgesagt oder nicht geantwortet. Die Sammelübernahme lässt sie deshalb aus — übernehmen Sie
                einzeln, wer wieder dabei sein will.
              </p>
              <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
                {zuletzt.map((k) => {
                  // „Herbstsemester 2026: hat abgesagt („Ich bin raus“)"
                  const warum = `${k.zuletztAbgemeldet?.semester ?? ""}: ${abmeldegrundText(k.zuletztAbgemeldet?.grund)}`;
                  return (
                    <li key={k.personId} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <Link
                          href={`/verwaltung/personen/${k.personId}`}
                          className="font-medium text-foreground underline-offset-4 hover:underline"
                        >
                          {k.name}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{warum}</span>
                      </div>
                      {k.teilnahmeform ? (
                        <EinzelnUebernehmenKnopf
                          semesterId={semester.id}
                          personId={k.personId}
                          name={k.name}
                          semester={semester.bezeichnung}
                          warum={warum}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Keine Teilnahmeform hinterlegt — bitte zuerst in der Akte nachtragen.
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {abgemeldet > 0 && (
            <p className="mt-6 rounded-lg border border-border bg-muted px-4 py-3 text-sm">
              {abgemeldet} {abgemeldet === 1 ? "Person ist" : "Personen sind"} für dieses Semester abgemeldet
              („Ich bin raus“ oder keine Rückmeldung zur Semesterüberleitung) und{" "}
              {abgemeldet === 1 ? "steht" : "stehen"} deshalb nicht in der Liste.
              {darfSemesterVerwalten && (
                <>
                  {" "}
                  Wieder aufnehmen lässt sich einzeln unter{" "}
                  <Link href="/verwaltung/semesterueberleitung" className="underline underline-offset-4">
                    Semesterüberleitung
                  </Link>
                  .
                </>
              )}
            </p>
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
                                <LadeHinweis className="ml-2" />
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
