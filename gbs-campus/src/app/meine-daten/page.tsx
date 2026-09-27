import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hatRecht, ladeAngemeldeten } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { deutscherTag, teilnahmeformName } from "@/lib/semester";
import { datum, datumZeit } from "@/lib/datum";
import { zahl } from "@/lib/einstellungen";
import { ladeEigeneUnterrichtstermine } from "@/lib/stundenplan-io";
import { ladeEigeneLeistungen } from "@/lib/leistung-io";
import { ladeEigeneZeugnisse } from "@/lib/zeugnis-io";
import { TEILNAHME_ZAEHLT } from "@/lib/teilnahme-filter";
import { ZurueckLeiste } from "@/components/ui/zurueck-leiste";
import { PersonKopf } from "@/components/personen/person-kopf";
import { StatusBadge, TeilnahmeformBadge } from "@/components/ui/badges";
import { QuoteChip } from "@/components/ui/quote-ampel";
import { AbmeldenKnopf } from "@/components/ui/abmelden-knopf";
import { StammdatenFormular } from "./stammdaten-formular";
import { EmailAendern } from "./email-aendern";
import { PasswortAbschnitt } from "./passwort-abschnitt";
import { AnwesenheitAbschnitt } from "./anwesenheit-abschnitt";
import { MeineNotenAbschnitt } from "./meine-noten-abschnitt";
import { MeineZeugnisseAbschnitt } from "./meine-zeugnisse-abschnitt";

export const metadata = { title: "Meine Daten" };
export const dynamic = "force-dynamic";

/**
 * Die eigene Akte — im Layout der Verwaltungs-Detailakte, nur aus der Selbstsicht:
 * Kopf mit unveränderlichen Ausbildungsdaten (read-only), eine Sprungnavigation
 * statt Admin-Aktionen, darunter Anwesenheit, Noten und Zeugnisse (lesend) sowie
 * die selbst pflegbaren Blöcke Kontakt/Bank, E-Mail und Passwort.
 *
 * Änderbar ist nur, was den Kontakt betrifft. Name, Geburtsdatum, Gemeinde,
 * Teilnahmeform und Status stehen nur zum Nachlesen da: An ihnen hängt die
 * Aufnahmeentscheidung, und die Gemeindezugehörigkeit ist eine Angabe nach
 * Art. 9 DSGVO.
 */
export default async function MeineDatenSeite() {
  const benutzer = await ladeAngemeldeten();
  if (!benutzer || !hatRecht(benutzer, RECHT.PERSON_LESEN_EIGENE)) redirect("/anmelden");

  const person = await prisma.person.findUnique({
    where: { id: benutzer.id },
    include: {
      status: true,
      ermaessigung: true,
      // Nur zählende Teilnahmen: Eine abgemeldete (Semesterüberleitung) legt die
      // Teilnahmeform im Kopf nicht fest.
      teilnahmen: {
        where: TEILNAHME_ZAEHLT,
        include: { semester: true },
        orderBy: { semester: { start: "desc" } },
        take: 5,
      },
    },
  });
  if (!person) redirect("/anmelden");

  const hatVerwaltungsbereich = hatRecht(benutzer, RECHT.PERSON_LESEN_ALLE);
  // Dozenten kommen von „Mein Unterricht“ (/dozent verlinkt hierher) und
  // brauchen denselben definierten Rückweg (Plan-Regel 7).
  const hatDozentenbereich = hatRecht(benutzer, RECHT.EIGENE_TERMINE_LESEN);
  const darfBearbeiten = hatRecht(benutzer, RECHT.PERSON_BEARBEITEN_EIGENE);

  const [offenerEmailAntrag, anwesenheitGruppen, notenGruppen, zeugnisse, passwortMinLaenge] = await Promise.all([
    prisma.emailAenderung.findFirst({
      where: { personId: person.id, benutztAm: null, laeuftAb: { gt: new Date() } },
      orderBy: { erstelltAm: "desc" },
      select: { neueEmail: true, laeuftAb: true },
    }),
    ladeEigeneUnterrichtstermine(person.id, new Date()),
    ladeEigeneLeistungen(person.id),
    ladeEigeneZeugnisse(person.id),
    darfBearbeiten ? zahl("AUTH_PASSWORT_MIN_LAENGE") : Promise.resolve(0),
  ]);

  const aktuelleForm = person.teilnahmen[0]?.teilnahmeform ?? person.teilnahmeform;
  const aktuelleQuote = anwesenheitGruppen[0]?.quote ?? null;

  const facts: { bezeichnung: string; wert: ReactNode }[] = [
    { bezeichnung: "Geburtsdatum", wert: deutscherTag(person.geburtsdatum) || "—" },
    { bezeichnung: "Gemeinde", wert: person.gemeinde || "—" },
    { bezeichnung: "Teilnahme", wert: teilnahmeformName(aktuelleForm) || "—" },
    { bezeichnung: "Status", wert: person.status.bezeichnung },
    { bezeichnung: "Anwesenheit", wert: aktuelleQuote ? <QuoteChip quote={aktuelleQuote} /> : "—" },
  ];
  if (person.ermaessigung) facts.push({ bezeichnung: "Ermäßigung", wert: person.ermaessigung.bezeichnung });

  // Sprungnavigation nur auf tatsächlich gerenderte Abschnitte — sonst tote Anker.
  const sprungziele: { id: string; label: string }[] = [];
  if (anwesenheitGruppen.length > 0) sprungziele.push({ id: "anwesenheit", label: "Anwesenheit" });
  if (notenGruppen.length > 0) sprungziele.push({ id: "noten", label: "Noten" });
  if (zeugnisse.length > 0) sprungziele.push({ id: "zeugnisse", label: "Zeugnisse" });
  if (darfBearbeiten) {
    sprungziele.push({ id: "kontakt", label: "Kontakt & Bank" });
    sprungziele.push({ id: "email", label: "E-Mail" });
    sprungziele.push({ id: "passwort", label: "Passwort" });
  }

  const eyebrow = "mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground";

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {hatVerwaltungsbereich ? (
          <ZurueckLeiste href="/verwaltung" label="Verwaltung" breadcrumb="Verwaltung · Meine Daten" />
        ) : hatDozentenbereich ? (
          <ZurueckLeiste href="/dozent" label="Mein Unterricht" breadcrumb="Mein Unterricht · Meine Daten" />
        ) : (
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Meine Akte</p>
        )}
        <AbmeldenKnopf />
      </div>

      <div className="mt-4">
        <PersonKopf
          vorname={person.vorname}
          nachname={person.nachname}
          badges={
            <>
              <StatusBadge code={person.status.code} label={person.status.bezeichnung} />
              <TeilnahmeformBadge form={aktuelleForm} />
            </>
          }
          kontakt={
            <>
              {person.email}
              {person.telefon && <span className="text-muted-foreground"> · {person.telefon}</span>}
            </>
          }
          facts={facts}
          rechts={
            sprungziele.length > 0 ? (
              <nav aria-label="Abschnitte dieser Seite" className="w-full sm:w-52">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">Abschnitte</p>
                <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                  {sprungziele.map((z) => (
                    <li key={z.id}>
                      <a href={`#${z.id}`} className="block px-3 py-2 text-sm hover:bg-muted">
                        {z.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : undefined
          }
        />
      </div>

      <p className="mt-3 max-w-prose text-xs text-muted-foreground">
        Stimmt oben etwas nicht, wenden Sie sich an die Schulleitung — diese Angaben gehören zur Aufnahmeentscheidung und
        lassen sich deshalb nicht selbst ändern. Kontakt, Bankverbindung, E-Mail und Passwort pflegen Sie unten selbst.
      </p>

      {anwesenheitGruppen.length > 0 && (
        <section id="anwesenheit" className="mt-12 scroll-mt-6">
          <h2 className={eyebrow}>Meine Anwesenheit</h2>
          <AnwesenheitAbschnitt gruppen={anwesenheitGruppen} darfBearbeiten={darfBearbeiten} />
        </section>
      )}

      {notenGruppen.length > 0 && (
        <section id="noten" className="mt-12 scroll-mt-6">
          <h2 className={eyebrow}>Meine Noten</h2>
          <MeineNotenAbschnitt gruppen={notenGruppen} />
        </section>
      )}

      {zeugnisse.length > 0 && (
        <section id="zeugnisse" className="mt-12 scroll-mt-6">
          <h2 className={eyebrow}>Meine Zeugnisse</h2>
          <MeineZeugnisseAbschnitt
            zeugnisse={zeugnisse.map((z) => ({
              id: z.id,
              belegNr: z.belegNr,
              titel: z.titel,
              abschnitt: z.abschnitt,
              ausgestelltAm: datum(z.ausgestelltAm),
            }))}
          />
        </section>
      )}

      {darfBearbeiten ? (
        <>
          <section id="kontakt" className="mt-12 scroll-mt-6">
            <h2 className={eyebrow}>Kontakt und Bankverbindung</h2>
            <StammdatenFormular
              vorbelegung={{
                telefon: person.telefon ?? "",
                strasse: person.strasse ?? "",
                plz: person.plz ?? "",
                ort: person.ort ?? "",
                kontoinhaber: person.kontoinhaber ?? "",
              }}
              hatBankverbindung={Boolean(person.ibanVerschluesselt)}
              istDozent={hatDozentenbereich}
            />
          </section>

          <section id="email" className="mt-12 scroll-mt-6">
            <h2 className={eyebrow}>E-Mail-Adresse</h2>
            <EmailAendern
              bisherige={person.email}
              offenerAntrag={
                offenerEmailAntrag
                  ? {
                      neueEmail: offenerEmailAntrag.neueEmail,
                      gueltigBis: datumZeit(offenerEmailAntrag.laeuftAb),
                    }
                  : null
              }
            />
          </section>

          <section id="passwort" className="mt-12 scroll-mt-6">
            <h2 className={eyebrow}>Passwort</h2>
            <PasswortAbschnitt
              hatPasswort={Boolean(person.passwortHash)}
              mindestLaenge={passwortMinLaenge}
              gesetztAm={person.passwortGeaendertAm ? datum(person.passwortGeaendertAm) : null}
            />
          </section>
        </>
      ) : (
        <p className="mt-10 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          Ihr Konto darf die eigenen Daten zurzeit nur ansehen.
        </p>
      )}
    </main>
  );
}
