import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ladeMitRecht, hatRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { euro } from "@/lib/honorar";
import { datum, datumZeit, heuteBerlin } from "@/lib/datum";
import { dmsAdresse } from "@/lib/konfiguration";
import { ladeAbrechnung } from "@/lib/honorar-abrechnung-io";
import {
  DMS_NICHT_EINGERICHTET,
  dmsVersandText,
  istDmsVersand,
  pruefeAbrechnungNachversand,
} from "@/lib/honorar-korrektur";
import { ZurueckLeiste } from "@/components/ui/zurueck-leiste";
import { AbrechnungStatusBadge } from "@/components/ui/badges";
import { MeldungsBox } from "@/components/ui/meldung";
import { BelegNachsendenKnopf } from "../../beleg-nachsenden-knopf";
import { FreigebenKnopf } from "./freigeben-knopf";
import { AuszahlenForm } from "./auszahlen-form";
import { StornierenKnopf } from "./stornieren-knopf";

export const metadata = { title: "Honorar-Abrechnung" };
export const dynamic = "force-dynamic";

export default async function AbrechnungDetailSeite({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ freigabe?: string }>;
}) {
  const benutzer = await ladeMitRecht(RECHT.HONORAR_ABRECHNEN);
  if (!benutzer) redirect("/anmelden");

  const { id } = await params;
  const sp = await searchParams;
  const a = await ladeAbrechnung(id);
  if (!a) notFound();

  const darfFreigeben = hatRecht(benutzer, RECHT.BANKVERBINDUNG_LESEN);
  const darfAkteSehen = hatRecht(benutzer, RECHT.PERSON_LESEN_ALLE);
  // Nachversand eines nicht angekommenen Belegs (M12): dieselbe Regel wie die Route.
  const nachsendbar = pruefeAbrechnungNachversand(a) === null;
  // Ohne DMS-Adresse endete „Beleg erneut senden“ sicher in einer 500 — dann
  // weder Knopf noch Aufforderung zum Nachsenden, sondern der Grund.
  const dmsEingerichtet = dmsAdresse() !== null;
  // Ausgang der Freigabe (?freigabe=…, gesetzt vom Freigabe-Knopf, der mit dem
  // Statuswechsel aushängt). Nur, solange er zum Stand passt: Nach einem
  // Nachversand ist „nicht zugestellt“ überholt, und „keine DMS-Adresse“ ist es,
  // sobald DMS_EMAIL eingerichtet ist (dann ist Nachsenden erstmals möglich).
  const freigabe = istDmsVersand(sp.freigabe) ? sp.freigabe : null;
  const keineAdresseGemeldet = freigabe === "KEINE_ADRESSE" && !dmsEingerichtet;
  const freigabeText =
    freigabe &&
    a.status === "FREIGEGEBEN" &&
    a.belegNr &&
    (freigabe === "GESENDET") === (a.dmsGesendetAm !== null) &&
    !(freigabe === "KEINE_ADRESSE" && dmsEingerichtet)
      ? dmsVersandText(a.belegNr, freigabe)
      : null;
  const heute = heuteBerlin();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <ZurueckLeiste
        href="/verwaltung/honorar/abrechnungen"
        label="Abrechnungen"
        breadcrumb={
          <>
            Verwaltung · Dozentenhonorar · Abrechnungen · <b className="font-semibold text-foreground">{a.dozentName}</b>
          </>
        }
      />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Abrechnung — {a.dozentName}</h1>
        <AbrechnungStatusBadge status={a.status} />
      </div>

      {/* Die Rückmeldung der Freigabe steht oben und in jedem Stand im DOM: Die
          Live-Region ist so schon da, wenn der Text nach dem Statuswechsel
          kommt (sonst sagen Screenreader ihn oft nicht an), und sie steht im
          Blick statt unter der Positionstabelle. */}
      <MeldungsBox
        meldung={
          freigabeText
            ? { art: freigabe === "GESENDET" ? "ok" : "warnung", text: `Freigegeben. ${freigabeText}` }
            : null
        }
        className="mt-4"
      />

      <dl className="mt-6 grid gap-x-6 gap-y-2 rounded-lg border border-border bg-card p-5 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-4 sm:block">
          <dt className="text-muted-foreground">Semester</dt>
          <dd className="font-medium">{a.semester}</dd>
        </div>
        <div className="flex justify-between gap-4 sm:block">
          <dt className="text-muted-foreground">Summe</dt>
          <dd className="font-medium">{euro(a.summe)}</dd>
        </div>
        <div className="flex justify-between gap-4 sm:block">
          <dt className="text-muted-foreground">Erstellt</dt>
          <dd>{a.erstelltVon ?? "—"} · {datumZeit(a.erstelltAm)}</dd>
        </div>
        <div className="flex justify-between gap-4 sm:block">
          <dt className="text-muted-foreground">Freigegeben</dt>
          <dd>{a.freigegebenAm ? `${a.freigegebenVon ?? "—"} · ${datumZeit(a.freigegebenAm)}` : "—"}</dd>
        </div>
        <div className="flex justify-between gap-4 sm:block">
          <dt className="text-muted-foreground">Ausgezahlt am</dt>
          <dd>{a.ausgezahltAm ? datum(a.ausgezahltAm) : "—"}</dd>
        </div>
        <div className="flex justify-between gap-4 sm:block">
          <dt className="text-muted-foreground">DMS-Beleg</dt>
          <dd>
            {a.belegNr ? (
              <>
                {a.belegNr}
                <span className="block text-xs text-muted-foreground">
                  {a.dmsGesendetAm ? `gesendet ${datum(a.dmsGesendetAm)}` : "Versand steht aus"}
                </span>
                {nachsendbar &&
                  (!dmsEingerichtet ? (
                    <span className="mt-1 block text-xs text-muted-foreground">{DMS_NICHT_EINGERICHTET}</span>
                  ) : darfFreigeben ? (
                    <BelegNachsendenKnopf
                      pfad={`/api/honorar/abrechnungen/${a.id}/beleg-senden`}
                      rueckfrage={`Zahlungsbeleg ${a.belegNr} erneut an das DMS senden? Er enthält die IBAN und trägt dieselbe Beleg-Nr.`}
                    />
                  ) : (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Nachsenden erfordert das Recht „Bankverbindung sehen“.
                    </span>
                  ))}
              </>
            ) : (
              "—"
            )}
          </dd>
        </div>
        {a.notiz && (
          <div className="flex justify-between gap-4 sm:col-span-2 sm:block">
            <dt className="text-muted-foreground">Vermerk</dt>
            <dd>{a.notiz}</dd>
          </div>
        )}
      </dl>

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Positionen ({a.posten.length} Abende)
      </h2>
      <div className="mt-3 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[420px] text-sm">
          <thead className="bg-muted text-left text-xs uppercase tracking-[0.08em] text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-semibold">Datum</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Fach</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Betrag</th>
            </tr>
          </thead>
          <tbody>
            {a.posten.map((p, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-4 py-2.5">{datum(p.datum)}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{p.fach ?? "—"}</td>
                <td className="px-4 py-2.5 font-medium">{euro(p.betrag)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-muted/50">
              <td className="px-4 py-2.5 font-semibold">Summe</td>
              <td className="px-4 py-2.5" />
              <td className="px-4 py-2.5 font-semibold">{euro(a.summe)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-8">
        {a.status === "OFFEN" && (
          <>
            {/* Statischer Hinweis beim Laden — bewusst ohne Alert-Rolle (würde sonst sofort laut angesagt). */}
            {!a.hatBankverbindung && (
              <p className="mb-3 rounded-lg bg-credo-gelb/10 px-3 py-2 text-sm text-foreground">
                Für diesen Dozenten ist keine Bankverbindung hinterlegt. Ohne IBAN kann nicht freigegeben werden. Die
                Bankverbindung trägt der Dozent selbst unter „Meine Daten“ ein.
                {darfAkteSehen && (
                  <>
                    {" "}
                    <Link href={`/verwaltung/personen/${a.dozentId}`} className="underline underline-offset-4">
                      Akte von {a.dozentName} öffnen
                    </Link>
                  </>
                )}
              </p>
            )}
            <div className="flex flex-wrap items-start gap-3">
              {darfFreigeben ? (
                <FreigebenKnopf
                  abrechnungId={a.id}
                  gesperrtGrund={a.hatBankverbindung ? null : "Gesperrt: keine Bankverbindung hinterlegt."}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Die Freigabe (Beleg mit IBAN ans DMS) erfordert zusätzlich das Recht „Bankverbindung sehen"
                  (Verwaltung/Finanzbuchhaltung).
                </p>
              )}
              <StornierenKnopf
                abrechnungId={a.id}
                semesterId={a.semesterId}
                abende={a.posten.length}
                betrag={euro(a.summe)}
              />
            </div>
          </>
        )}

        {a.status === "FREIGEGEBEN" && (
          <>
            {/* Direkt nach einer Freigabe ohne DMS-Adresse sagt die Freigabe-Meldung oben schon dasselbe —
                aber nur, solange DMS_EMAIL fehlt; danach ist hier zum Nachsenden aufzufordern. */}
            {!a.dmsGesendetAm && !keineAdresseGemeldet && (
              <p className="mb-3 rounded-lg bg-credo-gelb/10 px-3 py-2 text-sm text-foreground">
                {dmsEingerichtet
                  ? "Der Zahlungsbeleg ist noch nicht im DMS angekommen. Die Finanzbuchhaltung überweist auf Grundlage " +
                    "dieses Belegs — bitte ihn zuerst nachsenden (oben bei „DMS-Beleg“), bevor die Abrechnung als " +
                    "ausgezahlt markiert wird."
                  : `Der Zahlungsbeleg ist noch nicht im DMS angekommen. ${DMS_NICHT_EINGERICHTET}`}
              </p>
            )}
            <AuszahlenForm abrechnungId={a.id} heute={heute} />
          </>
        )}

        {a.status === "AUSGEZAHLT" && (
          <p role="status" className="rounded-lg bg-credo-gruen/10 px-3 py-2 text-sm text-foreground">
            Diese Abrechnung ist als ausgezahlt markiert{a.ausgezahltAm ? ` (${datum(a.ausgezahltAm)})` : ""}.
          </p>
        )}
      </div>
    </main>
  );
}
