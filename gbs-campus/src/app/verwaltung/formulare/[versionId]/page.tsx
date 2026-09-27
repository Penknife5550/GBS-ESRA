import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { alsBuilderAbschnitte } from "@/lib/formular";
import { ZurueckLeiste } from "@/components/ui/zurueck-leiste";
import { Abschnitt, FormularBuilder } from "../formular-builder";

export const metadata = { title: "Formular bearbeiten" };
export const dynamic = "force-dynamic";

export default async function BuilderSeite({ params }: { params: Promise<{ versionId: string }> }) {
  const benutzer = await ladeMitRecht(RECHT.FORMULAR_BEARBEITEN);
  if (!benutzer) redirect("/anmelden");

  const { versionId } = await params;

  const version = await prisma.formularVersion.findUnique({
    where: { id: versionId },
    include: {
      formular: true,
      abschnitte: { include: { felder: { orderBy: { reihenfolge: "asc" } } }, orderBy: { reihenfolge: "asc" } },
    },
  });
  if (!version) notFound();

  // Die Felder laufen durch alsBuilderAbschnitte (lib/formular.ts) — dieselbe
  // Abbildung wie beim Speichern, Veroeffentlichen und in der Anmeldung. Vorher
  // bildete diese Seite die Felder von Hand ab und liess die
  // Teilnahmeform-Zuordnung aus feld.validierung weg: Im Builder stand jede
  // Auswahl auf „— bitte wählen —", und jedes Speichern scheiterte. Keine eigene
  // Abbildung mehr hier — nur so deckt das Pruefskript den Weg ab.
  const abschnitte: Abschnitt[] = alsBuilderAbschnitte(version.abschnitte);

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <ZurueckLeiste
        href="/verwaltung/formulare"
        label="Alle Formulare"
        breadcrumb={`Verwaltung · Formulare · Fassung ${version.version}`}
      />

      <div className="mt-6">
        <FormularBuilder
          versionId={version.id}
          version={version.version}
          bearbeitbar={version.status === "ENTWURF"}
          einleitungStart={version.einleitung ?? ""}
          abschnitteStart={abschnitte}
        />
      </div>
    </main>
  );
}
