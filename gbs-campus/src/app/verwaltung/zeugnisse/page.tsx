import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { datum } from "@/lib/datum";
import { dmsAdresse } from "@/lib/konfiguration";
import { teilnahmeformName } from "@/lib/semester";
import { istGewaehlterTyp, zeugnisTitel, type GewaehlterTyp } from "@/lib/zeugnis";
import { ladeSammelVorschau, ladeZeugnisUebersicht, zaehleOffeneDmsArchivierungen } from "@/lib/zeugnis-io";
import { nichtsAuszustellenHinweis, sammellaufRueckfrage, sammellaufSperre } from "@/lib/zeugnis-sammellauf";
import { ZurueckLeiste } from "@/components/ui/zurueck-leiste";
import { DmsNachversand } from "./dms-nachversand";
import { ZeugnisClient } from "./zeugnis-client";

export const metadata = { title: "Zeugnisse" };
export const dynamic = "force-dynamic";

/**
 * Zeugnis-Verwaltung der Schulleitung (Recht NOTEN_VERWALTEN). Je Semester und
 * gewähltem Typ (Semester-Zeugnis bzw. Abschlusszeugnis) die aktiven Teilnehmer
 * mit ihrem aktuell gültigen Zeugnis — ohne gültiges mit einem stornierten bzw.
 * dem Hinweis, dass ein Hörer keinen besuchten Abend hat. Ausstellen
 * (einzeln/gesammelt), neu ausstellen (ersetzen), stornieren (ohne Ersatz) und
 * Serien-/Einzeldruck laufen im Client; die Zahlen für die Rückfrage vor dem
 * Sammellauf und die Zahl der noch nicht im DMS archivierten Zeugnisse ermittelt
 * die Seite serverseitig.
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
        <ZurueckLeiste href="/verwaltung" label="Verwaltung" breadcrumb="Verwaltung · Zeugnisse" />
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

  const [zeilen, offenImDms] = await Promise.all([ladeZeugnisUebersicht(semester.id, typ), zaehleOffeneDmsArchivierungen()]);
  // Rückfrage vor „Alle ausstellen“: die Zahlen hier serverseitig ermitteln, nicht
  // im Browser schätzen.
  const vorschau = await ladeSammelVorschau(semester, typ, zeilen);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <ZurueckLeiste href="/verwaltung" label="Verwaltung" breadcrumb="Verwaltung · Zeugnisse" />
      <h1 className="mt-6 text-2xl font-bold tracking-tight">Zeugnisse</h1>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Ein ausgestelltes Zeugnis wird eingefroren (der Notenstand zum Zeitpunkt der Ausstellung). Eine
        Korrektur läuft über „Neu ausstellen“ — das alte Zeugnis wird durch eine neue Ausfertigung ersetzt.
        Eine Fehlausstellung ziehen Sie über „Stornieren“ ohne Ersatz zurück — das Dokument wird ungültig und
        bleibt als Nachweis gespeichert. Hörer bekommen eine Teilnahmebescheinigung mit den Fächern, in denen sie
        mindestens einen Abend besucht haben; ohne besuchten Abend gibt es keine.
      </p>

      <DmsNachversand offen={offenImDms} dmsEingerichtet={dmsAdresse() !== null} />

      <ZeugnisClient
        semesters={semesters.map((s) => ({ id: s.id, bezeichnung: s.bezeichnung }))}
        gewaehltId={semester.id}
        typ={typ}
        sammellauf={{
          rueckfrage: sammellaufRueckfrage(vorschau, typ, semester.bezeichnung),
          sperre: sammellaufSperre(typ, semester),
          auszustellen: vorschau.zeugnisse + vorschau.bescheinigungen,
          hinweis: nichtsAuszustellenHinweis(vorschau),
        }}
        zeilen={zeilen.map((z) => ({
          personId: z.personId,
          name: z.name,
          teilnahmeformText: teilnahmeformName(z.teilnahmeform),
          typ: z.typ,
          typLabel: zeugnisTitel(z.typ),
          zeugnis: z.zeugnis
            ? { id: z.zeugnis.id, belegNr: z.zeugnis.belegNr, version: z.zeugnis.version, ausgestelltAm: datum(z.zeugnis.ausgestelltAm) }
            : null,
          storniert: z.storniert
            ? { id: z.storniert.id, belegNr: z.storniert.belegNr, storniertAm: datum(z.storniert.storniertAm) }
            : null,
          ohneAnwesenheit: z.besuchteFaecher === 0,
        }))}
      />
    </main>
  );
}
