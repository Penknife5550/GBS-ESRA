import type { ReactNode } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hatRecht, ladeMitRecht } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { RECHT } from "@/lib/constants";
import { alsTagesdatum, datum, uhrzeit } from "@/lib/datum";
import { art9EinwilligungenWirksam, art9Freigabe, baueAntwortAnsicht, type AnsichtZeile } from "@/lib/anmeldung-antworten";
import {
  alterInJahren,
  beitragTeile,
  deutschesDatum,
  formalien,
  leseAbschnitte,
  sichtbareAntworten,
  teilnahmeLang,
} from "@/lib/anmeldung-lesen";
import { wartetSeit } from "@/lib/heute";
import { Icon } from "@/components/icons";
import { AnmeldungStatusBadge } from "@/components/ui/badges";
import { Hinweis } from "@/components/ui/hinweis";
import { knopf } from "@/components/ui/knopf";
import { Gruppe } from "@/components/ui/liste";
import { Bankverbindung } from "../bankverbindung";
import { Entscheidung } from "../entscheidung";
import { AnmeldungsListe, alsListenZeile, anmeldungsAnsicht, ladeAnmeldungsListe } from "../anmeldungs-liste";

export const metadata = { title: "Anmeldung" };
export const dynamic = "force-dynamic";

/**
 * Eine Anmeldung zum Lesen (Oberflächenplan 09/2026): links die Liste, rechts
 * der „Brief“ — Name und Eckdaten, dann Motivation, Ziel, Glaube, Gemeinde und
 * Dienst, die Formalien kompakt, leere Antworten ausgeblendet; darunter
 * aufklappbar alle Angaben wie eingereicht. „Aufnehmen“ und „Ablehnen …“ stehen
 * immer oben. Am Handy steht nur die Anmeldung, mit dem Weg zurück zur Liste.
 *
 * Schutzregeln (unverändert):
 *  - Seite nur mit ANMELDUNG_LESEN.
 *  - Art.-9-Antworten nur mit ANMELDUNG_ENTSCHEIDEN UND wirksamen Einwilligungen
 *    in ALLE Art.-9-Texte der Person; sonst kommen ihre Werte gar nicht erst in
 *    die Ansicht (lib/anmeldung-antworten.ts) — und damit auch nicht in die
 *    Lesefassung (lib/anmeldung-lesen.ts).
 *  - Die IBAN nie im Klartext: Sie steht nicht im Antwortbogen, sondern
 *    verschlüsselt an der Person — erreichbar nur über den bestehenden,
 *    protokollierten Weg (BANKVERBINDUNG_LESEN, „vollständig anzeigen").
 *  - Jeder Abruf steht im Audit-Log — ohne Antwortinhalte.
 */
export default async function AnmeldungAntwortenSeite({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ansicht?: string }>;
}) {
  const benutzer = await ladeMitRecht(RECHT.ANMELDUNG_LESEN);
  if (!benutzer) redirect("/anmelden");

  const { id } = await params;
  const listenAnsicht = anmeldungsAnsicht((await searchParams).ansicht);

  const darfEntscheiden = hatRecht(benutzer, RECHT.ANMELDUNG_ENTSCHEIDEN);
  const darfAkteOeffnen = hatRecht(benutzer, RECHT.PERSON_LESEN_ALLE);
  const darfBankSehen = hatRecht(benutzer, RECHT.BANKVERBINDUNG_LESEN);

  const anmeldung = await prisma.anmeldung.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      eingereichtAm: true,
      entschiedenAm: true,
      ablehnungsgrund: true,
      teilnahmeform: true,
      antworten: true,
      personId: true,
      person: {
        select: {
          id: true,
          vorname: true,
          nachname: true,
          email: true,
          ort: true,
          geburtsdatum: true,
          teilnahmeform: true,
          ibanVerschluesselt: true,
        },
      },
      semester: { select: { bezeichnung: true } },
      formularVersion: {
        select: {
          version: true,
          abschnitte: {
            orderBy: { reihenfolge: "asc" },
            select: {
              titel: true,
              felder: {
                orderBy: { reihenfolge: "asc" },
                select: { code: true, typ: true, label: true, istArt9: true, personFeld: true },
              },
            },
          },
        },
      },
    },
  });
  // Entwürfe sind unfertige Eingaben fremder Menschen — sie gehören, wie in der
  // Liste, nicht vor die Augen der Verwaltung.
  if (!anmeldung || anmeldung.status === "ENTWURF") notFound();

  // Die Einwilligung wird nur geladen, wenn sie überhaupt etwas entscheidet.
  // Maßgeblich ist das Protokoll der Person (ein späterer Widerruf zählt), dazu
  // die Zeilen dieser Anmeldung — so greift die Prüfung auch, wenn die
  // Anmeldung keine Akte (mehr) hat. Alle Art.-9-Texte, nicht nur
  // GLAUBENSANGABEN: dieselbe Regel wie beim Speichern und Freischalten
  // (`art9Eingewilligt`) — ein Widerruf irgendeines davon blendet aus.
  const art9Eintraege = darfEntscheiden
    ? await prisma.einwilligung.findMany({
        where: {
          text: { istArt9: true },
          OR: anmeldung.personId
            ? [{ personId: anmeldung.personId }, { anmeldungId: anmeldung.id }]
            : [{ anmeldungId: anmeldung.id }],
        },
        select: { erteilt: true, zeitpunkt: true, text: { select: { code: true } } },
      })
    : [];
  const freigabe = art9Freigabe(
    darfEntscheiden,
    art9EinwilligungenWirksam(art9Eintraege.map((e) => ({ erteilt: e.erteilt, zeitpunkt: e.zeitpunkt, code: e.text.code }))),
  );

  const roh = anmeldung.antworten;
  const antworten = roh && typeof roh === "object" && !Array.isArray(roh) ? (roh as Record<string, unknown>) : {};
  const ansicht = baueAntwortAnsicht(anmeldung.formularVersion.abschnitte, antworten, freigabe === "SICHTBAR");

  // Wer wann welche Bewerbung gelesen hat, gehört ins Protokoll — der Inhalt
  // nicht: Das Audit-Log ist breiter lesbar als die Antworten selbst.
  await protokolliere({
    aktion: "ANMELDUNG_ANTWORTEN_ANGESEHEN",
    objektTyp: "Anmeldung",
    objektId: anmeldung.id,
    akteurId: benutzer.id,
    nachher: { personId: anmeldung.personId, art9Angezeigt: freigabe === "SICHTBAR" },
    headers: await headers(),
  });

  const { anzahlOffen, anmeldungen } = await ladeAnmeldungsListe(listenAnsicht);
  const jetzt = new Date();
  const zeilen = anmeldungen.map((eintrag) =>
    alsListenZeile(eintrag, listenAnsicht, jetzt, <AnmeldungStatusBadge status={eintrag.status} />),
  );

  const person = anmeldung.person;
  const name = person ? `${person.vorname} ${person.nachname}` : null;
  const felder = anmeldung.formularVersion.abschnitte.flatMap((a) => a.felder);

  // --- Lesefassung ----------------------------------------------------------
  const werte = sichtbareAntworten(ansicht);
  const abschnitte = leseAbschnitte(werte, new Set(felder.filter((f) => f.istArt9).map((f) => f.code)));
  const geburt = alsTagesdatum(werte.get("geburtsdatum")?.wert) ?? person?.geburtsdatum ?? null;
  const eckdaten = [
    { label: "Teilnahme", wert: teilnahmeLang(anmeldung.teilnahmeform ?? person?.teilnahmeform) },
    { label: "Semester", wert: anmeldung.semester?.bezeichnung ?? "nicht zugeordnet" },
    { label: "Alter", wert: geburt ? `${alterInJahren(geburt, jetzt)} Jahre` : "" },
    { label: "Wohnort", wert: werte.get("ort")?.wert ?? person?.ort ?? "" },
  ].filter((e) => e.wert);
  const formal = formalien(werte);
  const beitrag = beitragTeile(werte, name);
  // Die IBAN nur als „hinterlegt“ — den Klartext holt allein die Verwaltung über den protokollierten Weg.
  const iban = !person ? null : !person.ibanVerschluesselt ? (
    "keine IBAN"
  ) : darfBankSehen ? (
    <span className="inline-flex flex-wrap items-baseline gap-x-1">
      IBAN <Bankverbindung personId={person.id} hinterlegt />
    </span>
  ) : (
    "IBAN hinterlegt"
  );

  const eingang = anmeldung.eingereichtAm;
  const offen = anmeldung.status === "EINGEREICHT";
  const stand = offen
    ? eingang
      ? `Eingegangen am ${datum(eingang)} um ${uhrzeit(eingang)} · ${wartetSeit(eingang, jetzt)}`
      : "Wartet auf Entscheidung"
    : [eingang ? `Eingegangen am ${datum(eingang)}` : null, anmeldung.entschiedenAm ? `entschieden am ${datum(anmeldung.entschiedenAm)}` : null]
        .filter(Boolean)
        .join(" · ");

  const hatArt9Fragen =
    felder.some((f) => f.istArt9) || ansicht.weitere.some((z) => z.art === "art9_verborgen");
  const art9Hinweis =
    !hatArt9Fragen || freigabe === "SICHTBAR"
      ? null
      : freigabe === "KEIN_RECHT"
        ? "Angaben zu Glaube und Gemeinde (Art. 9 DSGVO) sind ausgeblendet. Sie sieht nur, wer über die Aufnahme " +
          "entscheidet."
        : "Angaben zu Glaube und Gemeinde (Art. 9 DSGVO) sind ausgeblendet, weil dafür keine wirksame Einwilligung " +
          "vorliegt.";
  const fussnote =
    hatArt9Fragen && freigabe === "SICHTBAR"
      ? "Glaube und Gemeinde mit Einwilligung nach Art. 9 DSGVO, allein für die Aufnahmeentscheidung · jeder Abruf wird protokolliert"
      : "Jeder Abruf dieser Seite wird protokolliert";

  const datumsfelder = new Set(felder.filter((f) => f.typ === "DATUM").map((f) => f.code));
  function wertAnzeige(zeile: AnsichtZeile) {
    if (zeile.art === "wert") return datumsfelder.has(zeile.code) ? deutschesDatum(zeile.wert) : zeile.wert;
    if (zeile.art === "art9_verborgen") {
      return <span className="text-muted-foreground">ausgeblendet (Angabe zu Glaube und Gemeinde)</span>;
    }
    // IBAN: nie aus dem Antwortbogen (auch nicht bei Alt-Anmeldungen, die sie
    // noch im Klartext tragen), sondern nur über den abgesicherten Weg. Der
    // Ersatztext sagt, was für DIESE Anmeldung zutrifft.
    if (!person) {
      return (
        <span className="text-muted-foreground">Wird hier nicht angezeigt — zu dieser Anmeldung gibt es keine Akte.</span>
      );
    }
    if (darfBankSehen) {
      return <Bankverbindung personId={person.id} hinterlegt={Boolean(person.ibanVerschluesselt)} />;
    }
    if (!person.ibanVerschluesselt) {
      return <span className="text-muted-foreground">In der Akte ist keine hinterlegt.</span>;
    }
    return (
      <span className="text-muted-foreground">
        Wird hier nicht angezeigt — die IBAN liegt verschlüsselt in der Akte und ist nur für die Verwaltung einsehbar.
      </span>
    );
  }

  const zurueck = `/verwaltung/anmeldungen${listenAnsicht === "entschieden" ? "?ansicht=entschieden" : ""}`;

  return (
    <main className="lg:grid lg:h-[calc(100dvh-6px)] lg:grid-cols-[340px_minmax(0,1fr)]">
      <AnmeldungsListe
        ansicht={listenAnsicht}
        anzahlOffen={anzahlOffen}
        zeilen={zeilen}
        gewaehlt={anmeldung.id}
        ueberschrift="h2"
        className="hidden lg:flex"
      />

      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="border-b border-linie bg-background px-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 py-3 lg:min-h-14 lg:flex-nowrap lg:py-2.5">
            <Link
              href={zurueck}
              className="-ml-1 inline-flex items-center gap-0.5 rounded-md px-1 text-sm font-medium text-primary hover:bg-muted lg:hidden"
            >
              <Icon name="zurueck" className="h-4 w-4" />
              Anmeldungen
            </Link>
            <p title={stand} className="hidden min-w-0 flex-1 truncate text-[13px] text-muted-foreground lg:block">{stand}</p>
            {!offen && (
              <span className="ml-auto lg:ml-0">
                <AnmeldungStatusBadge status={anmeldung.status} />
              </span>
            )}
            {offen && darfEntscheiden && person && (
              <div className="w-full lg:ml-auto lg:w-auto">
                <Entscheidung anmeldungId={anmeldung.id} name={`${person.vorname} ${person.nachname}`} />
              </div>
            )}
          </div>
        </div>

        <article className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-10 lg:py-7">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-foreground">
                <span className="sr-only">Anmeldung von </span>
                {name ?? "Anmeldung ohne Akte"}
              </h1>
              {person && darfAkteOeffnen && (
                <Link href={`/verwaltung/personen/${person.id}`} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
                  Akte öffnen
                </Link>
              )}
            </div>
            <p className="mt-1 text-[13px] text-muted-foreground lg:hidden">{stand}</p>

            {eckdaten.length > 0 && (
              <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
                {eckdaten.map((e) => (
                  <div key={e.label}>
                    <dt className="text-[13px] text-muted-foreground">{e.label}</dt>
                    <dd className="text-[15px] font-medium text-foreground">{e.wert}</dd>
                  </div>
                ))}
              </dl>
            )}

            {anmeldung.status === "ABGELEHNT" && anmeldung.ablehnungsgrund && (
              <Hinweis className="mt-5" icon="hinweis" titel="Abgelehnt:">
                {anmeldung.ablehnungsgrund}
              </Hinweis>
            )}
            {art9Hinweis && (
              <Hinweis className="mt-5" icon="hinweis">
                {art9Hinweis}
              </Hinweis>
            )}

            {abschnitte.length > 0 && (
              <div className="mt-6 space-y-5">
                {abschnitte.map((abschnitt) => (
                  <section key={abschnitt.titel}>
                    <h2 className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-dezent">{abschnitt.titel}</h2>
                    <div className="mt-1 space-y-1.5 text-[15px] leading-relaxed text-foreground">
                      {abschnitt.eintraege.map((eintrag, i) => (
                        <p key={i} className="whitespace-pre-wrap break-words">
                          {eintrag.vorsatz && <span className="text-muted-foreground">{eintrag.vorsatz}: </span>}
                          {eintrag.text}
                        </p>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}

            {(formal.length > 0 || beitrag.length > 0 || iban) && (
              <Gruppe className="mt-6">
                {formal.map((f) => (
                  <Formalie key={f.label} label={f.label}>
                    {f.wert}
                  </Formalie>
                ))}
                {(beitrag.length > 0 || iban) && (
                  <Formalie label="Beitrag">
                    {beitrag.join(" · ")}
                    {beitrag.length > 0 && iban && " · "}
                    {iban}
                  </Formalie>
                )}
              </Gruppe>
            )}

            <details className="group mt-4">
              <summary className={`${knopf("leise")} -ml-3.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
                Alle Angaben wie eingereicht
                <Icon name="aufklappen" className="h-4 w-4 transition-transform group-open:rotate-180" />
              </summary>
              <div className="pb-2">
                {ansicht.abschnitte.length === 0 && ansicht.weitere.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">Zu dieser Anmeldung sind keine Antworten gespeichert.</p>
                ) : (
                  <>
                    {ansicht.abschnitte.map((block, i) => (
                      <AntwortBlock key={`${i}-${block.titel}`} titel={block.titel} zeilen={block.zeilen} wertAnzeige={wertAnzeige} />
                    ))}
                    {ansicht.weitere.length > 0 && (
                      <AntwortBlock
                        titel="Weitere gespeicherte Antworten"
                        beschreibung="Antworten zu Fragen, die diese Formularfassung nicht (mehr) kennt."
                        verborgenGrund="nicht einer Frage zuzuordnen"
                        // Hier gibt es jede Zeile nur, weil eine Antwort gespeichert ist.
                        zaehlt="antworten"
                        zeilen={ansicht.weitere}
                        wertAnzeige={wertAnzeige}
                      />
                    )}
                  </>
                )}
              </div>
            </details>

            <p className="mt-4 text-xs text-dezent">{fussnote}</p>
          </div>
        </article>
      </div>
    </main>
  );
}

/** Beschriftung links, Wert rechts (wie `WertZeile`, aber linksbündig in der Zeile). */
function Formalie({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-4">
      <div className="shrink-0 text-[13px] text-muted-foreground sm:w-32">{label}</div>
      <div className="min-w-0 text-sm text-foreground">{children}</div>
    </div>
  );
}

function AntwortBlock({
  titel,
  beschreibung,
  verborgenGrund = "Angaben zu Glaube und Gemeinde",
  zaehlt = "fragen",
  zeilen,
  wertAnzeige,
}: {
  titel: string;
  beschreibung?: string;
  verborgenGrund?: string;
  /**
   * Was eine Zeile ist: In den Formularabschnitten eine Frage — ob sie
   * beantwortet wurde, bleibt verborgen (bei verweigerter Einwilligung ist
   * nichts gespeichert). Unter „Weitere" steht nur, was gespeichert ist.
   */
  zaehlt?: "fragen" | "antworten";
  zeilen: AnsichtZeile[];
  wertAnzeige: (zeile: AnsichtZeile) => ReactNode;
}) {
  // Ein Abschnitt, der nur aus ausgeblendeten Art.-9-Fragen besteht, wird nicht
  // Zeile für Zeile mit „ausgeblendet" aufgezählt — ein Satz genügt. Gezählt
  // werden Fragen, nicht Antworten: „7 Antworten sind ausgeblendet" behauptete
  // Antworten, wo bei verweigerter Einwilligung gar keine gespeichert sind.
  const allesVerborgen = zeilen.every((z) => z.art === "art9_verborgen");
  const n = zeilen.length;
  const verborgenSatz =
    zaehlt === "antworten"
      ? n === 1
        ? `Die gespeicherte Antwort ist ausgeblendet (${verborgenGrund}).`
        : `Die ${n} gespeicherten Antworten sind ausgeblendet (${verborgenGrund}).`
      : n === 1
        ? `Die Frage dieses Abschnitts ist ausgeblendet (${verborgenGrund}).`
        : `Die ${n} Fragen dieses Abschnitts sind ausgeblendet (${verborgenGrund}).`;

  return (
    <section className="mt-5">
      <h3 className="text-sm font-semibold text-foreground">{titel}</h3>
      {beschreibung && <p className="mt-0.5 text-[13px] text-muted-foreground">{beschreibung}</p>}
      {allesVerborgen ? (
        <p className="mt-2 rounded-xl border border-dashed border-linie px-4 py-3 text-sm text-muted-foreground">{verborgenSatz}</p>
      ) : (
        <dl className="mt-2 divide-y divide-linie rounded-xl border border-linie bg-card">
          {zeilen.map((zeile) => (
            <div key={zeile.code} className="px-4 py-2.5">
              <dt className="text-[13px] text-muted-foreground">{zeile.label}</dt>
              <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground">{wertAnzeige(zeile)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
