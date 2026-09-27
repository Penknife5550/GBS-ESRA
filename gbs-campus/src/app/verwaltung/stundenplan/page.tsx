import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hatRecht, ladeMitRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { tagKurz } from "@/lib/datum";
import { zahl } from "@/lib/einstellungen";
import { quoteJeTeilnahme, terminText } from "@/lib/stundenplan";
import { terminVergangen } from "@/lib/selbstbestaetigung";
import { ladeDozenten } from "@/lib/honorar-io";
import { PERSON_ZAEHLT_AKTIV, TEILNAHME_ZAEHLT } from "@/lib/teilnahme-filter";
import { abendTitel, einheitStand, gruppiereAbende, pauseText, zeitspanne } from "@/lib/abendplan";
import { QUOTE_STIL, QuoteChip } from "@/components/ui/quote-ampel";
import { Inhalt, Seitenkopf } from "@/components/ui/seitenkopf";
import { LeererZustand } from "@/components/ui/hinweis";
import { Abschnitt } from "@/components/ui/liste";
import { knopf } from "@/components/ui/knopf";
import { SemesterWahl } from "../noten/semesterwahl";
import { StundenplanClient, type AbendAnzeige } from "./stundenplan-client";

export const metadata = { title: "Unterricht" };
export const dynamic = "force-dynamic";

/**
 * Unterricht (früher „Stundenplan“): die Abende eines Semesters als Liste mit
 * Uhrzeit, Fach und Thema, Dozent und dem Stand der Anwesenheit (Oberflächenplan
 * 09/2026). Der nächste Abend ist markiert, eine offene Erfassung trägt ihren
 * Knopf in der Zeile. Darunter die Quote je Teilnehmer (Modell A).
 */
export default async function StundenplanSeite({
  searchParams,
}: {
  searchParams: Promise<{ semester?: string }>;
}) {
  const benutzer = await ladeMitRecht(RECHT.SEMESTER_VERWALTEN);
  if (!benutzer) redirect("/anmelden");

  const sp = await searchParams;
  const semesters = await prisma.semester.findMany({ orderBy: { start: "asc" } });

  if (semesters.length === 0) {
    return (
      <main>
        <Seitenkopf titel="Unterricht" />
        <Inhalt>
          <LeererZustand
            icon="kalender"
            titel="Noch ist kein Semester angelegt"
            aktion={
              <Link href="/verwaltung/semester" className={knopf("sekundaer")}>
                Zu den Semestern
              </Link>
            }
          >
            Die Abende gehören immer zu einem Semester.
          </LeererZustand>
        </Inhalt>
      </main>
    );
  }

  const laufend = semesters.find((s) => s.istAktuell);
  const gewaehltId = sp.semester ?? laufend?.id ?? semesters[0].id;
  const semester = semesters.find((s) => s.id === gewaehltId) ?? laufend ?? semesters[0];

  // Die Quoten unten rechnen aus denselben Daten wie die Erfassung (Abende,
  // Teilnehmer, Anwesenheit) — keine zweite Abfrage derselben Zeilen.
  const [termineRoh, teilnehmerRoh, kurseinheitenRoh, dozenten, anwesenheitRoh, schwelle] = await Promise.all([
    prisma.unterrichtstermin.findMany({
      where: { semesterId: semester.id },
      orderBy: { beginn: "asc" },
      select: {
        id: true,
        beginn: true,
        ende: true,
        thema: true,
        kurseinheitId: true,
        kurseinheit: { select: { fach: { select: { bezeichnung: true } } } },
        dozentId: true,
        dozent: { select: { vorname: true, nachname: true } },
        _count: { select: { anwesenheiten: true } },
        // Ein abgerechneter Abend ist für Dozentenwechsel und Löschen gesperrt
        // (409 in der Termin-Route) — die Seite zeigt das vorher an.
        abrechnungPosten: { select: { abrechnungId: true, abrechnung: { select: { status: true } } } },
      },
    }),
    // Die Zeilen der Erfassung: aktive, für das Semester nicht abgemeldete
    // Teilnehmer — dieselbe Menge wie die Quoten darunter.
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

  const teilnehmer = teilnehmerRoh.map((t) => ({
    teilnahmeId: t.id,
    name: `${t.person.nachname}, ${t.person.vorname}`,
  }));
  const kurseinheiten = kurseinheitenRoh.map((k) => ({ id: k.id, label: `${k.fach.bezeichnung} — ${k.titel}` }));
  const anwesenheit: Record<string, Record<string, string>> = {};
  for (const a of anwesenheitRoh) {
    (anwesenheit[a.terminId] ??= {})[a.teilnahmeId] = a.status;
  }

  const jetzt = new Date();
  const abende: AbendAnzeige[] = gruppiereAbende(termineRoh, jetzt).map((abend) => ({
    tag: abend.tag,
    titel: abendTitel(abend.datum),
    nummer: abend.nummer,
    markierung: abend.markierung,
    pause: abend.pauseDavor > 0 ? pauseText(abend.pauseDavor) : null,
    einheiten: abend.einheiten.map((t) => ({
      id: t.id,
      text: terminText(t.beginn),
      kurz: tagKurz(t.beginn),
      zeit: zeitspanne(t.beginn, t.ende),
      fach: t.kurseinheit?.fach.bezeichnung ?? null,
      thema: t.thema,
      kurseinheitId: t.kurseinheitId,
      dozentId: t.dozentId,
      dozentName: t.dozent ? `${t.dozent.vorname} ${t.dozent.nachname}` : null,
      anwesenheitAnzahl: t._count.anwesenheiten,
      abrechnung: t.abrechnungPosten
        ? { id: t.abrechnungPosten.abrechnungId, status: t.abrechnungPosten.abrechnung.status }
        : null,
      stand: einheitStand({
        vergangen: terminVergangen(t.beginn, jetzt),
        erfasst: teilnehmer.filter((p) => anwesenheit[t.id]?.[p.teilnahmeId]).length,
        gesamt: teilnehmer.length,
      }),
    })),
  }));

  // Modell A wie in Personen- und Schüler-Akte: Teilnahmen der vergangenen
  // Abende gegen ALLE Abende des Semesters (eine Quote, nicht drei).
  const quotenAbende = termineRoh.map((t) => ({ id: t.id, istVergangen: terminVergangen(t.beginn, jetzt) }));
  const quoten = teilnehmer.map((t) => ({
    ...t,
    quote: quoteJeTeilnahme(quotenAbende, anwesenheit, t.teilnahmeId, schwelle),
  }));

  return (
    <main>
      <StundenplanClient
        semesterId={semester.id}
        semesterWahl={
          <SemesterWahl
            semesters={semesters}
            gewaehltId={semester.id}
            href={(id) => `/verwaltung/stundenplan?semester=${id}`}
          />
        }
        abende={abende}
        teilnehmer={teilnehmer}
        kurseinheiten={kurseinheiten}
        dozenten={dozenten}
        anwesenheit={anwesenheit}
        darfHonorar={hatRecht(benutzer, RECHT.HONORAR_ABRECHNEN)}
      >
        {abende.length > 0 && (
          <section aria-labelledby="quote-titel" className="mt-10">
            <Abschnitt titel={<span id="quote-titel">Anwesenheit je Teilnehmer</span>} />
            <p className="mb-3 text-[13px] text-muted-foreground">
              {`Nötig sind ${schwelle} % aller Abende. Anwesend und nachgearbeitet zählen, noch nicht erfasste und künftige Abende sind offen.`}
            </p>
            {quoten.length === 0 ? (
              <p className="rounded-xl border border-dashed border-linie px-4 py-6 text-center text-sm text-muted-foreground">
                Für dieses Semester sind keine aktiven Teilnehmer eingetragen.
              </p>
            ) : (
              <ul className="divide-y divide-linie overflow-hidden rounded-xl border border-linie bg-card">
                {quoten.map((z) => (
                  <li
                    key={z.teilnahmeId}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_220px_200px]"
                  >
                    <span className="truncate text-sm text-foreground">{z.name}</span>
                    <span className="col-start-1 row-start-2 text-[13px] text-muted-foreground sm:col-start-2 sm:row-start-1">
                      {`${z.quote.teilgenommen} teilgenommen · ${z.quote.versaeumt} versäumt`}
                    </span>
                    <span className="col-start-2 row-span-2 row-start-1 flex items-center gap-2 sm:col-start-3 sm:row-span-1">
                      {/* QuoteChip: Zeichen + „X/Y" mit Tint, Text in Vordergrundfarbe
                          (kein Rot auf Rot); das Wort dahinter wiederholt den Zustand
                          für Sehende — der Chip nennt ihn Screenreadern schon. */}
                      <QuoteChip quote={z.quote} />
                      <span aria-hidden="true" className="hidden text-xs text-muted-foreground sm:inline">
                        {QUOTE_STIL[z.quote.zustand].label}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </StundenplanClient>
    </main>
  );
}
