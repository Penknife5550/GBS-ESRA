import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { gruppiereRaster, halbjahrName, type Kurs } from "@/lib/faecher";
import { kurzTitel } from "@/lib/abendplan";
import { Abschnitt, Gruppe, Zeile } from "@/components/ui/liste";
import { Inhalt, Seitenkopf } from "@/components/ui/seitenkopf";
import { NeuesSemester } from "../semester/semester-aktionen";
import { SemesterUmschalter } from "../semester/semester-umschalter";

export const metadata = { title: "Kursraster" };
export const dynamic = "force-dynamic";

/**
 * Kursraster (unter „Semester“, Umschalter „Semester · Kursraster“): das feste
 * 3-Jahres-Raster der Schule — drei Lehrjahre mit je einem Herbst- und einem
 * Frühlingssemester — und die Fächer mit ihren Stunden. Nur zum Lesen; die
 * Pflege im Cockpit folgt später, hier wird der Seed-Stand sichtbar.
 */
export default async function FaecherSeite() {
  const benutzer = await ladeMitRecht(RECHT.SEMESTER_VERWALTEN);
  if (!benutzer) redirect("/anmelden");

  const [faecher, kurseinheiten] = await Promise.all([
    prisma.fach.findMany({ where: { aktiv: true }, orderBy: { sortierung: "asc" } }),
    prisma.kurseinheit.findMany({
      where: { aktiv: true },
      include: { fach: { select: { bezeichnung: true } } },
    }),
  ]);

  const kurse: (Kurs & { sortierung: number })[] = kurseinheiten.map((k) => ({
    fachCode: k.fachCode,
    fachBezeichnung: k.fach.bezeichnung,
    titel: k.titel,
    jahrgangsjahr: k.jahrgangsjahr,
    halbjahr: k.halbjahr,
    stunden: k.stunden,
    sortierung: k.sortierung,
  }));

  const raster = gruppiereRaster(kurse);

  return (
    <main>
      <Seitenkopf titel="Semester" aktionen={<NeuesSemester />}>
        <SemesterUmschalter aktiv="kursraster" />
      </Seitenkopf>
      <Inhalt breite="mittel">
        <Abschnitt titel="Kursraster" />
        <div className="flex flex-col gap-4">
          {raster.map((jahr) => (
            <section
              key={jahr.lehrjahr}
              aria-labelledby={`lehrjahr-${jahr.lehrjahr}`}
              className="overflow-hidden rounded-xl border border-linie bg-card"
            >
              <h3 id={`lehrjahr-${jahr.lehrjahr}`} className="border-b border-linie px-4 py-2.5 text-sm font-semibold">
                {`${jahr.lehrjahr}. Lehrjahr`}
              </h3>
              <div className="grid divide-y divide-linie sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                {jahr.halbjahre.map((hj) => (
                  <div key={hj.halbjahr} className="px-4 pb-1 pt-3">
                    <p className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-dezent">
                      {halbjahrName(hj.halbjahr)}
                    </p>
                    <ul className="divide-y divide-linie">
                      {hj.kurse.map((k) => (
                        <li key={k.titel} className="flex items-baseline justify-between gap-3 py-2.5">
                          <span className="min-w-0 text-sm">
                            <span className="font-medium text-foreground">{k.fachBezeichnung}</span>
                            {kurzTitel(k.fachBezeichnung, k.titel) && (
                              <span className="block text-[13px] text-muted-foreground">
                                {kurzTitel(k.fachBezeichnung, k.titel)}
                              </span>
                            )}
                          </span>
                          {k.stunden !== null && (
                            <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{`${k.stunden} Std.`}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <Abschnitt titel="Fächer" />
        <Gruppe>
          {faecher.map((f) => (
            <Zeile
              key={f.code}
              titel={f.bezeichnung}
              untertitel={f.beschreibung ?? undefined}
              rechts={
                f.gesamtstunden !== null ? (
                  <span className="text-sm tabular-nums text-muted-foreground">{`${f.gesamtstunden} Std.`}</span>
                ) : undefined
              }
            />
          ))}
        </Gruppe>
      </Inhalt>
    </main>
  );
}
