import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hatRecht, ladeMitRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { zahl } from "@/lib/einstellungen";
import { quoteJeTeilnahme, terminText } from "@/lib/stundenplan";
import { terminVergangen } from "@/lib/selbstbestaetigung";
import { ladeDozenten } from "@/lib/honorar-io";
import { PERSON_ZAEHLT_AKTIV, TEILNAHME_ZAEHLT } from "@/lib/teilnahme-filter";
import { QUOTE_STIL, QuoteChip } from "@/components/ui/quote-ampel";
import { ZurueckLeiste } from "@/components/ui/zurueck-leiste";
import { StundenplanClient } from "./stundenplan-client";

export const metadata = { title: "Stundenplan" };
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
        <ZurueckLeiste href="/verwaltung" label="Verwaltung" breadcrumb="Verwaltung · Stundenplan" />
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

  // Die Quoten-Tabelle unten rechnet aus denselben Daten wie die Erfassung
  // (Abende, Teilnehmer, Anwesenheit) — keine zweite Abfrage derselben Zeilen.
  const [termineRoh, teilnehmerRoh, kurseinheitenRoh, dozenten, anwesenheitRoh, schwelle] = await Promise.all([
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
        // Ein abgerechneter Abend ist für Dozentenwechsel und Löschen gesperrt
        // (409 in der Termin-Route) — die Seite zeigt das vorher an.
        abrechnungPosten: { select: { abrechnungId: true, abrechnung: { select: { status: true } } } },
      },
    }),
    // Die Zeilen der Erfassung: aktive, für das Semester nicht abgemeldete
    // Teilnehmer — dieselbe Menge wie die Quoten-Übersicht darunter.
    prisma.teilnahme.findMany({
      where: { semesterId: semester.id, ...TEILNAHME_ZAEHLT, person: PERSON_ZAEHLT_AKTIV },
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
    zahl("ANWESENHEIT_MINDEST_PROZENT"),
  ]);

  const termine = termineRoh.map((t) => ({
    id: t.id,
    text: terminText(t.beginn),
    kurseinheitId: t.kurseinheitId,
    kurseinheitTitel: t.kurseinheit?.titel ?? null,
    dozentId: t.dozentId,
    anwesenheitAnzahl: t._count.anwesenheiten,
    abrechnung: t.abrechnungPosten
      ? { id: t.abrechnungPosten.abrechnungId, status: t.abrechnungPosten.abrechnung.status }
      : null,
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

  // Modell A wie in Personen- und Schüler-Akte: Teilnahmen der vergangenen
  // Abende gegen ALLE Abende des Semesters (eine Quote, nicht drei).
  const jetzt = new Date();
  const quotenAbende = termineRoh.map((t) => ({ id: t.id, istVergangen: terminVergangen(t.beginn, jetzt) }));
  const quoten = teilnehmer.map((t) => ({
    ...t,
    quote: quoteJeTeilnahme(quotenAbende, anwesenheit, t.teilnahmeId, schwelle),
  }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <ZurueckLeiste href="/verwaltung" label="Verwaltung" breadcrumb="Verwaltung · Stundenplan" />
      <h1 className="mt-6 text-2xl font-bold tracking-tight">Stundenplan</h1>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Die Unterrichtsabende eines Semesters und die Anwesenheit. Die Quote rechnet wie in der Personenakte
        über alle Abende des Semesters: Anwesend und nachgearbeitet zählen als Teilnahme, noch nicht erfasste
        und künftige Abende als offen. Nötig sind {schwelle}&nbsp;%.
      </p>

      <StundenplanClient
        semesters={semesters.map((s) => ({ id: s.id, bezeichnung: s.bezeichnung }))}
        gewaehltId={semester.id}
        termine={termine}
        teilnehmer={teilnehmer}
        kurseinheiten={kurseinheiten}
        dozenten={dozenten}
        anwesenheit={anwesenheit}
        darfHonorar={hatRecht(benutzer, RECHT.HONORAR_ABRECHNEN)}
      />

      <h2 className="mt-12 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Anwesenheitsquote
      </h2>
      {quoten.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
          Für dieses Semester sind keine aktiven Teilnehmer eingetragen.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="bg-muted text-left text-xs uppercase tracking-[0.08em] text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Teilnehmer</th>
                <th className="px-4 py-2.5 font-semibold">Erfasst</th>
                <th className="px-4 py-2.5 font-semibold">Quote</th>
              </tr>
            </thead>
            <tbody>
              {quoten.map((z) => (
                <tr key={z.teilnahmeId} className="border-t border-border">
                  <td className="px-4 py-2.5">{z.name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {z.quote.teilgenommen} teilgenommen · {z.quote.versaeumt} versäumt
                  </td>
                  <td className="px-4 py-2.5">
                    {/* QuoteChip: Zeichen + „X/Y" mit Tint, Text in Vordergrundfarbe
                        (kein Rot auf Rot); das Wort dahinter wiederholt den Zustand
                        für Sehende — der Chip nennt ihn Screenreadern schon. */}
                    <QuoteChip quote={z.quote} />
                    <span aria-hidden="true" className="ml-2 text-xs text-muted-foreground">
                      {QUOTE_STIL[z.quote.zustand].label}
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
