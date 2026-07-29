import Link from "next/link";
import { redirect } from "next/navigation";
import { ladeAngemeldeten, hatRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { AbmeldenKnopf } from "./abmelden-knopf";

export const dynamic = "force-dynamic";

export default async function VerwaltungSeite() {
  const benutzer = await ladeAngemeldeten();
  if (!benutzer) redirect("/anmelden");

  // Teilnehmer haben hier nichts zu suchen und sahen bisher eine leere Seite
  // mit dem Hinweis, dass nichts freigeschaltet ist. Sie gehören in ihre Akte —
  // der Anmeldelink führt für alle auf diese Seite, die Verzweigung passiert
  // hier.
  if (!hatRecht(benutzer, RECHT.PERSON_LESEN_ALLE) && hatRecht(benutzer, RECHT.PERSON_LESEN_EIGENE)) {
    redirect("/meine-daten");
  }

  const bereiche = [
    {
      titel: "Meine Daten",
      text: "Die eigene Akte ansehen, Kontakt und Bankverbindung pflegen.",
      pfad: "/meine-daten",
      sichtbar: hatRecht(benutzer, RECHT.PERSON_LESEN_EIGENE),
    },
    {
      titel: "Anmeldungen",
      text: "Eingegangene Anmeldungen ansehen, aufnehmen oder ablehnen.",
      pfad: "/verwaltung/anmeldungen",
      sichtbar: hatRecht(benutzer, RECHT.ANMELDUNG_LESEN),
    },
    {
      titel: "Aktive dieses Semester",
      text: "Die Teilnehmerliste des laufenden Semesters, auch als Excel-Datei.",
      pfad: "/verwaltung/teilnehmer",
      sichtbar: hatRecht(benutzer, RECHT.PERSON_LESEN_ALLE),
    },
    {
      titel: "Personen",
      text: "Jemanden wieder hereinlassen: Anmeldeadresse ändern, Anmeldelink schicken.",
      pfad: "/verwaltung/personen",
      sichtbar: hatRecht(benutzer, RECHT.PERSON_LESEN_ALLE),
    },
    {
      titel: "Semester",
      text: "Semester anlegen und festlegen, welches gerade läuft.",
      pfad: "/verwaltung/semester",
      sichtbar: hatRecht(benutzer, RECHT.SEMESTER_VERWALTEN),
    },
    {
      titel: "Semesterüberleitung",
      text: "Den Jahrgang ins Folgesemester einladen und Rückmeldungen verfolgen.",
      pfad: "/verwaltung/semesterueberleitung",
      sichtbar: hatRecht(benutzer, RECHT.SEMESTER_VERWALTEN),
    },
    {
      titel: "Fächer & Kursraster",
      text: "Das 3-Jahres-Kursraster der Schule — Grundstein für den Stundenplan.",
      pfad: "/verwaltung/faecher",
      sichtbar: hatRecht(benutzer, RECHT.SEMESTER_VERWALTEN),
    },
    {
      titel: "Formulare",
      text: "Das Anmeldeformular gestalten und veröffentlichen.",
      pfad: "/verwaltung/formulare",
      sichtbar: hatRecht(benutzer, RECHT.FORMULAR_BEARBEITEN),
    },
    {
      titel: "Einstellungen",
      text: "Gültigkeit der Anmeldelinks, Drosselung, Sitzungsdauer.",
      pfad: "/verwaltung/einstellungen",
      sichtbar: hatRecht(benutzer, RECHT.SYSTEM_EINSTELLUNGEN),
    },
    {
      titel: "Betrieb",
      text: "Nicht zugestellte E-Mails. Wichtig: Ohne Mail kommt niemand ins Portal.",
      pfad: "/verwaltung/betrieb",
      sichtbar: hatRecht(benutzer, RECHT.SYSTEM_EINSTELLUNGEN),
    },
    {
      titel: "Protokoll",
      text: "Wer hat was geändert — das Audit-Log, das niemand löschen kann.",
      pfad: "/verwaltung/protokoll",
      sichtbar: hatRecht(benutzer, RECHT.AUDIT_LESEN),
    },
  ].filter((b) => b.sichtbar);

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Verwaltung</p>
          <h1 className="mt-3 text-2xl font-bold tracking-tight">
            Guten Tag, {benutzer.vorname} {benutzer.nachname}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Angemeldet als {benutzer.rollen.join(", ").toLowerCase() || "ohne Rolle"}.
          </p>
        </div>
        <AbmeldenKnopf />
      </div>

      {bereiche.length === 0 ? (
        <p className="mt-10 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          Für dein Konto ist noch kein Verwaltungsbereich freigeschaltet.
        </p>
      ) : (
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {bereiche.map((bereich) => (
            <Link
              key={bereich.pfad}
              href={bereich.pfad}
              className="rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary"
            >
              <h2 className="font-semibold">{bereich.titel}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{bereich.text}</p>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
