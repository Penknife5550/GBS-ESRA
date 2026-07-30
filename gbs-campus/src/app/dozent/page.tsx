import Link from "next/link";
import { redirect } from "next/navigation";
import { ladeAngemeldeten, hatRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { ladeEigeneDozentTermine } from "@/lib/stundenplan-io";
import { AbmeldenKnopf } from "@/app/verwaltung/abmelden-knopf";
import { StundenplanDozent } from "./stundenplan-dozent";

export const dynamic = "force-dynamic";

/**
 * Die Startseite des Dozenten. Er landet nach dem Login hier (Weiche in
 * `/verwaltung`), statt wie bisher in der Teilnehmer-Akte. Read-only sieht er
 * seinen Stundenplan; für vergangene Abende trägt er die Anwesenheit an der
 * Quelle ein (zusätzliches Recht `ANWESENHEIT_ERFASSEN_EIGENE`).
 */
export default async function DozentSeite() {
  const benutzer = await ladeAngemeldeten();
  if (!benutzer || !hatRecht(benutzer, RECHT.EIGENE_TERMINE_LESEN)) redirect("/anmelden");

  const gruppen = await ladeEigeneDozentTermine(benutzer.id, new Date());
  const darfErfassen = hatRecht(benutzer, RECHT.ANWESENHEIT_ERFASSEN_EIGENE);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Mein Unterricht</h1>
          <p className="mt-2 max-w-prose text-sm text-muted-foreground">
            Deine Unterrichtsabende. Für vergangene Abende trägst du hier die Anwesenheit deiner Teilnehmer
            ein — anwesend, gefehlt oder nachgearbeitet.
          </p>
          <Link
            href="/meine-daten"
            className="mt-3 inline-block text-sm text-muted-foreground underline underline-offset-4"
          >
            Zu meinen persönlichen Daten (Adresse, Bankverbindung) →
          </Link>
        </div>
        <AbmeldenKnopf />
      </div>

      {gruppen.length === 0 ? (
        <p className="mt-10 rounded-lg border border-border bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
          Dir sind noch keine Unterrichtsabende zugeordnet. Die Zuordnung nimmt die Verwaltung im
          Stundenplan vor.
        </p>
      ) : (
        <div className="mt-10">
          <StundenplanDozent gruppen={gruppen} darfErfassen={darfErfassen} />
        </div>
      )}
    </main>
  );
}
