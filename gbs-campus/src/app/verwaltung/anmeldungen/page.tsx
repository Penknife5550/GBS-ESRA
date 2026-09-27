import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hatRecht, ladeMitRecht } from "@/lib/berechtigung";
import { ZurueckLeiste } from "@/components/ui/zurueck-leiste";
import { Entscheidung } from "./entscheidung";
import { Bankverbindung } from "./bankverbindung";
import { RECHT, STATUS } from "@/lib/constants";
import { datum } from "@/lib/datum";
import { teilnahmeformName } from "@/lib/semester";
import { AnmeldungStatusBadge } from "@/components/ui/badges";

export const metadata = { title: "Anmeldungen" };
export const dynamic = "force-dynamic";

export default async function AnmeldungenSeite() {
  const benutzer = await ladeMitRecht(RECHT.ANMELDUNG_LESEN);
  if (!benutzer) redirect("/anmelden");

  const darfEntscheiden = hatRecht(benutzer, RECHT.ANMELDUNG_ENTSCHEIDEN);
  // Nur die Verwaltung sieht die Bankverbindung — bewusst getrennt vom
  // Beitragsstatus, damit die IBAN nicht beilaeufig auf jedem Bildschirm steht.
  const darfBankSehen = hatRecht(benutzer, RECHT.BANKVERBINDUNG_LESEN);
  // Der Link zur Akte fuehrt auf eine Seite mit eigenem Recht — ohne es waere er
  // eine Sackgasse.
  const darfAkteOeffnen = hatRecht(benutzer, RECHT.PERSON_LESEN_ALLE);

  const anmeldungen = await prisma.anmeldung.findMany({
    // Entwürfe sind unfertige Eingaben fremder Menschen — sie gehören nicht in
    // die Arbeitsliste der Schulleitung. Ebenso wenig Anmeldungen anonymisierter
    // Personen (Code-Review 4, M7): Die Anonymisierung schließt sie, und eine
    // Zeile „Anonymisiert Person — Abgelehnt" ist keine Arbeit mehr.
    where: {
      status: { not: "ENTWURF" },
      OR: [{ personId: null }, { person: { statusCode: { not: STATUS.ANONYMISIERT } } }],
    },
    // `select` statt `include`: Sonst laedt Prisma auch die Spalte `antworten`
    // mit — bei 24 Fragen je Anmeldung mehrere Kilobyte, die diese Liste nie
    // anzeigt, und die Seite laeuft ohne Zwischenspeicher. Gelesen werden die
    // Antworten in der Einzelansicht /verwaltung/anmeldungen/[id] — dort mit
    // Art.-9-Schutz und protokolliert.
    select: {
      id: true,
      status: true,
      eingereichtAm: true,
      ablehnungsgrund: true,
      person: {
        select: {
          id: true,
          vorname: true,
          nachname: true,
          email: true,
          teilnahmeform: true,
          kontoinhaber: true,
          ibanVerschluesselt: true,
        },
      },
      formularVersion: { select: { version: true } },
      semester: { select: { bezeichnung: true } },
      einwilligungen: { select: { erteilt: true, text: { select: { istArt9: true } } } },
    },
    orderBy: [{ status: "asc" }, { eingereichtAm: "desc" }],
    take: 200,
  });

  const offen = anmeldungen.filter((a) => a.status === "EINGEREICHT");

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <ZurueckLeiste href="/verwaltung" label="Verwaltung" breadcrumb="Verwaltung · Anmeldungen" />

      <h1 className="mt-6 text-2xl font-bold tracking-tight">Anmeldungen</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {offen.length === 0
          ? "Zurzeit wartet keine Anmeldung auf eine Entscheidung."
          : `${offen.length} ${offen.length === 1 ? "Anmeldung wartet" : "Anmeldungen warten"} auf eine Entscheidung.`}
      </p>

      {anmeldungen.length === 0 ? (
        <p className="mt-10 rounded-lg border border-border bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
          Noch ist keine Anmeldung eingegangen.
        </p>
      ) : (
        <ul className="mt-8 space-y-4">
          {anmeldungen.map((anmeldung) => (
            <li key={anmeldung.id} className="rounded-lg border border-border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {anmeldung.person ? `${anmeldung.person.vorname} ${anmeldung.person.nachname}` : "Ohne Akte"}
                  </p>
                  <p className="break-all text-sm text-muted-foreground">{anmeldung.person?.email}</p>
                </div>
                <AnmeldungStatusBadge status={anmeldung.status} />
              </div>

              <dl className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Teilnahme:</dt>
                  <dd>{teilnahmeformName(anmeldung.person?.teilnahmeform) || "—"}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Eingegangen:</dt>
                  <dd>{datum(anmeldung.eingereichtAm)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Formularfassung:</dt>
                  <dd>{anmeldung.formularVersion.version}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Semester:</dt>
                  {/* Leer, wenn die Anmeldung einging, bevor ein Semester angelegt war.
                      Sichtbar zu machen ist der ganze Zweck des Feldes — vorher ließ es
                      sich nur über das Eingangsdatum erraten. */}
                  <dd>{anmeldung.semester?.bezeichnung ?? "nicht zugeordnet"}</dd>
                </div>
                {darfBankSehen && (
                  <div className="flex gap-2 sm:col-span-2">
                    <dt className="text-muted-foreground">Bankverbindung:</dt>
                    <dd>
                      {anmeldung.person ? (
                        <Bankverbindung
                          personId={anmeldung.person.id}
                          hinterlegt={Boolean(anmeldung.person.ibanVerschluesselt)}
                        />
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                )}
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Einwilligungen:</dt>
                  <dd>
                    {anmeldung.einwilligungen.filter((e) => e.erteilt).length} von {anmeldung.einwilligungen.length}
                    {anmeldung.einwilligungen.some((e) => e.text.istArt9 && !e.erteilt) && (
                      <span className="ml-1 text-muted-foreground">(ohne Glaubensangaben)</span>
                    )}
                  </dd>
                </div>
              </dl>

              {/* prefetch aus: Die Einzelansicht protokolliert jeden Abruf — ein
                  Vorladen beim Scrollen durch die Liste waere ein Abruf, den niemand
                  gemacht hat. */}
              <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <Link
                  href={`/verwaltung/anmeldungen/${anmeldung.id}`}
                  prefetch={false}
                  className="underline underline-offset-4"
                >
                  Antworten ansehen
                  {anmeldung.person && (
                    <span className="sr-only">
                      {" "}
                      von {anmeldung.person.vorname} {anmeldung.person.nachname}
                    </span>
                  )}
                </Link>
                {anmeldung.person && darfAkteOeffnen && (
                  <Link href={`/verwaltung/personen/${anmeldung.person.id}`} className="underline underline-offset-4">
                    Akte öffnen
                    <span className="sr-only">
                      {" "}
                      von {anmeldung.person.vorname} {anmeldung.person.nachname}
                    </span>
                  </Link>
                )}
              </p>

              {anmeldung.ablehnungsgrund && (
                <p className="mt-3 rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">
                  Grund: {anmeldung.ablehnungsgrund}
                </p>
              )}

              {anmeldung.status === "EINGEREICHT" && darfEntscheiden && anmeldung.person && (
                <Entscheidung
                  anmeldungId={anmeldung.id}
                  name={`${anmeldung.person.vorname} ${anmeldung.person.nachname}`}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
