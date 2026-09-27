import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { AnmeldungStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ladeMitRecht, hatRecht } from "@/lib/berechtigung";
import { RECHT, STATUS } from "@/lib/constants";
import { abmeldegrundText, alsHeutigerTag, alsTagText, deutscherTag, teilnahmeformName } from "@/lib/semester";
import { waehlbareZiele } from "@/lib/status";
import { datum } from "@/lib/datum";
import { art9EinwilligungenWirksam } from "@/lib/anmeldung-antworten";
import { ladeEigeneLeistungen, ladePersonNoten } from "@/lib/leistung-io";
import { ladeEigeneUnterrichtstermine } from "@/lib/stundenplan-io";
import { ladeZeugnisseDerPerson } from "@/lib/zeugnis-io";
import { stornoRueckfrage } from "@/lib/zeugnis";
import { ZeugnisStatusBadge } from "../../zeugnisse/zeugnis-status-badge";
import { ZeugnisStorno } from "../../zeugnisse/zeugnis-storno";
import { ZurueckLeiste } from "@/components/ui/zurueck-leiste";
import { PersonKopf } from "@/components/personen/person-kopf";
import { StatusBadge, TeilnahmeformBadge, ErgebnisBadge } from "@/components/ui/badges";
import { QuoteChip } from "@/components/ui/quote-ampel";
import { NotenInline } from "@/components/personen/noten-inline";
import { AnwesenheitListe } from "@/components/personen/anwesenheit-liste";
import { PersonAktionen } from "@/components/personen/person-aktionen";
import { AusbildungStatus } from "@/components/personen/ausbildung-status";

export const metadata = { title: "Personenakte" };
export const dynamic = "force-dynamic";

/**
 * „abgemeldet (Grund)" zu einer Teilnahme der Semesterüberleitung — der Grund
 * im selben Wortlaut wie in der Überleitungsübersicht (`abmeldegrundText`).
 */
function abgemeldetText(grund: string | null): string {
  return grund ? `abgemeldet (${abmeldegrundText(grund)})` : "abgemeldet";
}

export default async function PersonDetailSeite({ params }: { params: Promise<{ id: string }> }) {
  const benutzer = await ladeMitRecht(RECHT.PERSON_LESEN_ALLE);
  if (!benutzer) redirect("/anmelden");

  const { id } = await params;

  const darfAendern = hatRecht(benutzer, RECHT.PERSON_BEARBEITEN_ALLE);
  const darfAuskunft = hatRecht(benutzer, RECHT.PERSON_EXPORTIEREN);
  const darfAnonymisieren = hatRecht(benutzer, RECHT.PERSON_ANONYMISIEREN);
  const darfRollen = hatRecht(benutzer, RECHT.BENUTZER_VERWALTEN);
  // Noten/Zeugnisse sind eine pädagogische Sicht — bewusst nur mit NOTEN_VERWALTEN
  // (Schulleitung), NICHT für Verwaltung/Administrator, die zwar PERSON_LESEN_ALLE
  // tragen. Es gibt kein separates „Noten-Lesen"-Recht; NOTEN_VERWALTEN ist die Grenze.
  const darfNoten = hatRecht(benutzer, RECHT.NOTEN_VERWALTEN);
  // Status und Ausbildungsdaten (Geburtsdatum, Gemeinde, Teilnahmeform) — nur
  // die Schulleitung (Code-Review 4, M9).
  const darfStatus = hatRecht(benutzer, RECHT.PERSON_STATUS_WECHSELN);

  // Beide Abfragen sind unabhängig voneinander — gebündelt statt nacheinander.
  const [person, aktuellesSemester] = await Promise.all([
    prisma.person.findUnique({
      where: { id },
      include: {
        status: true,
        ermaessigung: true,
        rollen: { select: { rolle: { select: { code: true } } } },
        teilnahmen: { include: { semester: true }, orderBy: { semester: { start: "desc" } } },
      },
    }),
    prisma.semester.findFirst({
      where: { istAktuell: true },
      select: { id: true, bezeichnung: true },
    }),
  ]);
  if (!person) notFound();

  const istAnonym = person.status.code === STATUS.ANONYMISIERT;
  const aktuelleTeilnahme = aktuellesSemester
    ? person.teilnahmen.find((t) => t.semesterId === aktuellesSemester.id) ?? null
    : null;
  // Eine abgemeldete Teilnahme zählt nicht (Semesterüberleitung) — für den
  // Block „Ausbildungsdaten & Status" gilt sie nicht als laufend.
  const zaehlendeTeilnahme = aktuelleTeilnahme && !aktuelleTeilnahme.abgemeldetAm ? aktuelleTeilnahme : null;
  // Kopf und Fakt „Teilnahme“ nach derselben Regel wie der Editor
  // „Ausbildungsdaten“: nie aus einer abgemeldeten Teilnahme.
  const anzeigeForm =
    zaehlendeTeilnahme?.teilnahmeform ??
    person.teilnahmen.find((t) => !t.abgemeldetAm)?.teilnahmeform ??
    person.teilnahmeform;
  // Die Teilnahmen, für die ein Wechsel der Teilnahmeform mitgilt: die des
  // laufenden Semesters und schon angelegte für noch nicht begonnene Semester —
  // dieselbe Auswahl wie `/api/personen/[id]/ausbildungsdaten`. Abgemeldete
  // gehen mit (sonst gälte nach einer Wiederaufnahme die alte Form) und werden
  // als solche benannt.
  const heute = alsHeutigerTag(new Date());
  const offeneSemester = person.teilnahmen
    .filter((t) => t.semesterId === aktuellesSemester?.id || t.semester.start.getTime() > heute.getTime())
    .map((t) => (t.abgemeldetAm ? `${t.semester.bezeichnung} (abgemeldet)` : t.semester.bezeichnung))
    .reverse();

  const zeigeAusbildung = darfStatus && !istAnonym;
  // Den eigenen Status lehnt die Statusroute ab (403) — dann gibt es keine Auswahl.
  const eigeneAkte = person.id === benutzer.id;
  // Noten nur für Personen, die noch benotet werden: nicht im Endzustand und
  // nicht anonymisiert (der Schreibweg nimmt dafür ohnehin nichts an).
  const zeigeNotenEditor = darfNoten && Boolean(aktuellesSemester) && !person.status.istTerminal;
  const [leistungGruppen, anwesenheitGruppen, zeugnisse, personNoten, alleRollen, statusListe, art9, offeneAnmeldungen] =
    await Promise.all([
      darfNoten ? ladeEigeneLeistungen(person.id) : Promise.resolve([]),
      ladeEigeneUnterrichtstermine(person.id, new Date()),
      darfNoten ? ladeZeugnisseDerPerson(person.id) : Promise.resolve([]),
      zeigeNotenEditor && aktuellesSemester ? ladePersonNoten(person.id, aktuellesSemester.id) : Promise.resolve(null),
      darfRollen
        ? prisma.rolle.findMany({ select: { code: true, bezeichnung: true }, orderBy: { sortierung: "asc" } })
        : Promise.resolve([] as { code: string; bezeichnung: string }[]),
      zeigeAusbildung && !eigeneAkte
        ? prisma.teilnehmerStatus.findMany({
            select: { code: true, bezeichnung: true, istTerminal: true, istAktiv: true },
            orderBy: { sortierung: "asc" },
          })
        : Promise.resolve([] as { code: string; bezeichnung: string; istTerminal: boolean; istAktiv: boolean }[]),
      // Alle Art.-9-Texte (je Text gilt die jüngste Zeile, alle müssen wirksam
      // sein) — dieselbe Regel wie die Anmeldungsansicht und die Route.
      zeigeAusbildung
        ? prisma.einwilligung.findMany({
            where: { personId: person.id, text: { istArt9: true } },
            select: { erteilt: true, zeitpunkt: true, text: { select: { code: true } } },
          })
        : Promise.resolve([] as { erteilt: boolean; zeitpunkt: Date; text: { code: string } }[]),
      // Solange über eine eingereichte Anmeldung nicht entschieden ist, gibt es
      // keinen Statuswechsel von Hand (siehe `pruefeStatuswechsel`).
      zeigeAusbildung && person.statusCode === STATUS.INTERESSENT
        ? prisma.anmeldung.count({ where: { personId: person.id, status: AnmeldungStatus.EINGEREICHT } })
        : Promise.resolve(0),
    ]);

  const aktuelleQuote = aktuelleTeilnahme
    ? anwesenheitGruppen.find((g) => g.teilnahmeId === aktuelleTeilnahme.id)?.quote ?? null
    : null;

  // Read-only Notenverlauf: das laufende Semester weglassen (steht schon als Editor).
  const verlaufGruppen = personNoten
    ? leistungGruppen.filter((g) => g.semesterBezeichnung !== personNoten.semesterBezeichnung)
    : leistungGruppen;

  const facts: { bezeichnung: string; wert: ReactNode }[] = [
    {
      bezeichnung: "Semester",
      // Eine abgemeldete Teilnahme (Semesterüberleitung) zählt nicht — sie
      // erscheint deshalb nicht als laufend, sondern mit ihrem Grund.
      wert:
        aktuelleTeilnahme && aktuellesSemester
          ? aktuelleTeilnahme.abgemeldetAm
            ? `${aktuellesSemester.bezeichnung} — ${abgemeldetText(aktuelleTeilnahme.abmeldeGrund)}`
            : aktuellesSemester.bezeichnung
          : "nicht eingeschrieben",
    },
    { bezeichnung: "Teilnahme", wert: teilnahmeformName(anzeigeForm) || "—" },
    { bezeichnung: "Geburtsdatum", wert: deutscherTag(person.geburtsdatum) || "—" },
    { bezeichnung: "Gemeinde", wert: person.gemeinde || "—" },
    { bezeichnung: "Anwesenheit", wert: aktuelleQuote ? <QuoteChip quote={aktuelleQuote} /> : "—" },
    // Ein Zeitpunkt, kein Kalendertag: in Europe/Berlin formatieren (`deutscherTag`
    // rechnet in UTC und zeigte nachts angelegte Personen mit dem Vortag).
    { bezeichnung: "Angelegt", wert: datum(person.erstelltAm) },
  ];
  if (person.ermaessigung) facts.push({ bezeichnung: "Ermäßigung", wert: person.ermaessigung.bezeichnung });

  const panelKopf = "flex items-center justify-between gap-3 border-b border-border bg-muted/60 px-4 py-3";

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <ZurueckLeiste
        href="/verwaltung/personen"
        label="Personen"
        breadcrumb={
          <>
            Verwaltung · Personen · <b className="font-semibold text-foreground">{person.vorname} {person.nachname}</b>
          </>
        }
      />

      <div className="mt-6">
        <PersonKopf
          vorname={person.vorname}
          nachname={person.nachname}
          badges={
            <>
              <StatusBadge code={person.status.code} label={person.status.bezeichnung} />
              <TeilnahmeformBadge form={anzeigeForm} />
            </>
          }
          kontakt={
            <>
              {person.email}
              {person.telefon && <span className="text-muted-foreground"> · {person.telefon}</span>}
            </>
          }
          facts={facts}
        />
      </div>

      {(darfAendern || darfAuskunft || darfAnonymisieren || darfRollen) && (
        <div className="mt-6">
          <PersonAktionen
            person={{
              id: person.id,
              name: `${person.vorname} ${person.nachname}`,
              vorname: person.vorname,
              nachname: person.nachname,
              // Adress-/Kontaktfelder nur übergeben, wenn sie bearbeitet werden dürfen —
              // sonst landen sie unnötig im Client-Bundle (z. B. für einen Admin, der
              // nur Rollen darf).
              telefon: darfAendern ? person.telefon ?? "" : "",
              strasse: darfAendern ? person.strasse ?? "" : "",
              plz: darfAendern ? person.plz ?? "" : "",
              ort: darfAendern ? person.ort ?? "" : "",
              email: person.email,
              status: person.status.bezeichnung,
              istTerminal: person.status.istTerminal,
              istAnonym,
              rollenCodes: person.rollen.map((r) => r.rolle.code),
            }}
            darfAendern={darfAendern}
            darfAuskunft={darfAuskunft}
            darfAnonymisieren={darfAnonymisieren}
            darfRollenVerwalten={darfRollen}
            alleRollen={alleRollen}
            istEigeneAkte={eigeneAkte}
          />
        </div>
      )}

      {zeigeAusbildung && (
        <div className="mt-6">
          <AusbildungStatus
            personId={person.id}
            name={`${person.vorname} ${person.nachname}`}
            status={{
              code: person.status.code,
              bezeichnung: person.status.bezeichnung,
              istTerminal: person.status.istTerminal,
              istAktiv: person.status.istAktiv,
            }}
            ziele={
              eigeneAkte
                ? []
                : waehlbareZiele(statusListe, person.statusCode, person.status.istTerminal, offeneAnmeldungen > 0)
            }
            eigeneAkte={eigeneAkte}
            offeneAnmeldung={offeneAnmeldungen > 0}
            daten={{
              geburtsdatum: alsTagText(person.geburtsdatum),
              gemeinde: person.gemeinde ?? "",
              teilnahmeform: zaehlendeTeilnahme?.teilnahmeform ?? person.teilnahmeform ?? "",
            }}
            offeneSemester={offeneSemester}
            laufendesSemester={zaehlendeTeilnahme && aktuellesSemester ? aktuellesSemester.bezeichnung : null}
            art9Eingewilligt={art9EinwilligungenWirksam(
              art9.map((e) => ({ erteilt: e.erteilt, zeitpunkt: e.zeitpunkt, code: e.text.code })),
            )}
          />
        </div>
      )}

      <div className={`mt-6 grid gap-6 ${darfNoten ? "lg:grid-cols-2" : ""}`}>
        {/* Noten — nur mit NOTEN_VERWALTEN (Schulleitung) */}
        {darfNoten && (
          <section className="rounded-lg border border-border bg-card">
            <div className={panelKopf}>
              <h2 className="text-sm font-semibold">Noten</h2>
              {aktuellesSemester && <span className="text-xs text-muted-foreground">{aktuellesSemester.bezeichnung}</span>}
            </div>
            {personNoten ? (
              <NotenInline
                semesterId={personNoten.semesterId}
                teilnahmeId={personNoten.teilnahmeId}
                kurseinheiten={personNoten.kurseinheiten}
              />
            ) : (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                {person.status.istTerminal
                  ? `Status „${person.status.bezeichnung}“ — für diese Person werden keine Noten mehr erfasst.`
                  : !aktuellesSemester
                    ? "Es ist kein Semester als laufend gesetzt."
                    : aktuelleTeilnahme?.abgemeldetAm
                      ? `Diese Person ist für das laufende Semester ${abgemeldetText(aktuelleTeilnahme.abmeldeGrund)} — ` +
                        "eine abgemeldete Teilnahme wird nicht benotet."
                      : aktuelleTeilnahme?.teilnahmeform === "HOERER"
                        ? "Diese Person nimmt im laufenden Semester als Hörer teil — Hörer werden nicht benotet."
                        : "Diese Person ist im laufenden Semester nicht eingeschrieben — hier gibt es nichts zu benoten."}
              </p>
            )}

            {verlaufGruppen.length > 0 && (
              <div className="border-t border-border p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {personNoten ? "Frühere Semester" : "Erfasste Noten"}
                </h3>
                <div className="space-y-5">
                  {verlaufGruppen.map((gruppe) => (
                    <div key={gruppe.semesterBezeichnung}>
                      <h4 className="mb-2 text-sm font-semibold">{gruppe.semesterBezeichnung}</h4>
                      <ul className="space-y-2">
                        {gruppe.leistungen.map((l) => (
                          <li
                            key={`${l.fach}·${l.titel}`}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3"
                          >
                            <div className="min-w-0">
                              <span className="text-sm font-medium">{l.fach}</span>
                              <span className="ml-2 text-sm text-muted-foreground">· {l.titel}</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <ErgebnisBadge ergebnis={l.ergebnis} />
                              {l.punkte != null && <span className="text-sm text-muted-foreground">{l.punkte} Punkte</span>}
                              {l.note && <span className="text-sm text-muted-foreground">Note {l.note}</span>}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Anwesenheit — Einsicht für alle mit PERSON_LESEN_ALLE */}
        <section className="rounded-lg border border-border bg-card">
          <div className={panelKopf}>
            <h2 className="text-sm font-semibold">Anwesenheit</h2>
            <span className="text-xs text-muted-foreground">nur Einsicht</span>
          </div>
          <AnwesenheitListe gruppen={anwesenheitGruppen} />
        </section>
      </div>

      {/* Zeugnisse — wie Noten nur mit NOTEN_VERWALTEN. Alle Stände (gültig,
          ersetzt, storniert) mit Label; stornieren lässt sich nur ein gültiges
          einer nicht anonymisierten Person (die Route prüft beides selbst). Die
          Storno-Komponente steht in jeder Zeile (stabiler key), damit ihre
          Meldung das Neuladen übersteht. */}
      {darfNoten && zeugnisse.length > 0 && (
        <section className="mt-6 rounded-lg border border-border bg-card">
          <div className={panelKopf}>
            <h2 className="text-sm font-semibold">Zeugnisse &amp; Bescheinigungen</h2>
          </div>
          <ul className="space-y-2 p-4">
            {zeugnisse.map((z) => (
              <li
                key={z.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium">{z.titel}</span>
                  <span className="ml-2 text-sm text-muted-foreground">· {z.abschnitt}</span>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <ZeugnisStatusBadge status={z.status} />
                    <span>
                      Beleg-Nr. {z.belegNr} · {datum(z.ausgestelltAm)}
                      {z.status === "STORNIERT" && ` · storniert am ${datum(z.storniertAm)}`}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={`/api/zeugnisse/${z.id}/pdf`}
                    aria-label={`${z.titel} (${z.abschnitt}, Beleg-Nr. ${z.belegNr}) als PDF öffnen`}
                    className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 py-2 text-sm font-medium"
                  >
                    {z.status === "GUELTIG" ? "PDF öffnen" : "PDF (ungültig)"}
                  </a>
                  <ZeugnisStorno
                    zeugnisId={z.id}
                    stornierbar={z.status === "GUELTIG" && !istAnonym}
                    rueckfrage={stornoRueckfrage({ typ: z.typ, belegNr: z.belegNr, name: `${person.vorname} ${person.nachname}` })}
                    beschriftung={`${z.titel} (${z.abschnitt}) stornieren (ohne Ersatz)`}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
