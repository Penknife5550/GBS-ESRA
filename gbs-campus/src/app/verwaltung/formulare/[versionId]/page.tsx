import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { Abschnitt, FeldTypWert, FormularBuilder, PersonFeldWert } from "../formular-builder";

export const dynamic = "force-dynamic";

export default async function BuilderSeite({ params }: { params: Promise<{ versionId: string }> }) {
  const benutzer = await ladeMitRecht("FORMULAR_BEARBEITEN");
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

  const abschnitte: Abschnitt[] = version.abschnitte.map((abschnitt) => ({
    titel: abschnitt.titel,
    beschreibung: abschnitt.beschreibung,
    felder: abschnitt.felder.map((feld) => ({
      code: feld.code,
      typ: feld.typ as FeldTypWert,
      label: feld.label,
      hilfetext: feld.hilfetext,
      platzhalter: feld.platzhalter,
      pflicht: feld.pflicht,
      optionen: Array.isArray(feld.optionen) ? (feld.optionen as string[]) : null,
      personFeld: feld.personFeld as PersonFeldWert,
      istArt9: feld.istArt9,
    })),
  }));

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link href="/verwaltung/formulare" className="text-sm text-muted-foreground underline underline-offset-4">
        ← Alle Formulare
      </Link>

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
