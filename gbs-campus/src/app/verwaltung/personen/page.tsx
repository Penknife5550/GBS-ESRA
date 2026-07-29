import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hatRecht, ladeAngemeldeten } from "@/lib/berechtigung";
import { RECHT, STATUS } from "@/lib/constants";
import { PersonZeile } from "./person-zeile";

export const dynamic = "force-dynamic";

/** Mehr Treffer helfen niemandem — dann lieber genauer suchen. */
const HOECHSTZAHL = 50;

export default async function PersonenSeite({
  searchParams,
}: {
  searchParams: Promise<{ suche?: string }>;
}) {
  const benutzer = await ladeAngemeldeten();
  if (!benutzer || !hatRecht(benutzer, RECHT.PERSON_LESEN_ALLE)) redirect("/anmelden");

  const darfAendern = hatRecht(benutzer, RECHT.PERSON_BEARBEITEN_ALLE);
  const darfAuskunft = hatRecht(benutzer, RECHT.PERSON_EXPORTIEREN);
  const darfAnonymisieren = hatRecht(benutzer, RECHT.PERSON_ANONYMISIEREN);
  const { suche } = await searchParams;
  const begriff = suche?.trim() ?? "";

  const personen = await prisma.person.findMany({
    where: begriff
      ? {
          OR: [
            { vorname: { contains: begriff, mode: "insensitive" } },
            { nachname: { contains: begriff, mode: "insensitive" } },
            { email: { contains: begriff, mode: "insensitive" } },
          ],
        }
      : undefined,
    select: {
      id: true,
      vorname: true,
      nachname: true,
      email: true,
      status: { select: { code: true, bezeichnung: true, istTerminal: true } },
      rollen: { select: { rolle: { select: { bezeichnung: true } } } },
    },
    orderBy: [{ nachname: "asc" }, { vorname: "asc" }],
    take: HOECHSTZAHL,
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/verwaltung" className="text-sm text-muted-foreground underline underline-offset-4">
        ← Verwaltung
      </Link>

      <h1 className="mt-6 text-2xl font-bold tracking-tight">Personen</h1>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Hier wird jemand wieder hereingelassen, der an sein Postfach nicht mehr herankommt: Adresse
        ändern, Anmeldelink schicken. Der Anmeldelink ist der Standardweg; zusätzlich kann ein Konto ein
        Passwort tragen, das die Person selbst unter „Meine Daten" setzt. Wird hier die Adresse geändert,
        fällt ein gesetztes Passwort weg.
      </p>

      {/* Ein einfaches GET-Formular: Die Suche gehört in die Adresszeile,
          damit sich ein Treffer weitergeben und neu laden lässt. */}
      <form method="get" className="mt-8 flex flex-wrap gap-3">
        <label htmlFor="suche" className="sr-only">
          Nach Name oder E-Mail-Adresse suchen
        </label>
        <input
          id="suche"
          name="suche"
          type="search"
          defaultValue={begriff}
          placeholder="Name oder E-Mail-Adresse"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-4 py-2.5 text-sm"
        />
        <button
          type="submit"
          className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Suchen
        </button>
      </form>

      {personen.length === 0 ? (
        <p className="mt-8 rounded-lg border border-border bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
          {begriff ? `Zu „${begriff}" wurde niemand gefunden.` : "Es ist noch niemand angelegt."}
        </p>
      ) : (
        <>
          <p className="mt-8 text-sm text-muted-foreground">
            {personen.length === HOECHSTZAHL
              ? `Die ersten ${HOECHSTZAHL} Treffer — bitte genauer suchen, wenn der Gesuchte fehlt.`
              : `${personen.length} ${personen.length === 1 ? "Person" : "Personen"}`}
          </p>

          <ul className="mt-3 space-y-4">
            {personen.map((person) => (
              <PersonZeile
                key={person.id}
                darfAendern={darfAendern}
                darfAuskunft={darfAuskunft}
                darfAnonymisieren={darfAnonymisieren}
                person={{
                  id: person.id,
                  name: `${person.vorname} ${person.nachname}`,
                  email: person.email,
                  status: person.status.bezeichnung,
                  istTerminal: person.status.istTerminal,
                  istAnonym: person.status.code === STATUS.ANONYMISIERT,
                  rollen: person.rollen.map((r) => r.rolle.bezeichnung).join(", "),
                }}
              />
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
