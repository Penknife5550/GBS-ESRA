import Link from "next/link";
import { ladeAngemeldeten } from "@/lib/berechtigung";
import { AbmeldenKnopf } from "@/components/ui/abmelden-knopf";
import { AnmeldeFormular } from "./anmelde-formular";

export const metadata = { title: "Anmelden" };

const FEHLERTEXTE: Record<string, string> = {
  fehlend: "Der Link war unvollständig. Bitte fordern Sie einen neuen an.",
  ungueltig: "Dieser Link ist abgelaufen oder wurde bereits benutzt. Bitte fordern Sie einen neuen an.",
};

export default async function AnmeldenSeite({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string }>;
}) {
  const { fehler } = await searchParams;

  // Wer sich auf einem geteilten Gerät als jemand anderes anmelden will, merkte
  // vorher nicht, dass noch eine Sitzung läuft. Nur ein Hinweis: Scheitert das
  // Nachsehen (etwa Datenbank weg), bleibt die Anmeldeseite trotzdem benutzbar.
  const angemeldet = await ladeAngemeldeten().catch((f: unknown) => {
    console.error("[ANMELDEN] Laufende Sitzung nicht prüfbar:", f);
    return null;
  });

  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <h1 className="text-3xl font-bold tracking-tight">Anmelden</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Geben Sie Ihre E-Mail-Adresse ein. Sie bekommen einen Link, mit dem Sie sich ohne Passwort anmelden.
      </p>

      {angemeldet && (
        <div className="mt-6 rounded-lg border border-border bg-muted px-4 py-4 text-sm">
          <p>
            Sie sind auf diesem Gerät noch als{" "}
            <span className="font-medium">
              {angemeldet.vorname} {angemeldet.nachname}
            </span>{" "}
            angemeldet. Wer sich als jemand anderes anmelden will, meldet sich am besten vorher ab.
          </p>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
            <Link href="/verwaltung" className="py-2 font-medium underline underline-offset-4">
              Weiter zum Portal
            </Link>
            <AbmeldenKnopf />
          </div>
        </div>
      )}

      <AnmeldeFormular linkFehler={fehler ? (FEHLERTEXTE[fehler] ?? null) : null} />

      {/* „Anmelden" (Portal) und „Anmeldung" (Bewerbung) sind leicht zu
          verwechseln. Wer als Interessent hier landet, wartete sonst auf eine
          Mail, die nie kommt. */}
      <p className="mt-8 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Noch nicht an der GBS?</span> Hier melden sich nur
        Teilnehmer, Dozenten und die Verwaltung am Portal an. Für die Bibelschule selbst geht es{" "}
        <Link href="/anmeldung" className="underline underline-offset-4">
          zur Anmeldung
        </Link>
        .
      </p>

      {/* Zwei Wege hinein, damit der Verlust EINES von beiden niemanden
          aussperrt: Der Link braucht das Postfach, das Passwort nicht. */}
      <div className="mt-10 rounded-lg border border-border bg-muted px-4 py-4 text-sm text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">Sie brauchen kein Passwort.</span> Jeder Link ist
          neu und nur einmal verwendbar. Wer im Portal eines gesetzt hat, kann sich auch{" "}
          <Link href="/anmelden/passwort" className="underline underline-offset-4">
            mit Passwort anmelden
          </Link>{" "}
          — das hilft, wenn das Postfach einmal nicht erreichbar ist.
        </p>
        <p className="mt-3">
          Sie wissen nicht mehr, welche Adresse hinterlegt ist, oder kommen an Ihr Postfach nicht mehr
          heran und haben auch kein Passwort?{" "}
          <Link href="/anmelden/hilfe" className="underline underline-offset-4">
            Hier melden
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
