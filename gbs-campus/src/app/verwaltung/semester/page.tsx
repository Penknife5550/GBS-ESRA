import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { alsTagText, deutscherTag } from "@/lib/semester";
import { TEILNAHME_ZAEHLT } from "@/lib/teilnahme-filter";
import { ZurueckLeiste } from "@/components/ui/zurueck-leiste";
import { SemesterFormular } from "./semester-formular";
import { SemesterZeile } from "./semester-zeile";

export const metadata = { title: "Semester" };
export const dynamic = "force-dynamic";

export default async function SemesterSeite() {
  const benutzer = await ladeMitRecht(RECHT.SEMESTER_VERWALTEN);
  if (!benutzer) redirect("/anmelden");

  const semester = await prisma.semester.findMany({
    orderBy: { start: "desc" },
    // Gezählt wird wie in der Teilnehmerliste: Für das Semester Abgemeldete
    // zählen nicht.
    include: { _count: { select: { teilnahmen: { where: TEILNAHME_ZAEHLT } } } },
  });

  const laufend = semester.find((s) => s.istAktuell);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <ZurueckLeiste href="/verwaltung" label="Verwaltung" breadcrumb="Verwaltung · Semester" />

      <h1 className="mt-6 text-2xl font-bold tracking-tight">Semester</h1>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Genau ein Semester läuft. Es bestimmt, wen die Teilnehmerliste zeigt und welchem Semester eine
        eingehende Anmeldung zugeordnet wird — außer ein anderes Semester hat gerade ein offenes
        Anmeldefenster, dann gilt dieses.
      </p>

      {!laufend && (
        <p className="mt-6 rounded-lg border border-border bg-credo-gelb/15 px-4 py-3 text-sm">
          Zurzeit ist kein Semester als laufend gesetzt. Solange das so ist, bleibt die Teilnehmerliste leer
          und neue Anmeldungen bekommen keinen Semesterbezug.
        </p>
      )}

      <h2 className="mt-10 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Neues Semester anlegen
      </h2>
      <div className="mt-4">
        <SemesterFormular mitAktuellSchalter />
      </div>

      <h2 className="mt-12 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Angelegte Semester
      </h2>

      {semester.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
          Noch ist kein Semester angelegt.
        </p>
      ) : (
        <ul className="mt-4 space-y-4">
          {semester.map((s) => (
            <SemesterZeile
              key={s.id}
              bisherLaufend={laufend?.bezeichnung ?? null}
              semester={{
                id: s.id,
                bezeichnung: s.bezeichnung,
                code: s.code,
                zeitraum: `${deutscherTag(s.start)} bis ${deutscherTag(s.ende)}`,
                anmeldefenster:
                  s.anmeldungVon || s.anmeldungBis
                    ? `${s.anmeldungVon ? deutscherTag(s.anmeldungVon) : "jederzeit"} bis ${
                        s.anmeldungBis ? deutscherTag(s.anmeldungBis) : "offen"
                      }`
                    : null,
                istAktuell: s.istAktuell,
                teilnehmer: s._count.teilnahmen,
                raster:
                  s.lehrjahr !== null && s.halbjahr !== null
                    ? `${s.lehrjahr}. Lehrjahr · ${s.halbjahr === 1 ? "Herbst" : "Frühling"}`
                    : null,
                felder: {
                  code: s.code,
                  bezeichnung: s.bezeichnung,
                  start: alsTagText(s.start),
                  ende: alsTagText(s.ende),
                  anmeldungVon: alsTagText(s.anmeldungVon),
                  anmeldungBis: alsTagText(s.anmeldungBis),
                  lehrjahr: s.lehrjahr !== null ? String(s.lehrjahr) : "",
                  halbjahr: s.halbjahr !== null ? String(s.halbjahr) : "",
                },
              }}
            />
          ))}
        </ul>
      )}
    </main>
  );
}
