import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ladeMitRecht, hatRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { euro } from "@/lib/honorar";
import { datum, datumZeit, heuteBerlin } from "@/lib/datum";
import { ladeAbrechnung, abrechnungStatusText } from "@/lib/honorar-abrechnung-io";
import type { HonorarAbrechnungStatus } from "@prisma/client";
import { FreigebenKnopf } from "./freigeben-knopf";
import { AuszahlenForm } from "./auszahlen-form";

export const dynamic = "force-dynamic";

const BADGE: Record<HonorarAbrechnungStatus, string> = {
  OFFEN: "bg-credo-gelb/15 text-foreground",
  FREIGEGEBEN: "bg-credo-blau/15 text-foreground",
  AUSGEZAHLT: "bg-credo-gruen/15 text-foreground",
};

export default async function AbrechnungDetailSeite({ params }: { params: Promise<{ id: string }> }) {
  const benutzer = await ladeMitRecht(RECHT.HONORAR_ABRECHNEN);
  if (!benutzer) redirect("/anmelden");

  const { id } = await params;
  const a = await ladeAbrechnung(id);
  if (!a) notFound();

  const darfFreigeben = hatRecht(benutzer, RECHT.BANKVERBINDUNG_LESEN);
  const heute = heuteBerlin();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/verwaltung/honorar/abrechnungen" className="text-sm text-muted-foreground underline underline-offset-4">
        ← Abrechnungen
      </Link>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Abrechnung — {a.dozentName}</h1>
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE[a.status]}`}>
          {abrechnungStatusText(a.status)}
        </span>
      </div>

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
            {!a.hatBankverbindung && (
              <p role="alert" className="mb-3 rounded-lg bg-credo-gelb/10 px-3 py-2 text-sm text-foreground">
                Für diesen Dozenten ist keine Bankverbindung hinterlegt. Ohne IBAN kann nicht freigegeben werden —
                bitte zuerst die Bankverbindung erfassen.
              </p>
            )}
            {darfFreigeben ? (
              <FreigebenKnopf abrechnungId={a.id} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Die Freigabe (Beleg mit IBAN ans DMS) erfordert zusätzlich das Recht „Bankverbindung sehen"
                (Verwaltung/Finanzbuchhaltung).
              </p>
            )}
          </>
        )}

        {a.status === "FREIGEGEBEN" && <AuszahlenForm abrechnungId={a.id} heute={heute} />}

        {a.status === "AUSGEZAHLT" && (
          <p role="status" className="rounded-lg bg-credo-gruen/10 px-3 py-2 text-sm text-foreground">
            Diese Abrechnung ist als ausgezahlt markiert{a.ausgezahltAm ? ` (${datum(a.ausgezahltAm)})` : ""}.
          </p>
        )}
      </div>
    </main>
  );
}
