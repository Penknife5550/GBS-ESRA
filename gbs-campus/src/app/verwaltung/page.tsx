import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { prisma } from "@/lib/db";
import { ladeAngemeldeten, hatRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { PERSON_ZAEHLT_AKTIV, TEILNAHME_ZAEHLT } from "@/lib/teilnahme-filter";
import { Kachel, type PillTon } from "@/components/ui/kachel";
import type { IconName } from "@/components/icons";
import { AbmeldenKnopf } from "@/components/ui/abmelden-knopf";

export const metadata = { title: "Verwaltung" };
export const dynamic = "force-dynamic";

type KategorieCode = "schueler" | "semester" | "finanzen" | "system" | "konto";

const KATEGORIEN: { code: KategorieCode; titel: string }[] = [
  { code: "schueler", titel: "Schüler & Ausbildung" },
  { code: "semester", titel: "Semester & Kursraster" },
  { code: "finanzen", titel: "Finanzen" },
  { code: "system", titel: "System & Betrieb" },
  { code: "konto", titel: "Mein Konto" },
];

export default async function VerwaltungSeite() {
  const benutzer = await ladeAngemeldeten();
  if (!benutzer) redirect("/anmelden");

  // Rollen-Weiche wie bisher: reiner Dozent in seinen Bereich, reiner Teilnehmer
  // in die eigene Akte.
  if (hatRecht(benutzer, RECHT.EIGENE_TERMINE_LESEN) && !hatRecht(benutzer, RECHT.PERSON_LESEN_ALLE)) {
    redirect("/dozent");
  }
  if (!hatRecht(benutzer, RECHT.PERSON_LESEN_ALLE) && hatRecht(benutzer, RECHT.PERSON_LESEN_EIGENE)) {
    redirect("/meine-daten");
  }

  const darfPersonen = hatRecht(benutzer, RECHT.PERSON_LESEN_ALLE);
  const darfAnmeldungen = hatRecht(benutzer, RECHT.ANMELDUNG_LESEN);
  const darfSystem = hatRecht(benutzer, RECHT.SYSTEM_EINSTELLUNGEN);
  const darfAudit = hatRecht(benutzer, RECHT.AUDIT_LESEN);
  const darfSemester = hatRecht(benutzer, RECHT.SEMESTER_VERWALTEN);

  // Echte Kennzahlen — nur laden, wozu das Konto berechtigt ist (kein Datenleck,
  // keine unnötige Last). Das laufende Semester zuerst, weil die Teilnehmerzahl
  // daran hängt.
  const aktuelles = darfPersonen
    ? await prisma.semester.findFirst({ where: { istAktuell: true }, select: { id: true, bezeichnung: true } })
    : null;

  const [gesamtPersonen, aktivePersonen, offeneAnmeldungen, emailFehler, auditAnzahl, semesterAnzahl, aktiveTeilnahmen] =
    await Promise.all([
      darfPersonen ? prisma.person.count() : Promise.resolve(0),
      darfPersonen ? prisma.person.count({ where: PERSON_ZAEHLT_AKTIV }) : Promise.resolve(0),
      darfAnmeldungen ? prisma.anmeldung.count({ where: { status: "EINGEREICHT" } }) : Promise.resolve(0),
      darfSystem ? prisma.emailVersand.count({ where: { status: { in: ["FEHLER", "BOUNCE"] } } }) : Promise.resolve(0),
      darfAudit ? prisma.auditLog.count() : Promise.resolve(0),
      darfSemester ? prisma.semester.count() : Promise.resolve(0),
      // Dieselbe Menge wie die Teilnehmerliste: aktiv und für das Semester nicht
      // abgemeldet.
      aktuelles
        ? prisma.teilnahme.count({
            where: { semesterId: aktuelles.id, ...TEILNAHME_ZAEHLT, person: PERSON_ZAEHLT_AKTIV },
          })
        : Promise.resolve(0),
    ]);

  type Bereich = {
    titel: string;
    text: string;
    pfad: string;
    icon: IconName;
    kategorie: KategorieCode;
    sichtbar: boolean;
    metric?: ReactNode;
    pill?: { text: string; ton: PillTon };
  };

  const alleBereiche: Bereich[] = [
    {
      titel: "Personen",
      text: "Stammdaten, Detailakte mit Noten und Anwesenheit, Wiederaufnahme, Rollen.",
      pfad: "/verwaltung/personen",
      icon: "personen",
      kategorie: "schueler",
      sichtbar: darfPersonen,
      metric: darfPersonen ? `${gesamtPersonen} Personen · ${aktivePersonen} aktiv` : undefined,
    },
    {
      titel: "Aktive dieses Semester",
      text: "Die Teilnehmerliste des laufenden Semesters, auch als Excel-Datei.",
      pfad: "/verwaltung/teilnehmer",
      icon: "teilnehmer",
      kategorie: "schueler",
      sichtbar: darfPersonen,
      metric: aktuelles ? `${aktiveTeilnahmen} Teilnehmer · ${aktuelles.bezeichnung}` : undefined,
    },
    {
      titel: "Anmeldungen",
      text: "Eingegangene Anmeldungen ansehen, aufnehmen oder ablehnen.",
      pfad: "/verwaltung/anmeldungen",
      icon: "anmeldungen",
      kategorie: "schueler",
      sichtbar: darfAnmeldungen,
      metric: darfAnmeldungen ? `${offeneAnmeldungen} offen` : undefined,
      pill: darfAnmeldungen && offeneAnmeldungen > 0 ? { text: `${offeneAnmeldungen} neu`, ton: "blau" } : undefined,
    },
    {
      titel: "Noten",
      text: "Bewertung je Fach — teilgenommen, bestanden, optional mit Punkten und Note.",
      pfad: "/verwaltung/noten",
      icon: "noten",
      kategorie: "schueler",
      sichtbar: hatRecht(benutzer, RECHT.NOTEN_VERWALTEN),
    },
    {
      titel: "Zeugnisse",
      text: "Semester- und Abschlusszeugnisse, Seriendruck, Korrektur per Neuausstellung.",
      pfad: "/verwaltung/zeugnisse",
      icon: "zeugnisse",
      kategorie: "schueler",
      sichtbar: hatRecht(benutzer, RECHT.NOTEN_VERWALTEN),
    },
    {
      titel: "Semester",
      text: "Semester anlegen und festlegen, welches gerade läuft.",
      pfad: "/verwaltung/semester",
      icon: "semester",
      kategorie: "semester",
      sichtbar: darfSemester,
      metric: darfSemester ? `${aktuelles?.bezeichnung ?? "keines aktiv"} · ${semesterAnzahl} gesamt` : undefined,
    },
    {
      titel: "Semesterüberleitung",
      text: "Den Jahrgang ins Folgesemester einladen und Rückmeldungen verfolgen.",
      pfad: "/verwaltung/semesterueberleitung",
      icon: "ueberleitung",
      kategorie: "semester",
      sichtbar: darfSemester,
    },
    {
      titel: "Fächer & Kursraster",
      text: "Das 3-Jahres-Kursraster der Schule — Grundstein für den Stundenplan.",
      pfad: "/verwaltung/faecher",
      icon: "faecher",
      kategorie: "semester",
      sichtbar: darfSemester,
    },
    {
      titel: "Stundenplan",
      text: "Unterrichtsabende je Semester, Fach- und Dozentenzuordnung, Anwesenheit mit Quote.",
      pfad: "/verwaltung/stundenplan",
      icon: "stundenplan",
      kategorie: "semester",
      sichtbar: darfSemester,
    },
    {
      titel: "Dozentenhonorar",
      text: "Gehaltene Abende je Dozent mit geltendem Satz; Sätze genehmigen, Beleg ans DMS.",
      pfad: "/verwaltung/honorar",
      icon: "honorar",
      kategorie: "finanzen",
      sichtbar: hatRecht(benutzer, RECHT.HONORAR_LESEN),
    },
    {
      titel: "Formulare",
      text: "Das Anmeldeformular gestalten und veröffentlichen.",
      pfad: "/verwaltung/formulare",
      icon: "formulare",
      kategorie: "system",
      sichtbar: hatRecht(benutzer, RECHT.FORMULAR_BEARBEITEN),
    },
    {
      titel: "Einstellungen",
      text: "Gültigkeit der Anmeldelinks, Drosselung, Sitzungsdauer.",
      pfad: "/verwaltung/einstellungen",
      icon: "einstellungen",
      kategorie: "system",
      sichtbar: darfSystem,
    },
    {
      titel: "Betrieb",
      text: "Nicht zugestellte E-Mails, offene DMS-Belege. Ohne Mail kommt, wer kein Passwort hat, nicht ins Portal.",
      pfad: "/verwaltung/betrieb",
      icon: "betrieb",
      kategorie: "system",
      sichtbar: darfSystem,
      metric: darfSystem ? `${emailFehler} Zustellfehler` : undefined,
      pill: darfSystem && emailFehler > 0 ? { text: `${emailFehler} Fehler`, ton: "rot" } : undefined,
    },
    {
      titel: "Protokoll",
      text: "Wer hat was geändert — das Audit-Log, das niemand löschen kann.",
      pfad: "/verwaltung/protokoll",
      icon: "protokoll",
      kategorie: "system",
      sichtbar: darfAudit,
      metric: darfAudit ? `${auditAnzahl.toLocaleString("de-DE")} Einträge` : undefined,
    },
    {
      titel: "Meine Daten",
      text: "Die eigene Akte ansehen, Kontakt und Bankverbindung pflegen.",
      pfad: "/meine-daten",
      icon: "meine-daten",
      kategorie: "konto",
      sichtbar: hatRecht(benutzer, RECHT.PERSON_LESEN_EIGENE),
    },
  ];

  const bereiche = alleBereiche.filter((b) => b.sichtbar);

  const kopfzeile = [
    darfPersonen ? `${aktivePersonen} aktive Personen` : null,
    darfAnmeldungen && offeneAnmeldungen > 0 ? `${offeneAnmeldungen} offene Anmeldungen` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Verwaltung</p>
          <h1 className="mt-3 text-2xl font-bold tracking-tight">
            Guten Tag, {benutzer.vorname} {benutzer.nachname}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {kopfzeile || `Angemeldet als ${benutzer.rollen.join(", ").toLowerCase() || "ohne Rolle"}.`}
          </p>
        </div>
        <AbmeldenKnopf />
      </div>

      {bereiche.length === 0 ? (
        <p className="mt-10 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          Für Ihr Konto ist noch kein Verwaltungsbereich freigeschaltet.
        </p>
      ) : (
        <div className="mt-8 space-y-8">
          {KATEGORIEN.map((kat) => {
            const eintraege = bereiche.filter((b) => b.kategorie === kat.code);
            if (eintraege.length === 0) return null;
            return (
              <section key={kat.code}>
                <div className="mb-3 flex items-baseline gap-3 border-b border-border pb-2">
                  <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-primary">{kat.titel}</h2>
                  <span className="text-xs text-muted-foreground">
                    {eintraege.length} {eintraege.length === 1 ? "Bereich" : "Bereiche"}
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {eintraege.map((b) => (
                    <Kachel
                      key={b.pfad}
                      href={b.pfad}
                      icon={b.icon}
                      titel={b.titel}
                      text={b.text}
                      metric={b.metric}
                      pill={b.pill}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
