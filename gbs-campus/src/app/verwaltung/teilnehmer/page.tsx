import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hatRecht, ladeMitRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { zahl } from "@/lib/einstellungen";
import { anwesenheitsStand } from "@/lib/heute";
import { giltAlsBestanden } from "@/lib/leistung";
import { abmeldegrundText, teilnahmeformName } from "@/lib/semester";
import {
  ladeTeilnehmer,
  teileNochNichtZugeordnete,
  zaehleAbgemeldete,
  type TeilnehmerZeile,
  type UebernahmeKandidat,
} from "@/lib/teilnehmerliste";
import { TEILNAHME_ZAEHLT } from "@/lib/teilnahme-filter";
import { Gruppe } from "@/components/ui/liste";
import { LeererZustand } from "@/components/ui/hinweis";
import { LadeHinweis } from "@/components/ui/lade-hinweis";
import { Inhalt } from "@/components/ui/seitenkopf";
import { PersonenKopf } from "../personen/personen-kopf";
import { PersonenTabelle, type PersonenZeile } from "../personen/personen-tabelle";
import { UebernehmenKnopf } from "./uebernehmen-knopf";
import { EinzelnUebernehmenKnopf } from "./einzeln-uebernehmen-knopf";

export const metadata = { title: "Personen" };
export const dynamic = "force-dynamic";

const NIEMAND_OFFEN: { uebernehmbar: UebernahmeKandidat[]; zuletztAbgemeldet: UebernahmeKandidat[] } = {
  uebernehmbar: [],
  zuletztAbgemeldet: [],
};

/**
 * Personen · Dieses Semester — die frühere Seite „Aktive dieses Semester“, seit
 * dem Oberflächenplan 09/2026 eine Ansicht der Personenliste (dieselbe Seite
 * zeigt /verwaltung/personen ohne `ansicht`). Die Adresse bleibt, weil Mails und
 * Lesezeichen auf sie zeigen.
 *
 * Die Zeilen sind genau die der Excel-Datei (`ladeTeilnehmer`, eine Abfrage für
 * beide Wege). Wer noch fehlt, zählt dieselbe Abfrage wie die Sammelübernahme
 * (`teileNochNichtZugeordnete`) — die Zahl ist genau die, die der Knopf
 * einlöst; die zuletzt Abgemeldeten stehen getrennt zum einzelnen Übernehmen.
 */
export default async function TeilnehmerSeite({ searchParams }: { searchParams: Promise<{ suche?: string }> }) {
  const benutzer = await ladeMitRecht(RECHT.PERSON_LESEN_ALLE);
  if (!benutzer) redirect("/anmelden");

  const begriff = (await searchParams).suche?.trim() ?? "";
  const semester = await prisma.semester.findFirst({ where: { istAktuell: true } });

  const darfExportieren = hatRecht(benutzer, RECHT.PERSON_EXPORTIEREN);
  const darfSemesterVerwalten = hatRecht(benutzer, RECHT.SEMESTER_VERWALTEN);
  // Noten nur für die pädagogische Sicht (NOTEN_VERWALTEN).
  const darfNoten = hatRecht(benutzer, RECHT.NOTEN_VERWALTEN);

  const jetzt = new Date();
  const [zeilen, offen, abgemeldet, gesamtTermine, vergangeneTermine, schwelle] = await Promise.all([
    semester ? ladeTeilnehmer(semester.id) : Promise.resolve([] as TeilnehmerZeile[]),
    semester && darfSemesterVerwalten ? teileNochNichtZugeordnete(prisma, semester) : Promise.resolve(NIEMAND_OFFEN),
    semester ? zaehleAbgemeldete(semester.id) : Promise.resolve(0),
    semester ? prisma.unterrichtstermin.count({ where: { semesterId: semester.id } }) : Promise.resolve(0),
    semester ? prisma.unterrichtstermin.count({ where: { semesterId: semester.id, beginn: { lte: jetzt } } }) : Promise.resolve(0),
    zahl("ANWESENHEIT_MINDEST_PROZENT"),
  ]);
  const ohneTeilnahme = offen.uebernehmbar.length;
  const zuletzt = offen.zuletztAbgemeldet;

  // Anwesenheit (vergangene Einheiten, Modell A) und Noten derselben Personen.
  const details =
    semester && zeilen.length > 0
      ? await prisma.teilnahme.findMany({
          where: { semesterId: semester.id, personId: { in: zeilen.map((z) => z.personId) }, ...TEILNAHME_ZAEHLT },
          select: {
            personId: true,
            person: { select: { statusCode: true } },
            anwesenheiten: { where: { termin: { beginn: { lte: jetzt } } }, select: { status: true } },
            leistungen: { select: { ergebnis: true } },
          },
        })
      : [];
  const detailVon = new Map(details.map((d) => [d.personId, d]));

  const suche = begriff.toLowerCase();
  const liste: PersonenZeile[] = zeilen
    .filter((z) => !suche || [z.vorname, z.nachname, z.email].some((wert) => wert.toLowerCase().includes(suche)))
    .map((z) => {
      const d = detailVon.get(z.personId);
      const stand = anwesenheitsStand(d?.anwesenheiten.map((a) => a.status) ?? [], vergangeneTermine, gesamtTermine, schwelle);
      return {
        id: z.personId,
        vorname: z.vorname,
        nachname: z.nachname,
        teilnahme: teilnahmeformName(z.teilnahmeform),
        ort: z.ort,
        anwesenheit: stand ? { text: stand.text, ton: stand.ton } : null,
        status: { code: d?.person.statusCode ?? "", bezeichnung: z.status },
        noten:
          darfNoten && d && d.leistungen.length > 0
            ? { bestanden: d.leistungen.filter((l) => giltAlsBestanden(l.ergebnis)).length, gesamt: d.leistungen.length }
            : null,
      };
    });

  return (
    <main>
      <PersonenKopf
        ansicht="semester"
        suche={begriff}
        semesterId={semester?.id ?? null}
        excelHref={semester && darfExportieren && zeilen.length > 0 ? `/api/semester/${semester.id}/export` : null}
        darfAnlegen={hatRecht(benutzer, RECHT.BENUTZER_VERWALTEN)}
      />
      <Inhalt>
        {!semester ? (
          <LeererZustand
            icon="semester"
            titel="Kein laufendes Semester"
            aktion={
              darfSemesterVerwalten ? (
                <Link href="/verwaltung/semester" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
                  Semester festlegen
                </Link>
              ) : undefined
            }
          >
            Solange kein Semester als laufend gesetzt ist, gibt es keine Liste.
          </LeererZustand>
        ) : (
          <>
            {ohneTeilnahme > 0 && darfSemesterVerwalten && <UebernehmenKnopf semesterId={semester.id} anzahl={ohneTeilnahme} />}

            {zuletzt.length > 0 && darfSemesterVerwalten && (
              <section aria-labelledby="zuletzt-abgemeldet" className="mb-5">
                <Gruppe>
                  <div className="px-4 py-3">
                    <h2 id="zuletzt-abgemeldet" className="text-sm font-semibold text-foreground">
                      {`Zuletzt abgemeldet (bin raus / keine Rückmeldung): ${zuletzt.length} — einzeln übernehmen`}
                    </h2>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">
                      {zuletzt.length === 1 ? "Diese Person hat" : "Diese Personen haben"} für das letzte Semester abgesagt
                      oder nicht geantwortet.
                      Übernehmen Sie einzeln, wer wieder dabei sein will.
                    </p>
                  </div>
                  {zuletzt.map((k) => {
                    // „Herbstsemester 2026: hat abgesagt („Ich bin raus“)“
                    const warum = `${k.zuletztAbgemeldet?.semester ?? ""}: ${abmeldegrundText(k.zuletztAbgemeldet?.grund)}`;
                    return (
                      <div key={k.personId} className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/verwaltung/personen/${k.personId}`}
                            className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
                          >
                            {k.name}
                            <LadeHinweis className="ml-2" />
                          </Link>
                          <span className="block text-[13px] text-muted-foreground">{warum}</span>
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
                          <span className="text-[13px] text-muted-foreground">Keine Teilnahmeform hinterlegt — bitte in der Akte nachtragen.</span>
                        )}
                      </div>
                    );
                  })}
                </Gruppe>
              </section>
            )}

            {begriff && (
              <p className="mb-3 flex flex-wrap items-center justify-end gap-3 text-[13px] text-muted-foreground">
                <span>
                  {liste.length} Treffer für „{begriff}“ in {semester.bezeichnung}
                </span>
                <Link href="/verwaltung/personen" className="font-medium text-primary underline-offset-4 hover:underline">
                  Suche aufheben
                </Link>
              </p>
            )}

            {liste.length === 0 ? (
              <LeererZustand icon="personen" titel={begriff ? "Niemand gefunden" : "Noch niemand in diesem Semester"}>
                {begriff ? "In diesem Semester passt niemand zur Suche." : `${semester.bezeichnung} ist noch niemand zugeordnet.`}
              </LeererZustand>
            ) : (
              <PersonenTabelle zeilen={liste} mitNoten={liste.some((z) => z.noten !== null)} beschriftung={`Teilnehmer ${semester.bezeichnung}`} />
            )}

            {abgemeldet > 0 && (
              <p className="mt-4 text-[13px] text-muted-foreground">
                {abgemeldet} {abgemeldet === 1 ? "Person ist" : "Personen sind"} für dieses Semester abgemeldet („Ich bin raus“
                oder keine Rückmeldung) und {abgemeldet === 1 ? "steht" : "stehen"} deshalb nicht in der Liste.
                {darfSemesterVerwalten && (
                  <>
                    {" "}
                    Wieder aufnehmen lässt sich einzeln unter{" "}
                    <Link href="/verwaltung/semesterueberleitung" className="font-medium text-primary underline-offset-4 hover:underline">
                      Semesterüberleitung
                    </Link>
                    .
                  </>
                )}
              </p>
            )}
          </>
        )}
      </Inhalt>
    </main>
  );
}
