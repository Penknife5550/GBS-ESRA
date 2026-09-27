import { redirect } from "next/navigation";
import { ladeMitRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { euro } from "@/lib/honorar";
import { ladeHonorarSaetze } from "@/lib/honorar-io";
import { DMS_NICHT_EINGERICHTET, pruefeSatzNachversand } from "@/lib/honorar-korrektur";
import { dmsAdresse } from "@/lib/konfiguration";
import { datum, datumZeit } from "@/lib/datum";
import { ZurueckLeiste } from "@/components/ui/zurueck-leiste";
import { BelegNachsendenKnopf } from "../beleg-nachsenden-knopf";
import { SatzForm } from "./satz-form";

export const metadata = { title: "Honorarsätze" };
export const dynamic = "force-dynamic";

/**
 * Honorarsätze verwalten: die Gültig-ab-Historie und das Genehmigen eines neuen
 * Satzes. Jede Genehmigung erzeugt einen DMS-Beleg mit der kompletten Historie.
 */
export default async function HonorarSaetzeSeite() {
  const benutzer = await ladeMitRecht(RECHT.HONORAR_SATZ_GENEHMIGEN);
  if (!benutzer) redirect("/anmelden");

  const saetze = await ladeHonorarSaetze();
  // Ohne DMS-Adresse endete „Beleg erneut senden“ sicher in einer 500 — dann der Grund statt des Knopfs.
  const dmsEingerichtet = dmsAdresse() !== null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <ZurueckLeiste href="/verwaltung/honorar" label="Dozentenhonorar" breadcrumb="Verwaltung · Dozentenhonorar · Honorarsätze" />
      <h1 className="mt-6 text-2xl font-bold tracking-tight">Honorarsätze</h1>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Der Honorarsatz je Unterrichtsabend führt eine Historie: jeder Abend wird zu dem Satz gerechnet, der
        zu seinem Datum galt. Eine spätere Änderung verändert bereits abgerechnete Beträge nicht; ein Satz mit
        einem Gültig-ab in der Vergangenheit gilt aber für die noch nicht abgerechneten Abende ab diesem Datum.
        Wer einen Satz einträgt, genehmigt ihn.
      </p>

      <div className="mt-6">
        <SatzForm />
      </div>

      <h2 className="mt-10 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Genehmigte Sätze
      </h2>
      {saetze.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
          Noch ist kein Satz genehmigt.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-muted text-left text-xs uppercase tracking-[0.08em] text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-semibold">Satz</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Gültig ab</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Genehmigt</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">DMS-Beleg</th>
              </tr>
            </thead>
            <tbody>
              {saetze.map((s) => (
                <tr key={s.id} className="border-t border-border align-top">
                  <td className="px-4 py-2.5 font-medium">{euro(s.betrag)}</td>
                  <td className="px-4 py-2.5">{datum(s.gueltigAb)}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {s.genehmigtVon ?? "System"}
                    <br />
                    <span className="text-xs">{datumZeit(s.genehmigtAm)}</span>
                    {s.notiz && <span className="mt-1 block text-xs italic">{s.notiz}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {s.dmsBelegNr ? (
                      <>
                        <span className="block text-xs">{s.dmsBelegNr}</span>
                        <span className="text-xs">
                          {s.dmsGesendetAm ? `gesendet ${datum(s.dmsGesendetAm)}` : "Versand steht aus"}
                        </span>
                        {/* Nachversand eines nicht angekommenen Belegs (M12) — dieselbe Regel wie die Route. */}
                        {pruefeSatzNachversand(s) === null &&
                          (dmsEingerichtet ? (
                            <BelegNachsendenKnopf
                              pfad={`/api/honorar/saetze/${s.id}/beleg-senden`}
                              rueckfrage={`Beleg ${s.dmsBelegNr} erneut an das DMS senden? Er trägt dieselbe Beleg-Nr.`}
                            />
                          ) : (
                            <span className="mt-1 block text-xs">{DMS_NICHT_EINGERICHTET}</span>
                          ))}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
