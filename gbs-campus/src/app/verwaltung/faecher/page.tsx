import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { gruppiereRaster, halbjahrName, type Kurs } from "@/lib/faecher";

export const dynamic = "force-dynamic";

/**
 * Read-only-Ansicht des Kursrasters (Fächer & Kurseinheiten) — der Grundstein
 * für den Stundenplan (M3). Die Pflege im Cockpit folgt später; hier wird der
 * Seed-Stand sichtbar gemacht.
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
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/verwaltung" className="text-sm text-muted-foreground underline underline-offset-4">
        ← Verwaltung
      </Link>

      <h1 className="mt-6 text-2xl font-bold tracking-tight">Fächer &amp; Kursraster</h1>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Das feste 3-Jahres-Raster der Gemeindebibelschule: drei Lehrjahre, je ein Herbst- und ein
        Frühlingssemester. Grundlage für den Stundenplan — die Pflege im Cockpit folgt später.
      </p>

      <h2 className="mt-10 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Fächer
      </h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {faecher.map((f) => (
          <li key={f.code} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold">{f.bezeichnung}</span>
              {f.gesamtstunden !== null && (
                <span className="text-xs text-muted-foreground">{f.gesamtstunden} Std.</span>
              )}
            </div>
            {f.beschreibung && <p className="mt-1 text-sm text-muted-foreground">{f.beschreibung}</p>}
          </li>
        ))}
      </ul>

      <h2 className="mt-12 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Kursraster
      </h2>
      <div className="mt-4 space-y-6">
        {raster.map((jahr) => (
          <div key={jahr.lehrjahr} className="rounded-lg border border-border bg-card p-5">
            <h3 className="font-semibold">{jahr.lehrjahr}. Lehrjahr</h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {jahr.halbjahre.map((hj) => (
                <div key={hj.halbjahr}>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {halbjahrName(hj.halbjahr)}
                  </p>
                  <ul className="mt-2 space-y-1.5 text-sm">
                    {hj.kurse.map((k) => (
                      <li key={k.titel} className="rounded-lg bg-muted px-3 py-2">
                        <span>{k.titel}</span>
                        {k.stunden !== null && (
                          <span className="text-muted-foreground"> · {k.stunden} Std.</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
