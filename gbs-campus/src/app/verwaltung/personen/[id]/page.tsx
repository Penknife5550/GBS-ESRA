import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ladeMitRecht, hatRecht } from "@/lib/berechtigung";
import { RECHT, STATUS } from "@/lib/constants";
import { deutscherTag, teilnahmeformName } from "@/lib/semester";
import { datum } from "@/lib/datum";
import { ladeEigeneLeistungen, ladePersonNoten } from "@/lib/leistung-io";
import { ladeEigeneUnterrichtstermine } from "@/lib/stundenplan-io";
import { ladeEigeneZeugnisse } from "@/lib/zeugnis-io";
import { ZurueckLeiste } from "@/components/ui/zurueck-leiste";
import { PersonKopf } from "@/components/personen/person-kopf";
import { StatusBadge, TeilnahmeformBadge, ErgebnisBadge } from "@/components/ui/badges";
import { QuoteChip } from "@/components/ui/quote-ampel";
import { NotenInline } from "@/components/personen/noten-inline";
import { AnwesenheitListe } from "@/components/personen/anwesenheit-liste";
import { PersonAktionen } from "@/components/personen/person-aktionen";

export const dynamic = "force-dynamic";

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

  const person = await prisma.person.findUnique({
    where: { id },
    include: {
      status: true,
      ermaessigung: true,
      rollen: { select: { rolle: { select: { code: true } } } },
      teilnahmen: { include: { semester: true }, orderBy: { semester: { start: "desc" } } },
    },
  });
  if (!person) notFound();

  const istAnonym = person.status.code === STATUS.ANONYMISIERT;
  const aktuellesSemester = await prisma.semester.findFirst({
    where: { istAktuell: true },
    select: { id: true, bezeichnung: true },
  });
  const aktuelleTeilnahme = aktuellesSemester
    ? person.teilnahmen.find((t) => t.semesterId === aktuellesSemester.id) ?? null
    : null;
  const anzeigeForm = aktuelleTeilnahme?.teilnahmeform ?? person.teilnahmen[0]?.teilnahmeform ?? person.teilnahmeform;

  const [leistungGruppen, anwesenheitGruppen, zeugnisse, personNoten, alleRollen] = await Promise.all([
    darfNoten ? ladeEigeneLeistungen(person.id) : Promise.resolve([]),
    ladeEigeneUnterrichtstermine(person.id, new Date()),
    darfNoten ? ladeEigeneZeugnisse(person.id) : Promise.resolve([]),
    darfNoten && aktuellesSemester ? ladePersonNoten(person.id, aktuellesSemester.id) : Promise.resolve(null),
    darfRollen
      ? prisma.rolle.findMany({ select: { code: true, bezeichnung: true }, orderBy: { sortierung: "asc" } })
      : Promise.resolve([] as { code: string; bezeichnung: string }[]),
  ]);

  const aktuelleQuote = aktuelleTeilnahme
    ? anwesenheitGruppen.find((g) => g.teilnahmeId === aktuelleTeilnahme.id)?.quote ?? null
    : null;

  // Read-only Notenverlauf: das laufende Semester weglassen (steht schon als Editor).
  const verlaufGruppen = personNoten
    ? leistungGruppen.filter((g) => g.semesterBezeichnung !== personNoten.semesterBezeichnung)
    : leistungGruppen;

  const facts: { bezeichnung: string; wert: ReactNode }[] = [
    { bezeichnung: "Semester", wert: aktuelleTeilnahme && aktuellesSemester ? aktuellesSemester.bezeichnung : "nicht eingeschrieben" },
    { bezeichnung: "Teilnahme", wert: teilnahmeformName(anzeigeForm) || "—" },
    { bezeichnung: "Geburtsdatum", wert: deutscherTag(person.geburtsdatum) || "—" },
    { bezeichnung: "Gemeinde", wert: person.gemeinde || "—" },
    { bezeichnung: "Anwesenheit", wert: aktuelleQuote ? <QuoteChip quote={aktuelleQuote} /> : "—" },
    { bezeichnung: "Angelegt", wert: deutscherTag(person.erstelltAm) },
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
                {aktuellesSemester
                  ? "Diese Person ist im laufenden Semester nicht eingeschrieben — hier gibt es nichts zu benoten."
                  : "Es ist kein Semester als laufend gesetzt."}
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

      {/* Zeugnisse — wie Noten nur mit NOTEN_VERWALTEN */}
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
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Beleg-Nr. {z.belegNr} · {datum(z.ausgestelltAm)}
                  </div>
                </div>
                <a
                  href={`/api/zeugnisse/${z.id}/pdf`}
                  className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 py-2 text-sm font-medium"
                >
                  PDF öffnen
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
