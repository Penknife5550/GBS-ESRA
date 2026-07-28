import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { EntwurfOeffnen } from "./entwurf-oeffnen";

export const dynamic = "force-dynamic";

const STATUS_STIL: Record<string, string> = {
  ENTWURF: "bg-credo-gelb/15 text-foreground",
  VEROEFFENTLICHT: "bg-credo-gruen/15 text-foreground",
  ARCHIVIERT: "bg-muted text-muted-foreground",
};

const STATUS_NAME: Record<string, string> = {
  ENTWURF: "Entwurf",
  VEROEFFENTLICHT: "Veröffentlicht",
  ARCHIVIERT: "Archiviert",
};

export default async function FormulareSeite() {
  const benutzer = await ladeMitRecht("FORMULAR_BEARBEITEN");
  if (!benutzer) redirect("/anmelden");

  const formulare = await prisma.formular.findMany({
    include: {
      versionen: {
        orderBy: { version: "desc" },
        include: { _count: { select: { anmeldungen: true } }, abschnitte: { include: { _count: { select: { felder: true } } } } },
      },
    },
    orderBy: { bezeichnung: "asc" },
  });

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-2xl font-bold tracking-tight">Formulare</h1>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Jede Änderung entsteht als neuer Entwurf. Eine veröffentlichte Fassung bleibt unverändert, damit auch später
        nachvollziehbar ist, welche Frage jemand tatsächlich beantwortet hat.
      </p>

      {formulare.map((formular) => (
        <section key={formular.id} className="mt-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{formular.bezeichnung}</h2>
              {formular.beschreibung && <p className="text-sm text-muted-foreground">{formular.beschreibung}</p>}
            </div>
            <EntwurfOeffnen formularCode={formular.code} />
          </div>

          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-card">
            {formular.versionen.map((version) => {
              const felder = version.abschnitte.reduce((summe, a) => summe + a._count.felder, 0);
              return (
                <li key={version.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <span className="w-20 font-medium">Fassung {version.version}</span>
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STIL[version.status]}`}>
                    {STATUS_NAME[version.status]}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {version.abschnitte.length} Abschnitte · {felder} Felder
                    {version._count.anmeldungen > 0 && ` · ${version._count.anmeldungen} Anmeldungen`}
                  </span>
                  <Link
                    href={`/verwaltung/formulare/${version.id}`}
                    className="ml-auto rounded-lg border border-input px-3 py-1.5 text-sm font-medium"
                  >
                    {version.status === "ENTWURF" ? "Bearbeiten" : "Ansehen"}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}
