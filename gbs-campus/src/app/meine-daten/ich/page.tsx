import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hatRecht, ladeAngemeldeten } from "@/lib/berechtigung";
import { RECHT, type RechtCode } from "@/lib/constants";
import { datum, datumZeit } from "@/lib/datum";
import { zahl } from "@/lib/einstellungen";
import { bereichFuer, initialen, rollenBezeichnung } from "@/lib/navigation";
import { deutscherTag, teilnahmeformName } from "@/lib/semester";
import { TEILNAHME_ZAEHLT } from "@/lib/teilnahme-filter";
import { HandySeite } from "../handy-seite";
import { IchListe } from "../ich-liste";

export const metadata = { title: "Meine Daten" };
export const dynamic = "force-dynamic";

/**
 * „Ich“ — die eigenen Daten (Ziel von „Meine Daten“ im Profil und von „Ich“ in
 * der Leiste unten). Für alle Konten: Teilnehmer, Dozenten und Verwaltung.
 *
 * Änderbar ist nur, was den Kontakt betrifft (Recht PERSON_BEARBEITEN_EIGENE).
 * Geburtsdatum, Gemeinde, Teilnahmeform und Status stehen nur zum Nachlesen da:
 * An ihnen hängt die Aufnahmeentscheidung, und die Gemeindezugehörigkeit ist
 * eine Angabe nach Art. 9 DSGVO. Die Bankverbindung verlässt den Server nie —
 * die Seite erfährt nur, OB eine hinterlegt ist.
 */
export default async function IchSeite() {
  const benutzer = await ladeAngemeldeten();
  if (!benutzer || !hatRecht(benutzer, RECHT.PERSON_LESEN_EIGENE)) redirect("/anmelden");

  const person = await prisma.person.findUnique({
    where: { id: benutzer.id },
    include: {
      status: true,
      ermaessigung: true,
      // Nur zählende Teilnahmen: Eine abgemeldete (Semesterüberleitung) legt die
      // Teilnahmeform nicht fest.
      teilnahmen: { where: TEILNAHME_ZAEHLT, orderBy: { semester: { start: "desc" } }, take: 1 },
    },
  });
  if (!person) redirect("/anmelden");

  const hat = (recht: RechtCode) => hatRecht(benutzer, recht);
  const bereich = bereichFuer(hat);
  const darfBearbeiten = hat(RECHT.PERSON_BEARBEITEN_EIGENE);

  const [offenerEmailAntrag, passwortMinLaenge] = await Promise.all([
    prisma.emailAenderung.findFirst({
      where: { personId: person.id, benutztAm: null, laeuftAb: { gt: new Date() } },
      orderBy: { erstelltAm: "desc" },
      select: { neueEmail: true, laeuftAb: true },
    }),
    darfBearbeiten ? zahl("AUTH_PASSWORT_MIN_LAENGE") : Promise.resolve(0),
  ]);

  const aktuelleForm = person.teilnahmen[0]?.teilnahmeform ?? person.teilnahmeform;
  const hatAusbildung = person.teilnahmen.length > 0 || Boolean(person.teilnahmeform);
  const rolle =
    (bereich === "teilnehmer" ? teilnahmeformName(aktuelleForm) : "") || rollenBezeichnung(benutzer.rollen);

  const angaben = hatAusbildung
    ? [
        { bezeichnung: "Geburtsdatum", wert: deutscherTag(person.geburtsdatum) || "—" },
        { bezeichnung: "Gemeinde", wert: person.gemeinde || "—" },
        { bezeichnung: "Teilnahme", wert: teilnahmeformName(aktuelleForm) || "—" },
        { bezeichnung: "Status", wert: person.status.bezeichnung },
        ...(person.ermaessigung ? [{ bezeichnung: "Ermäßigung", wert: person.ermaessigung.bezeichnung }] : []),
      ]
    : null;

  return (
    <HandySeite titel="Ich">
      <IchListe
        daten={{
          kopf: {
            initialen: initialen(person.vorname, person.nachname),
            name: `${person.vorname} ${person.nachname}`,
            rolle,
            email: person.email,
          },
          stammdaten: {
            telefon: person.telefon ?? "",
            strasse: person.strasse ?? "",
            plz: person.plz ?? "",
            ort: person.ort ?? "",
            kontoinhaber: person.kontoinhaber ?? "",
          },
          hatBankverbindung: Boolean(person.ibanVerschluesselt),
          istDozent: hat(RECHT.EIGENE_TERMINE_LESEN),
          offenerEmailAntrag: offenerEmailAntrag
            ? { neueEmail: offenerEmailAntrag.neueEmail, gueltigBis: datumZeit(offenerEmailAntrag.laeuftAb) }
            : null,
          passwort: {
            hatPasswort: Boolean(person.passwortHash),
            gesetztAm: person.passwortGeaendertAm ? datum(person.passwortGeaendertAm) : null,
            mindestLaenge: passwortMinLaenge,
          },
          angaben,
          ausbildungsWege: bereich !== "teilnehmer" && person.teilnahmen.length > 0,
          darfBearbeiten,
        }}
      />
    </HandySeite>
  );
}
