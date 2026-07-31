import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { datum } from "@/lib/datum";
import { teilnahmeformName } from "@/lib/semester";
import { istGewaehlterTyp, zeugnisTitel, type GewaehlterTyp } from "@/lib/zeugnis";
import { ladeZeugnisUebersicht } from "@/lib/zeugnis-io";
import { ZeugnisClient } from "./zeugnis-client";

export const dynamic = "force-dynamic";

/**
 * Zeugnis-Verwaltung der Schulleitung (Recht NOTEN_VERWALTEN). Je Semester und
 * gewähltem Typ (Semester-Zeugnis bzw. Abschlusszeugnis) die aktiven Teilnehmer
 * mit ihrem aktuell gültigen Zeugnis. Ausstellen (einzeln/gesammelt),
 * neu ausstellen (Storno) und Serien-/Einzeldruck laufen im Client.
 */
export default async function ZeugnisSeite({
  searchParams,
}: {
  searchParams: Promise<{ semester?: string; typ?: string }>;
}) {
  const benutzer = await ladeMitRecht(RECHT.NOTEN_VERWALTEN);
  if (!benutzer) redirect("/anmelden");

  const sp = await searchParams;
  const semesters = await prisma.semester.findMany({ orderBy: { start: "desc" } });

  if (semesters.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <Link href="/verwaltung" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Verwaltung
        </Link>
        <h1 className="mt-6 text-2xl font-bold tracking-tight">Zeugnisse</h1>
        <p className="mt-4 rounded-lg border border-border bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
          Noch ist kein Semester angelegt.
        </p>
      </main>
    );
  }

  const laufend = semesters.find((s) => s.istAktuell);
  const gewaehltId = sp.semester ?? laufend?.id ?? semesters[0].id;
  const semester = semesters.find((s) => s.id === gewaehltId) ?? semesters[0];
  const typ: GewaehlterTyp = istGewaehlterTyp(sp.typ ?? "") ? (sp.typ as GewaehlterTyp) : "SEMESTER";

  const zeilen = await ladeZeugnisUebersicht(semester.id, typ);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/verwaltung" className="text-sm text-muted-foreground underline underline-offset-4">
        ← Verwaltung
      </Link>
      <h1 className="mt-6 text-2xl font-bold tracking-tight">Zeugnisse</h1>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Ein ausgestelltes Zeugnis wird eingefroren (der Notenstand zum Zeitpunkt der Ausstellung). Eine
        Korrektur läuft über „Neu ausstellen" — das alte Zeugnis wird storniert und durch eine neue
        Ausfertigung ersetzt. Hörer bekommen eine Teilnahmebescheinigung, kein Zeugnis.
      </p>

      <ZeugnisClient
        semesters={semesters.map((s) => ({ id: s.id, bezeichnung: s.bezeichnung }))}
        gewaehltId={semester.id}
        typ={typ}
        zeilen={zeilen.map((z) => ({
          personId: z.personId,
          name: z.name,
          teilnahmeformText: teilnahmeformName(z.teilnahmeform),
          typLabel: zeugnisTitel(z.typ),
          zeugnis: z.zeugnis
            ? { id: z.zeugnis.id, belegNr: z.zeugnis.belegNr, version: z.zeugnis.version, ausgestelltAm: datum(z.zeugnis.ausgestelltAm) }
            : null,
        }))}
      />
    </main>
  );
}
