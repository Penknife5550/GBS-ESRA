import { redirect } from "next/navigation";
import { ladeMitRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { euro } from "@/lib/honorar";
import { ladeHonorarSaetze } from "@/lib/honorar-io";
import { DMS_NICHT_EINGERICHTET, pruefeSatzNachversand } from "@/lib/honorar-korrektur";
import { dmsAdresse } from "@/lib/konfiguration";
import { datum, datumZeit } from "@/lib/datum";
import { Inhalt, Seitenkopf } from "@/components/ui/seitenkopf";
import { Gruppe, Zeile } from "@/components/ui/liste";
import { StatusPunkt } from "@/components/ui/status-punkt";
import { Hinweis, LeererZustand } from "@/components/ui/hinweis";
import { BelegNachsendenKnopf } from "../beleg-nachsenden-knopf";
import { NeuerSatz } from "./satz-form";

export const metadata = { title: "Honorarsätze" };
export const dynamic = "force-dynamic";

/**
 * Honorarsätze verwalten: die Gültig-ab-Historie und das Genehmigen eines neuen
 * Satzes (im Blatt über „Neuer Satz“). Jede Genehmigung erzeugt einen DMS-Beleg
 * mit der kompletten Historie.
 */
export default async function HonorarSaetzeSeite() {
  const benutzer = await ladeMitRecht(RECHT.HONORAR_SATZ_GENEHMIGEN);
  if (!benutzer) redirect("/anmelden");

  const saetze = await ladeHonorarSaetze();
  // Ohne DMS-Adresse endete „Beleg erneut senden“ sicher in einer 500 — dann der Grund statt des Knopfs.
  const dmsEingerichtet = dmsAdresse() !== null;
  const nachsendbar = saetze.filter((s) => pruefeSatzNachversand(s) === null).length;
  // Der geltende Satz wie in satzFuer: die Liste ist nach Gültig-ab, dann Genehmigung absteigend sortiert.
  const jetzt = new Date();
  const geltendId = saetze.find((s) => s.gueltigAb.getTime() <= jetzt.getTime())?.id;

  return (
    <main>
      <Seitenkopf
        zurueck={{ href: "/verwaltung/honorar", text: "Honorar" }}
        titel="Honorarsätze"
        aktionen={<NeuerSatz />}
      />
      <Inhalt breite="lesen">
        {!dmsEingerichtet && nachsendbar > 0 && <Hinweis className="mb-6">{DMS_NICHT_EINGERICHTET}</Hinweis>}

        {saetze.length === 0 ? (
          <LeererZustand icon="honorar" titel="Noch ist kein Satz genehmigt." />
        ) : (
          <Gruppe>
            {saetze.map((s) => (
              <Zeile
                key={s.id}
                rechts={
                  s.id === geltendId ? (
                    <StatusPunkt ton="gruen">gilt jetzt</StatusPunkt>
                  ) : s.gueltigAb.getTime() > jetzt.getTime() ? (
                    <StatusPunkt ton="blau">geplant</StatusPunkt>
                  ) : undefined
                }
              >
                <p className="text-sm font-semibold text-foreground">
                  {euro(s.betrag)} je Abend
                  <span className="font-normal text-muted-foreground"> · ab {datum(s.gueltigAb)}</span>
                </p>
                <p className="text-[13px] text-muted-foreground">
                  Genehmigt: {s.genehmigtVon ?? "System"}, {datumZeit(s.genehmigtAm)}
                </p>
                {s.notiz && <p className="text-[13px] italic text-muted-foreground">{s.notiz}</p>}
                {s.dmsBelegNr && (
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-muted-foreground">
                    <span>Beleg {s.dmsBelegNr}</span>
                    <StatusPunkt ton={s.dmsGesendetAm ? "gruen" : "gelb"}>
                      {s.dmsGesendetAm ? `gesendet ${datum(s.dmsGesendetAm)}` : "Versand steht aus"}
                    </StatusPunkt>
                  </div>
                )}
                {/* Nachversand eines nicht angekommenen Belegs (M12) — dieselbe Regel wie die Route. */}
                {pruefeSatzNachversand(s) === null &&
                  (dmsEingerichtet ? (
                    <BelegNachsendenKnopf
                      pfad={`/api/honorar/saetze/${s.id}/beleg-senden`}
                      rueckfrage={`Beleg ${s.dmsBelegNr} erneut an das DMS senden? Er trägt dieselbe Beleg-Nr.`}
                    />
                  ) : null)}
              </Zeile>
            ))}
          </Gruppe>
        )}

        <Hinweis className="mt-6">
          Jeder Abend wird zu dem Satz gerechnet, der an seinem Datum galt. Eine spätere Änderung
          verändert bereits abgerechnete Beträge nicht; ein Satz mit einem Gültig-ab in der Vergangenheit gilt
          aber für die noch nicht abgerechneten Abende ab diesem Datum.
        </Hinweis>
      </Inhalt>
    </main>
  );
}
