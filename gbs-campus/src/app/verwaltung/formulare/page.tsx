import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { datum, datumZeit } from "@/lib/datum";
import { Inhalt, Seitenkopf } from "@/components/ui/seitenkopf";
import { Gruppe, Zeile } from "@/components/ui/liste";
import { StatusPunkt, type StatusTon } from "@/components/ui/status-punkt";
import { Hinweis, LeererZustand } from "@/components/ui/hinweis";
import { LadeHinweis } from "@/components/ui/lade-hinweis";
import { EntwurfOeffnen } from "./entwurf-oeffnen";

export const metadata = { title: "Formulare" };
export const dynamic = "force-dynamic";

/** Stand einer Fassung als Punkt mit Wort — dieselben Wörter und Farben wie `FormularStatusBadge`. */
function FassungStatus({ status }: { status: string }) {
  const [wort, ton]: [string, StatusTon] =
    status === "ENTWURF" ? ["Entwurf", "gelb"] : status === "VEROEFFENTLICHT" ? ["Veröffentlicht", "gruen"] : ["Archiviert", "grau"];
  return <StatusPunkt ton={ton}>{wort}</StatusPunkt>;
}

export default async function FormulareSeite() {
  const benutzer = await ladeMitRecht(RECHT.FORMULAR_BEARBEITEN);
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
    <main>
      <Seitenkopf titel="Formulare" />
      <Inhalt breite="lesen">
        {formulare.length === 0 && <LeererZustand icon="formulare" titel="Noch ist kein Formular angelegt." />}

        {formulare.map((formular) => (
          <section key={formular.id} className="mt-10 first:mt-0">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold">{formular.bezeichnung}</h2>
                {formular.beschreibung && <p className="text-sm text-muted-foreground">{formular.beschreibung}</p>}
              </div>
              <EntwurfOeffnen formularCode={formular.code} />
            </div>

            <Gruppe className="mt-4">
              {formular.versionen.map((version) => {
                const felder = version.abschnitte.reduce((summe, a) => summe + a._count.felder, 0);
                const wann =
                  version.status === "ENTWURF"
                    ? `zuletzt geändert ${datumZeit(version.aktualisiertAm)}`
                    : version.veroeffentlichtAm
                      ? `veröffentlicht am ${datum(version.veroeffentlichtAm)}`
                      : null;
                return (
                  <Zeile
                    key={version.id}
                    href={`/verwaltung/formulare/${version.id}`}
                    rechts={
                      <>
                        <LadeHinweis />
                        <FassungStatus status={version.status} />
                      </>
                    }
                  >
                    <p className="text-sm font-semibold text-foreground">Fassung {version.version}</p>
                    <p className="text-[13px] text-muted-foreground">
                      {[
                        `${version.abschnitte.length} Abschnitte · ${felder} Felder`,
                        version._count.anmeldungen > 0 ? `${version._count.anmeldungen} Anmeldungen` : null,
                        wann,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </Zeile>
                );
              })}
            </Gruppe>
          </section>
        ))}

        {formulare.length > 0 && (
          <Hinweis className="mt-6">
            Jede Änderung entsteht als neuer Entwurf. Eine veröffentlichte Fassung bleibt unverändert, damit auch später
            nachvollziehbar ist, welche Frage jemand tatsächlich beantwortet hat.
          </Hinweis>
        )}
      </Inhalt>
    </main>
  );
}
