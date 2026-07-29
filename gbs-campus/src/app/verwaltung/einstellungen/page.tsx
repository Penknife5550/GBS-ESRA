import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { EinstellungsFeld } from "./einstellungs-feld";

export const dynamic = "force-dynamic";

const BEREICH_NAME: Record<string, string> = {
  AUTH: "Anmeldung am Portal",
  ANMELDUNG: "Anmeldeformular",
  FINANZEN: "Finanzen",
};

export default async function EinstellungenSeite() {
  const benutzer = await ladeMitRecht("SYSTEM_EINSTELLUNGEN");
  if (!benutzer) redirect("/anmelden");

  const einstellungen = await prisma.einstellung.findMany({
    orderBy: [{ bereich: "asc" }, { sortierung: "asc" }],
  });

  const bereiche = [...new Set(einstellungen.map((e) => e.bereich))];

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/verwaltung" className="text-sm text-muted-foreground underline underline-offset-4">
        ← Verwaltung
      </Link>

      <h1 className="mt-6 text-2xl font-bold tracking-tight">Einstellungen</h1>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Diese Werte gelten sofort, ohne Neustart. Jede Änderung steht im Audit-Log. Die zulässigen Grenzen sind
        fest hinterlegt — was außerhalb liegt, wird abgelehnt.
      </p>

      {bereiche.map((bereich) => (
        <section key={bereich} className="mt-10">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {BEREICH_NAME[bereich] ?? bereich}
          </h2>
          <div className="space-y-4">
            {einstellungen
              .filter((e) => e.bereich === bereich)
              .map((e) => (
                <EinstellungsFeld
                  key={e.schluessel}
                  einstellung={{
                    schluessel: e.schluessel,
                    bezeichnung: e.bezeichnung,
                    beschreibung: e.beschreibung,
                    wert: e.wert,
                    minimum: e.minimum,
                    maximum: e.maximum,
                    einheit: e.einheit,
                  }}
                />
              ))}
          </div>
        </section>
      ))}
    </main>
  );
}
