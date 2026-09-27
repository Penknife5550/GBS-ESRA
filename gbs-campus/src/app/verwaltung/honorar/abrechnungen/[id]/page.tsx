import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ladeMitRecht, hatRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { euro } from "@/lib/honorar";
import { datum, datumZeit, heuteBerlin, tagKurz } from "@/lib/datum";
import { dmsAdresse } from "@/lib/konfiguration";
import { ladeAbrechnung } from "@/lib/honorar-abrechnung-io";
import {
  DMS_NICHT_EINGERICHTET,
  dmsVersandText,
  istDmsVersand,
  pruefeAbrechnungNachversand,
} from "@/lib/honorar-korrektur";
import { Inhalt, Seitenkopf } from "@/components/ui/seitenkopf";
import { Abschnitt, Gruppe } from "@/components/ui/liste";
import { StatusPunkt } from "@/components/ui/status-punkt";
import { Hinweis } from "@/components/ui/hinweis";
import { knopf } from "@/components/ui/knopf";
import { MeldungsBox } from "@/components/ui/meldung";
import { AbrechnungStatusPunkt } from "../../abrechnungs-status";
import { BelegNachsendenKnopf } from "../../beleg-nachsenden-knopf";
import { FreigebenKnopf } from "./freigeben-knopf";
import { AuszahlenForm } from "./auszahlen-form";
import { StornierenKnopf } from "./stornieren-knopf";

export const metadata = { title: "Honorar-Abrechnung" };
export const dynamic = "force-dynamic";

/** Zeile der Verlaufsliste: Beschriftung oben, Wert darunter (wie die Kontaktangaben der Akte). */
const EINTRAG = "px-4 py-2.5";
const BESCHRIFTUNG = "text-[13px] text-muted-foreground";
const WERT = "text-sm text-foreground";

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

  // Die eine Hauptaktion je Stand steht oben rechts (Oberflächenplan 09/2026).
  const hauptaktion =
    a.status === "OFFEN" && darfFreigeben ? (
      <FreigebenKnopf
        abrechnungId={a.id}
        gesperrtGrund={a.hatBankverbindung ? null : "Gesperrt: keine Bankverbindung hinterlegt."}
      />
    ) : a.status === "FREIGEGEBEN" ? (
      <AuszahlenForm abrechnungId={a.id} heute={heute} />
    ) : null;

  return (
    <main>
      <Seitenkopf
        zurueck={{ href: `/verwaltung/honorar/abrechnungen?semester=${a.semesterId}`, text: "Abrechnungen" }}
        aktionen={hauptaktion}
      />
      <Inhalt breite="mittel">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight">{a.dozentName}</h1>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <AbrechnungStatusPunkt status={a.status} />
          <span>{a.semester}</span>
          <span>{a.posten.length === 1 ? "1 Abend" : `${a.posten.length} Abende`}</span>
          <span className="font-medium tabular-nums text-foreground">{euro(a.summe)}</span>
        </p>

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

        {a.status === "OFFEN" && (
          <>
            {/* Statischer Hinweis beim Laden — bewusst ohne Alert-Rolle (würde sonst sofort laut angesagt). */}
            {!a.hatBankverbindung && (
              <Hinweis
                className="mt-5"
                aktion={
                  darfAkteSehen && (
                    <Link href={`/verwaltung/personen/${a.dozentId}`} className={knopf("sekundaer", "klein")}>
                      Akte öffnen
                    </Link>
                  )
                }
              >
                Für diesen Dozenten ist keine Bankverbindung hinterlegt. Ohne IBAN kann nicht freigegeben werden. Die
                Bankverbindung trägt der Dozent selbst unter „Meine Daten“ ein.
              </Hinweis>
            )}
            {!darfFreigeben && (
              <Hinweis className="mt-5">
                Die Freigabe (Beleg mit IBAN ans DMS) erfordert zusätzlich das Recht „Bankverbindung sehen“
                (Verwaltung/Finanzbuchhaltung).
              </Hinweis>
            )}
          </>
        )}

        {a.status === "FREIGEGEBEN" && (
          <>
            {/* Direkt nach einer Freigabe ohne DMS-Adresse sagt die Freigabe-Meldung oben schon dasselbe —
                aber nur, solange DMS_EMAIL fehlt; danach ist hier zum Nachsenden aufzufordern. */}
            {!a.dmsGesendetAm && !keineAdresseGemeldet && (
              <Hinweis className="mt-5">
                {dmsEingerichtet
                  ? "Der Zahlungsbeleg ist noch nicht im DMS angekommen. Die Finanzbuchhaltung überweist auf Grundlage " +
                    "dieses Belegs — bitte ihn zuerst nachsenden (bei „DMS-Beleg“), bevor die Abrechnung als " +
                    "ausgezahlt markiert wird."
                  : `Der Zahlungsbeleg ist noch nicht im DMS angekommen. ${DMS_NICHT_EINGERICHTET}`}
              </Hinweis>
            )}
          </>
        )}

        {a.status === "AUSGEZAHLT" && (
          <p role="status" className="mt-5 rounded-xl bg-muted px-4 py-3 text-sm text-foreground">
            Diese Abrechnung ist als ausgezahlt markiert{a.ausgezahltAm ? ` (${datum(a.ausgezahltAm)})` : ""}.
          </p>
        )}

        <div className="mt-7 grid gap-x-8 gap-y-7 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section>
            <Abschnitt titel={`Positionen (${a.posten.length} Abende)`} />
            <Gruppe>
              {a.posten.map((p, i) => (
                <div key={i} className="flex min-h-11 items-center gap-4 px-4 py-2.5 text-sm">
                  <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{tagKurz(p.datum)}</span>
                  <span className="min-w-0 flex-1 truncate">{p.fach ?? "—"}</span>
                  <span className="shrink-0 tabular-nums">{euro(p.betrag)}</span>
                </div>
              ))}
              <div className="flex min-h-11 items-center gap-4 px-4 py-2.5 text-sm font-semibold">
                <span className="flex-1">Summe</span>
                <span className="shrink-0 tabular-nums">{euro(a.summe)}</span>
              </div>
            </Gruppe>
          </section>

          <section>
            <Abschnitt titel="Verlauf" />
            <dl className="divide-y divide-linie overflow-hidden rounded-xl border border-linie bg-card">
              <div className={EINTRAG}>
                <dt className={BESCHRIFTUNG}>Erstellt</dt>
                <dd className={WERT}>
                  {a.erstelltVon ?? "—"} · {datumZeit(a.erstelltAm)}
                </dd>
              </div>
              <div className={EINTRAG}>
                <dt className={BESCHRIFTUNG}>Freigegeben</dt>
                <dd className={WERT}>
                  {a.freigegebenAm ? `${a.freigegebenVon ?? "—"} · ${datumZeit(a.freigegebenAm)}` : "—"}
                </dd>
              </div>
              <div className={EINTRAG}>
                <dt className={BESCHRIFTUNG}>Ausgezahlt am</dt>
                <dd className={WERT}>{a.ausgezahltAm ? datum(a.ausgezahltAm) : "—"}</dd>
              </div>
              <div className={EINTRAG}>
                <dt className={BESCHRIFTUNG}>DMS-Beleg</dt>
                <dd className={WERT}>
                  {a.belegNr ? (
                    <>
                      <span className="block break-all">{a.belegNr}</span>
                      <StatusPunkt ton={a.dmsGesendetAm ? "gruen" : "gelb"} className="mt-0.5">
                        {a.dmsGesendetAm ? `gesendet ${datum(a.dmsGesendetAm)}` : "Versand steht aus"}
                      </StatusPunkt>
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
                <div className={EINTRAG}>
                  <dt className={BESCHRIFTUNG}>Vermerk</dt>
                  <dd className={WERT}>{a.notiz}</dd>
                </div>
              )}
            </dl>
          </section>
        </div>

        {/* Selten und folgenreich: ruhig am Ende statt neben der Hauptaktion. */}
        {a.status === "OFFEN" && (
          <div className="mt-8">
            <StornierenKnopf
              abrechnungId={a.id}
              semesterId={a.semesterId}
              abende={a.posten.length}
              betrag={euro(a.summe)}
            />
          </div>
        )}
      </Inhalt>
    </main>
  );
}
