import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hatRecht, ladeAngemeldeten } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { deutscherTag, teilnahmeformName } from "@/lib/semester";
import { zahl } from "@/lib/einstellungen";
import { AbmeldenKnopf } from "@/app/verwaltung/abmelden-knopf";
import { StammdatenFormular } from "./stammdaten-formular";
import { EmailAendern } from "./email-aendern";
import { PasswortAbschnitt } from "./passwort-abschnitt";

export const dynamic = "force-dynamic";

/**
 * Die eigene Akte.
 *
 * Änderbar ist, was den Kontakt betrifft — Adresse, Telefon, Bankverbindung und
 * (über den Bestätigungsweg) die E-Mail-Adresse. Name, Geburtsdatum, Gemeinde,
 * Teilnahmeform und Status stehen nur zum Nachlesen da: An ihnen hängt die
 * Aufnahmeentscheidung, und die Gemeindezugehörigkeit ist eine Angabe nach
 * Art. 9 DSGVO, die nicht im Vorbeigehen umgeschrieben werden sollte.
 */
export default async function MeineDatenSeite() {
  const benutzer = await ladeAngemeldeten();
  if (!benutzer || !hatRecht(benutzer, RECHT.PERSON_LESEN_EIGENE)) redirect("/anmelden");

  const person = await prisma.person.findUnique({
    where: { id: benutzer.id },
    include: {
      status: true,
      ermaessigung: true,
      teilnahmen: { include: { semester: true }, orderBy: { semester: { start: "desc" } }, take: 5 },
    },
  });
  if (!person) redirect("/anmelden");

  const hatVerwaltungsbereich = hatRecht(benutzer, RECHT.PERSON_LESEN_ALLE);
  const darfBearbeiten = hatRecht(benutzer, RECHT.PERSON_BEARBEITEN_EIGENE);

  // Ein beantragter Adresswechsel ist sonst nach dem Neuladen unsichtbar: Die
  // Seite zeigt wieder nur die alte Adresse, und der Antrag wirkt verloren.
  const offenerEmailAntrag = await prisma.emailAenderung.findFirst({
    where: { personId: person.id, benutztAm: null, laeuftAb: { gt: new Date() } },
    orderBy: { erstelltAm: "desc" },
    select: { neueEmail: true, laeuftAb: true },
  });

  const unveraenderlich = [
    { bezeichnung: "Name", wert: `${person.vorname} ${person.nachname}` },
    { bezeichnung: "Geburtsdatum", wert: deutscherTag(person.geburtsdatum) || "—" },
    { bezeichnung: "Gemeinde", wert: person.gemeinde ?? "—" },
    { bezeichnung: "Teilnahme", wert: teilnahmeformName(person.teilnahmeform) || "—" },
    { bezeichnung: "Status", wert: person.status.bezeichnung },
    ...(person.ermaessigung ? [{ bezeichnung: "Ermäßigung", wert: person.ermaessigung.bezeichnung }] : []),
  ];

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {hatVerwaltungsbereich && (
            <Link href="/verwaltung" className="text-sm text-muted-foreground underline underline-offset-4">
              ← Verwaltung
            </Link>
          )}
          <h1 className="mt-3 text-2xl font-bold tracking-tight">Meine Daten</h1>
          <p className="mt-2 max-w-prose text-sm text-muted-foreground">
            Was sich ändert, kannst du hier selbst pflegen. Die Verwaltung wird über jede Änderung
            informiert — du musst niemandem gesondert Bescheid geben.
          </p>
        </div>
        <AbmeldenKnopf />
      </div>

      <section className="mt-10">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Zur Ausbildung hinterlegt
        </h2>
        <dl className="grid gap-x-6 gap-y-2 rounded-lg border border-border bg-muted px-5 py-4 text-sm sm:grid-cols-2">
          {unveraenderlich.map((eintrag) => (
            <div key={eintrag.bezeichnung} className="flex min-w-0 gap-2">
              <dt className="text-muted-foreground">{eintrag.bezeichnung}:</dt>
              <dd className="break-words">{eintrag.wert}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 max-w-prose text-xs text-muted-foreground">
          Stimmt hier etwas nicht, wende dich an die Schulleitung — diese Angaben gehören zur
          Aufnahmeentscheidung und lassen sich deshalb nicht selbst ändern.
        </p>

        {person.teilnahmen.length > 0 && (
          <p className="mt-4 text-sm text-muted-foreground">
            Angemeldet für:{" "}
            {person.teilnahmen
              .map((t) => `${t.semester.bezeichnung} (${teilnahmeformName(t.teilnahmeform)})`)
              .join(", ")}
          </p>
        )}
      </section>

      {darfBearbeiten ? (
        <>
          <section className="mt-12">
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Kontakt und Bankverbindung
            </h2>
            <StammdatenFormular
              vorbelegung={{
                telefon: person.telefon ?? "",
                strasse: person.strasse ?? "",
                plz: person.plz ?? "",
                ort: person.ort ?? "",
                kontoinhaber: person.kontoinhaber ?? "",
              }}
              hatBankverbindung={Boolean(person.ibanVerschluesselt)}
            />
          </section>

          <section className="mt-12">
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              E-Mail-Adresse
            </h2>
            <EmailAendern
              bisherige={person.email}
              offenerAntrag={
                offenerEmailAntrag
                  ? {
                      neueEmail: offenerEmailAntrag.neueEmail,
                      gueltigBis: offenerEmailAntrag.laeuftAb.toLocaleString("de-DE", {
                        dateStyle: "short",
                        timeStyle: "short",
                      }),
                    }
                  : null
              }
            />
          </section>

          <section className="mt-12">
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Passwort
            </h2>
            <PasswortAbschnitt
              hatPasswort={Boolean(person.passwortHash)}
              mindestLaenge={await zahl("AUTH_PASSWORT_MIN_LAENGE")}
              gesetztAm={person.passwortGeaendertAm?.toLocaleDateString("de-DE") ?? null}
            />
          </section>
        </>
      ) : (
        <p className="mt-10 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          Dein Konto darf die eigenen Daten zurzeit nur ansehen.
        </p>
      )}
    </main>
  );
}
