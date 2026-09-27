import type { ReactNode } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hatRecht, ladeMitRecht } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { RECHT } from "@/lib/constants";
import { datum } from "@/lib/datum";
import { art9EinwilligungenWirksam, art9Freigabe, baueAntwortAnsicht, type AnsichtZeile } from "@/lib/anmeldung-antworten";
import { ZurueckLeiste } from "@/components/ui/zurueck-leiste";
import { AnmeldungStatusBadge } from "@/components/ui/badges";
import { Bankverbindung } from "../bankverbindung";
import { Entscheidung } from "../entscheidung";

export const metadata = { title: "Anmeldung" };
export const dynamic = "force-dynamic";

/**
 * Die Antworten einer Anmeldung — damit die Schulleitung die Bewerbung lesen
 * kann, bevor sie aufnimmt, und die Verwaltung Zahlweise und Einzug erfährt.
 * Vorher waren nicht in die Akte übernommene Antworten in keiner Oberfläche
 * lesbar (Code-Review 4, M13).
 *
 * Schutzregeln:
 *  - Seite nur mit ANMELDUNG_LESEN.
 *  - Art.-9-Antworten nur mit ANMELDUNG_ENTSCHEIDEN UND wirksamen Einwilligungen
 *    in ALLE Art.-9-Texte der Person; sonst kommen ihre Werte gar nicht erst in
 *    die Ansicht (lib/anmeldung-antworten.ts).
 *  - Die IBAN nie im Klartext: Sie steht nicht im Antwortbogen, sondern
 *    verschlüsselt an der Person — erreichbar nur über den bestehenden,
 *    protokollierten Weg (BANKVERBINDUNG_LESEN, „vollständig anzeigen").
 *  - Jeder Abruf steht im Audit-Log — ohne Antwortinhalte.
 */
export default async function AnmeldungAntwortenSeite({ params }: { params: Promise<{ id: string }> }) {
  const benutzer = await ladeMitRecht(RECHT.ANMELDUNG_LESEN);
  if (!benutzer) redirect("/anmelden");

  const { id } = await params;

  const darfEntscheiden = hatRecht(benutzer, RECHT.ANMELDUNG_ENTSCHEIDEN);
  const darfAkteOeffnen = hatRecht(benutzer, RECHT.PERSON_LESEN_ALLE);
  const darfBankSehen = hatRecht(benutzer, RECHT.BANKVERBINDUNG_LESEN);

  const anmeldung = await prisma.anmeldung.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      eingereichtAm: true,
      antworten: true,
      personId: true,
      person: {
        select: { id: true, vorname: true, nachname: true, email: true, ibanVerschluesselt: true },
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

  const person = anmeldung.person;
  const name = person ? `${person.vorname} ${person.nachname}` : null;

  const hatArt9Fragen =
    anmeldung.formularVersion.abschnitte.some((a) => a.felder.some((f) => f.istArt9)) ||
    ansicht.weitere.some((z) => z.art === "art9_verborgen");
  const art9Hinweis = !hatArt9Fragen
    ? null
    : freigabe === "SICHTBAR"
      ? "Diese Anmeldung enthält Angaben zu Glaube und Gemeinde (Art. 9 DSGVO). Die Einwilligung liegt vor; " +
        "die Angaben sind allein für die Aufnahmeentscheidung bestimmt."
      : freigabe === "KEIN_RECHT"
        ? "Angaben zu Glaube und Gemeinde (Art. 9 DSGVO) sind ausgeblendet. Sie sieht nur, wer über die Aufnahme " +
          "entscheidet."
        : "Angaben zu Glaube und Gemeinde (Art. 9 DSGVO) sind ausgeblendet, weil dafür keine wirksame Einwilligung " +
          "vorliegt.";

  function wertAnzeige(zeile: AnsichtZeile) {
    if (zeile.art === "wert") return zeile.wert;
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

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <ZurueckLeiste
        href="/verwaltung/anmeldungen"
        label="Anmeldungen"
        breadcrumb={
          <>
            Verwaltung · Anmeldungen · <b className="font-semibold text-foreground">{name ?? "Ohne Akte"}</b>
          </>
        }
      />

      <h1 className="mt-6 text-2xl font-bold tracking-tight">
        {name ? `Anmeldung von ${name}` : "Anmeldung ohne Akte"}
      </h1>
      {person && <p className="mt-1 break-all text-sm text-muted-foreground">{person.email}</p>}

      <dl className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Stand:</dt>
          <dd>
            {/* Derselbe Badge wie in der Liste — die Einzelansicht soll denselben Stand nicht anders benennen. */}
            <AnmeldungStatusBadge status={anmeldung.status} />
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Eingegangen:</dt>
          <dd>{datum(anmeldung.eingereichtAm)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Formularfassung:</dt>
          <dd>{anmeldung.formularVersion.version}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Semester:</dt>
          <dd>{anmeldung.semester?.bezeichnung ?? "nicht zugeordnet"}</dd>
        </div>
      </dl>

      {person && darfAkteOeffnen && (
        <p className="mt-4 text-sm">
          <Link href={`/verwaltung/personen/${person.id}`} className="underline underline-offset-4">
            Akte öffnen
          </Link>
        </p>
      )}

      <p className="mt-6 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
        {art9Hinweis && <>{art9Hinweis} </>}
        Jeder Abruf dieser Seite wird protokolliert.
      </p>

      {ansicht.abschnitte.length === 0 && ansicht.weitere.length === 0 ? (
        <p className="mt-8 rounded-lg border border-border bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
          Zu dieser Anmeldung sind keine Antworten gespeichert.
        </p>
      ) : (
        <>
          {ansicht.abschnitte.map((block, i) => (
            <AntwortBlock
              key={`${i}-${block.titel}`}
              titel={block.titel}
              zeilen={block.zeilen}
              wertAnzeige={wertAnzeige}
            />
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

      {anmeldung.status === "EINGEREICHT" && darfEntscheiden && person && (
        <section className="mt-10 border-t border-border pt-6">
          <h2 className="text-lg font-semibold">Entscheidung</h2>
          <Entscheidung anmeldungId={anmeldung.id} name={`${person.vorname} ${person.nachname}`} />
        </section>
      )}
    </main>
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
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{titel}</h2>
      {beschreibung && <p className="mt-1 text-sm text-muted-foreground">{beschreibung}</p>}
      {allesVerborgen ? (
        <p className="mt-3 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          {verborgenSatz}
        </p>
      ) : (
        <dl className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
          {zeilen.map((zeile) => (
            <div key={zeile.code} className="px-4 py-3">
              <dt className="text-sm text-muted-foreground">{zeile.label}</dt>
              <dd className="mt-1 whitespace-pre-wrap break-words text-sm">{wertAnzeige(zeile)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
