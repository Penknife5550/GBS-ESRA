import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { terminText } from "@/lib/stundenplan";
import { ladeAnwesenheitsUebersicht } from "@/lib/stundenplan-io";
import { ladeDozenten } from "@/lib/honorar-io";
import { StundenplanClient } from "./stundenplan-client";

export const dynamic = "force-dynamic";

export default async function StundenplanSeite({
  searchParams,
}: {
  searchParams: Promise<{ semester?: string }>;
}) {
  const benutzer = await ladeMitRecht(RECHT.SEMESTER_VERWALTEN);
  if (!benutzer) redirect("/anmelden");

  const sp = await searchParams;
  const semesters = await prisma.semester.findMany({ orderBy: { start: "desc" } });

  if (semesters.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <Link href="/verwaltung" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Verwaltung
        </Link>
        <h1 className="mt-6 text-2xl font-bold tracking-tight">Stundenplan</h1>
        <p className="mt-4 rounded-lg border border-border bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
          Noch ist kein Semester angelegt.
        </p>
      </main>
    );
  }

  const laufend = semesters.find((s) => s.istAktuell);
  const gewaehltId = sp.semester ?? laufend?.id ?? semesters[0].id;
  const semester = semesters.find((s) => s.id === gewaehltId) ?? semesters[0];

  const [termineRoh, teilnehmerRoh, kurseinheitenRoh, dozenten, anwesenheitRoh, uebersicht] = await Promise.all([
    prisma.unterrichtstermin.findMany({
      where: { semesterId: semester.id },
      orderBy: { beginn: "asc" },
      select: {
        id: true,
        beginn: true,
        kurseinheitId: true,
        kurseinheit: { select: { titel: true } },
        dozentId: true,
        _count: { select: { anwesenheiten: true } },
      },
    }),
    prisma.teilnahme.findMany({
      where: { semesterId: semester.id, person: { status: { istAktiv: true } } },
      orderBy: [{ person: { nachname: "asc" } }, { person: { vorname: "asc" } }],
      select: { id: true, person: { select: { vorname: true, nachname: true } } },
    }),
    prisma.kurseinheit.findMany({
      where: {
        aktiv: true,
        ...(semester.lehrjahr !== null && semester.halbjahr !== null
          ? { jahrgangsjahr: semester.lehrjahr, halbjahr: semester.halbjahr }
          : {}),
      },
      orderBy: { sortierung: "asc" },
      select: { id: true, titel: true, fach: { select: { bezeichnung: true } } },
    }),
    ladeDozenten(),
    prisma.anwesenheit.findMany({
      where: { termin: { semesterId: semester.id } },
      select: { terminId: true, teilnahmeId: true, status: true },
    }),
    ladeAnwesenheitsUebersicht(semester.id),
  ]);

  const termine = termineRoh.map((t) => ({
    id: t.id,
    text: terminText(t.beginn),
    kurseinheitId: t.kurseinheitId,
    kurseinheitTitel: t.kurseinheit?.titel ?? null,
    dozentId: t.dozentId,
    anwesenheitAnzahl: t._count.anwesenheiten,
  }));
  const teilnehmer = teilnehmerRoh.map((t) => ({
    teilnahmeId: t.id,
    name: `${t.person.nachname}, ${t.person.vorname}`,
  }));
  const kurseinheiten = kurseinheitenRoh.map((k) => ({ id: k.id, label: `${k.fach.bezeichnung} — ${k.titel}` }));
  const anwesenheit: Record<string, Record<string, string>> = {};
  for (const a of anwesenheitRoh) {
    (anwesenheit[a.terminId] ??= {})[a.teilnahmeId] = a.status;
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/verwaltung" className="text-sm text-muted-foreground underline underline-offset-4">
        ← Verwaltung
      </Link>
      <h1 className="mt-6 text-2xl font-bold tracking-tight">Stundenplan</h1>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Die Unterrichtsabende eines Semesters und die Anwesenheit. Für die Quote zählen anwesend und
        nachgearbeitet als Teilnahme; unter {uebersicht.schwelle}&nbsp;% wird sie markiert.
      </p>

      <StundenplanClient
        semesters={semesters.map((s) => ({ id: s.id, bezeichnung: s.bezeichnung }))}
        gewaehltId={semester.id}
        termine={termine}
        teilnehmer={teilnehmer}
        kurseinheiten={kurseinheiten}
        dozenten={dozenten}
        anwesenheit={anwesenheit}
      />

      <h2 className="mt-12 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Anwesenheitsquote
      </h2>
      {uebersicht.zeilen.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
          Für dieses Semester sind keine aktiven Teilnehmer eingetragen.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="bg-muted text-left text-xs uppercase tracking-[0.08em] text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Teilnehmer</th>
                <th className="px-4 py-2.5 font-semibold">Teilgenommen</th>
                <th className="px-4 py-2.5 font-semibold">Quote</th>
              </tr>
            </thead>
            <tbody>
              {uebersicht.zeilen.map((z) => (
                <tr key={z.teilnahmeId} className="border-t border-border">
                  <td className="px-4 py-2.5">{z.name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {z.quote.teilgenommen} von {z.quote.gesamt}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        z.quote.erfuellt ? "bg-credo-gruen/15" : "bg-credo-rot/10 text-credo-rot"
                      }`}
                    >
                      {z.quote.prozent}&nbsp;%
                    </span>
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
