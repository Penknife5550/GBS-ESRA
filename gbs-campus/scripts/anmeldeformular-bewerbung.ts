/**
 * Legt eine neue Fassung des Anmeldeformulars an, die das
 * "Bewerbungsformular GBS-Minden" (26 Fragen, 5 Abschnitte) abbildet, und
 * veroeffentlicht sie. Die bisher veroeffentlichte Fassung wird archiviert.
 *
 * Ergaenzt gegenueber der Papiervorlage EINE Frage: die Teilnahmeform
 * (Schueler/Hoerer). Die Vorlage fragt sie nicht, die App braucht sie aber
 * fuer die Aufnahme — ohne sie entsteht keine Teilnahme am Semester.
 *
 * ART. 9 (nach Code-Review korrigiert): Alle Glaubens- und Gemeindefelder
 * tragen istArt9=true — auch "motivation" und "ziele", denn die Motivation fuer
 * eine Bibelschule offenbart die religioese Ueberzeugung. Nur so bleiben diese
 * Angaben bis zur gesonderten Einwilligung verborgen UND ungespeichert (der
 * Entwurf-Speicherpfad filtert ueber istArt9). PLZ und Ort sind getrennte
 * Felder mit personFeld PLZ/ORT, der Kontoinhaber ist ein eigenes Feld
 * (personFeld KONTOINHABER) — sonst erreichten diese Angaben die Akte nicht.
 *
 * AUSFUEHREN (nicht Teil des Produktions-Images) gegen eine laufende DB, aus dem
 * Builder-Image, weil lokal tsx/prisma an den Sync-Diensten haengen:
 *   docker run -i --rm -e DATABASE_URL="postgresql://gbs:...@host.docker.internal:5434/gbs_campus" \
 *     gbs-campus-builder:local sh -c "cat > /app/f.ts && npx tsx /app/f.ts" < scripts/anmeldeformular-bewerbung.ts
 *
 * NOCH OFFEN: Dieses Formular ist noch nicht der Seed-Standard. Ein frischer
 * `db:seed` legt weiterhin die aeltere Fassung an (seed.ts, ANMELDEFORMULAR).
 * Fuer die Dauerhaftigkeit gehoert diese Definition in den Seed uebertragen —
 * dann aber den Durchstich (150 Pruefungen) gegen das groessere Formular nachziehen.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Feld = {
  code: string;
  typ: string;
  label: string;
  hilfetext?: string;
  pflicht: boolean;
  personFeld?: string;
  istArt9?: boolean;
  optionen?: string[];
  teilnahmeformZuordnung?: Record<string, string>;
};

const ABSCHNITTE: { titel: string; beschreibung: string | null; felder: Feld[] }[] = [
  {
    titel: "Persönliche Daten",
    beschreibung: null,
    felder: [
      { code: "anrede", typ: "AUSWAHL_EINFACH", label: "Anrede", pflicht: true, optionen: ["Herr", "Frau"] },
      { code: "vorname", typ: "TEXT", label: "Vorname", pflicht: true, personFeld: "VORNAME" },
      { code: "nachname", typ: "TEXT", label: "Nachname", pflicht: true, personFeld: "NACHNAME" },
      { code: "geburtsdatum", typ: "DATUM", label: "Geburtsdatum", pflicht: true, personFeld: "GEBURTSDATUM" },
      { code: "strasse", typ: "TEXT", label: "Straße und Hausnummer", pflicht: true, personFeld: "STRASSE" },
      // Getrennt statt „PLZ und Ort" in einem Feld: nur so landen beide Angaben strukturiert in der Akte
      // (person.plz / person.ort) und stehen für Selbstpflege, Export und Korrespondenz bereit.
      { code: "plz", typ: "TEXT", label: "PLZ", pflicht: true, personFeld: "PLZ" },
      { code: "ort", typ: "TEXT", label: "Ort", pflicht: true, personFeld: "ORT" },
      { code: "email", typ: "EMAIL", label: "E-Mail", hilfetext: "Über diese Adresse läuft später der Zugang zum Portal.", pflicht: true, personFeld: "EMAIL" },
      { code: "telefon", typ: "TELEFON", label: "Telefonnummer / Handynummer", pflicht: true, personFeld: "TELEFON" },
      { code: "familienstand", typ: "AUSWAHL_EINFACH", label: "Familienstand", pflicht: false, optionen: ["Ledig", "Verheiratet", "Geschieden / Getrennt lebend"] },
      { code: "ehepartner_gemeinsam", typ: "JA_NEIN", label: "Ich melde mich gemeinsam mit meiner Frau / meinem Mann an", hilfetext: "Bei gemeinsamer Anmeldung erhält der Ehepartner 50 % Rabatt. Beide Anmeldungen werden einzeln ausgefüllt.", pflicht: false },
    ],
  },
  {
    titel: "Bildung & Beruf",
    beschreibung: null,
    felder: [
      { code: "schulabschluss", typ: "AUSWAHL_EINFACH", label: "Höchster Schulabschluss", pflicht: true, optionen: ["Abitur", "Fachabitur", "Realschulabschluss", "Hauptschulabschluss", "Sonstiges"] },
      { code: "erlernter_beruf", typ: "TEXT", label: "Erlernter Beruf / Ausbildung / Studium", pflicht: true },
      { code: "derzeitiger_beruf", typ: "TEXT", label: "Derzeitiger Beruf", pflicht: true },
    ],
  },
  {
    titel: "Persönlich-Geistlicher Werdegang",
    beschreibung: "Diese Angaben brauchen wir für die Aufnahme an einer Bibelschule. Bitte stimme ihnen weiter unten gesondert zu.",
    felder: [
      { code: "glaube_bekenntnis", typ: "MEHRZEILIG", label: "Glauben Sie an Jesus Christus als Ihren persönlichen Retter und Herrn?", pflicht: true, istArt9: true },
      { code: "glaube_werdegang", typ: "MEHRZEILIG", label: "Beschreiben Sie bitte kurz, wie Sie zum Glauben an Jesus Christus gekommen sind und wie es Ihnen seither im Leben mit Ihm ergangen ist.", pflicht: true, istArt9: true },
    ],
  },
  {
    titel: "Bewerbungshintergrund",
    beschreibung: null,
    felder: [
      { code: "gemeinde_mitglied", typ: "TEXT", label: "In welcher Gemeinde sind Sie Mitglied?", pflicht: true, personFeld: "GEMEINDE", istArt9: true },
      { code: "gemeinde_aktuell", typ: "TEXT", label: "Welche Gemeinde besuchen Sie zurzeit? (Falls abweichend)", pflicht: false, istArt9: true },
      { code: "gemeinde_beteiligung", typ: "MEHRZEILIG", label: "Wie regelmäßig/oft besuchen Sie die Gemeinde und in welcher Form beteiligen Sie sich am Gemeindeleben?", pflicht: true, istArt9: true },
      { code: "dienst_erfahrung", typ: "MEHRZEILIG", label: "Haben Sie schon Erfahrungen im christlichen Dienst (Gemeinde, Mission) gemacht? Wenn ja: Welcher Art und in welchem Zeitraum?", pflicht: true, istArt9: true },
      { code: "dienst_vorbereitung", typ: "MEHRZEILIG", label: "Besuchen Sie die GBS Minden als Vorbereitung für einen konkreten Dienst? Wenn ja: Welchen?", pflicht: false, istArt9: true },
      // istArt9: Motivation und Ziele für den Besuch einer Bibelschule offenbaren regelmäßig die
      // religiöse Überzeugung (Art. 9 DSGVO). Damit ist der ganze Abschnitt Art-9 und wird — wie der
      // Werdegang-Abschnitt — erst nach der gesonderten Einwilligung sichtbar und gespeichert.
      { code: "motivation", typ: "MEHRZEILIG", label: "Was motiviert Sie zum Studium an der GBS Minden?", pflicht: true, istArt9: true },
      { code: "ziele", typ: "MEHRZEILIG", label: "Was möchten Sie persönlich durch den Besuch der GBS Minden erreichen?", hilfetext: "Versuchen Sie bitte, die Ziele so konkret wie möglich zu benennen. Schreiben Sie bitte auch auf, woran Sie erkennen wollen, ob Sie die Ziele erreicht haben.", pflicht: true, istArt9: true },
    ],
  },
  {
    titel: "Teilnahme",
    beschreibung: "Diese Frage stellt das Papierformular nicht — die Schule braucht sie für die Aufnahme.",
    felder: [
      {
        code: "teilnahmeform",
        typ: "AUSWAHL_EINFACH",
        label: "Wie möchten Sie teilnehmen?",
        hilfetext: "Schüler schreiben Prüfungen und erhalten am Ende ein Zeugnis. Hörer nehmen ohne Prüfung teil und bekommen eine Teilnahmebescheinigung.",
        pflicht: true,
        personFeld: "TEILNAHMEFORM",
        optionen: ["Als Schüler — mit Prüfungen", "Als Hörer — ohne Prüfungen"],
        teilnahmeformZuordnung: { "Als Schüler — mit Prüfungen": "SCHUELER", "Als Hörer — ohne Prüfungen": "HOERER" },
      },
    ],
  },
  {
    titel: "Bankverbindung",
    beschreibung: null,
    felder: [
      { code: "beitrag_hinweis", typ: "HINWEIS", label: "Regulär: monatlich 20 €, halbjährlich 120 €. Bei Anmeldung mit Ehepartner: monatlich 30 €, halbjährlich 180 €. Der Beitrag wird per Lastschrift eingezogen; die Rechnung kommt vom Christlichen Werk Esra e.V.", pflicht: false },
      // Kontoinhaber gehört zur SEPA-Lastschrift, für die die IBAN erhoben wird — landet strukturiert
      // in person.kontoinhaber (das Papierformular fragt ihn nicht, die Bankverbindung braucht ihn).
      { code: "kontoinhaber", typ: "TEXT", label: "Kontoinhaber", hilfetext: "Name der Person, von deren Konto der Beitrag eingezogen wird.", pflicht: true, personFeld: "KONTOINHABER" },
      { code: "iban", typ: "IBAN", label: "Ihre IBAN", hilfetext: "Wird verschlüsselt gespeichert und ist nur für die Verwaltung einsehbar.", pflicht: true, personFeld: "IBAN" },
      { code: "bank_name", typ: "TEXT", label: "Name der Bank", pflicht: true },
      { code: "einzug_einverstanden", typ: "JA_NEIN", label: "Ich bin mit dem Einzug der Kursgebühren einverstanden", pflicht: true },
      { code: "zahlweise", typ: "AUSWAHL_EINFACH", label: "Ich möchte die Gebühren wie folgt zahlen", pflicht: true, optionen: ["Monatlich", "Halbjährlich"] },
    ],
  },
];

const EINLEITUNG =
  "Willkommen bei der Anmeldung zur Gemeindebibelschule Minden. Mit * gekennzeichnete Felder sind Pflichtangaben. " +
  "Die Angaben zu Glaube und Gemeinde brauchen wir für die Aufnahme an einer Bibelschule; ihnen stimmst du weiter unten gesondert zu.";

async function main() {
  const formular = await prisma.formular.findFirstOrThrow({ where: { code: "ANMELDUNG" } });
  const letzte = await prisma.formularVersion.findFirst({
    where: { formularId: formular.id },
    orderBy: { version: "desc" },
  });
  const neueVersion = (letzte?.version ?? 0) + 1;

  await prisma.$transaction(async (tx) => {
    await tx.formularVersion.updateMany({
      where: { formularId: formular.id, status: "VEROEFFENTLICHT" },
      data: { status: "ARCHIVIERT" },
    });

    await tx.formularVersion.create({
      data: {
        formularId: formular.id,
        version: neueVersion,
        status: "VEROEFFENTLICHT",
        einleitung: EINLEITUNG,
        veroeffentlichtAm: new Date(),
        abschnitte: {
          create: ABSCHNITTE.map((abschnitt, ai) => ({
            titel: abschnitt.titel,
            beschreibung: abschnitt.beschreibung,
            reihenfolge: ai,
            felder: {
              create: abschnitt.felder.map((feld, fi) => ({
                code: feld.code,
                typ: feld.typ as never,
                label: feld.label,
                hilfetext: feld.hilfetext ?? null,
                pflicht: feld.pflicht,
                reihenfolge: fi,
                optionen: feld.optionen ?? undefined,
                personFeld: (feld.personFeld ?? "NICHTS") as never,
                istArt9: Boolean(feld.istArt9),
                validierung: feld.teilnahmeformZuordnung ? { teilnahmeform: feld.teilnahmeformZuordnung } : undefined,
              })),
            },
          })),
        },
      },
    });
  });

  const felder = ABSCHNITTE.reduce((s, a) => s + a.felder.length, 0);
  console.log(`OK: Fassung ${neueVersion} veroeffentlicht — ${ABSCHNITTE.length} Abschnitte, ${felder} Felder.`);
}

main()
  .catch((f) => {
    console.error(f);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
