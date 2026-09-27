import Link from "next/link";
import { ladeAngemeldeten } from "@/lib/berechtigung";
import { AbmeldenKnopf } from "@/components/ui/abmelden-knopf";
import { AnmeldeFormular } from "./anmelde-formular";
import { OeffentlicheSeite, TEXTLINK } from "./oeffentlich";

export const metadata = { title: "Anmelden" };

const FEHLERTEXTE: Record<string, string> = {
  fehlend: "Der Link war unvollständig. Bitte fordern Sie einen neuen an.",
  ungueltig: "Dieser Link ist abgelaufen oder wurde bereits benutzt. Bitte fordern Sie einen neuen an.",
};

/**
 * Ins Portal (Oberflächenplan 09/2026): ein Satz, ein Feld, ein Knopf. Die
 * früheren Erklärabsätze sind zwei Links darunter — „Mit Passwort anmelden“
 * (der zweite Weg hinein, wenn das Postfach nicht erreichbar ist) und „Hilfe“
 * (wenn beides nicht geht).
 */
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
    <OeffentlicheSeite
      zurueck={{ href: "/", text: "Start" }}
      titel="Ins Portal"
      satz="Wir schicken Ihnen einen Anmeldelink per E-Mail. Ein Passwort brauchen Sie nicht."
      fuss={
        // „Anmelden" (Portal) und „Anmeldung" (Bewerbung) sind leicht zu
        // verwechseln. Wer als Interessent hier landet, wartete sonst auf eine
        // Mail, die nie kommt.
        <>
          Noch nicht dabei?{" "}
          <Link href="/anmeldung" className="font-medium text-primary underline-offset-4 hover:underline">
            Zur Anmeldung
          </Link>
        </>
      }
    >
      {angemeldet && (
        <div className="mt-6 rounded-xl bg-muted px-4 py-3.5 text-sm text-foreground">
          <p>
            Sie sind auf diesem Gerät noch als{" "}
            <span className="font-medium">
              {angemeldet.vorname} {angemeldet.nachname}
            </span>{" "}
            angemeldet. Wer sich als jemand anderes anmelden will, meldet sich am besten vorher ab.
          </p>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <Link href="/verwaltung" className={TEXTLINK}>
              Weiter zum Portal
            </Link>
            <AbmeldenKnopf />
          </div>
        </div>
      )}

      <AnmeldeFormular linkFehler={fehler ? (FEHLERTEXTE[fehler] ?? null) : null} />

      {/* Zwei Wege hinein, damit der Verlust EINES von beiden niemanden
          aussperrt: Der Link braucht das Postfach, das Passwort nicht. */}
      <div className="mt-3 flex items-center justify-between gap-4">
        <Link href="/anmelden/passwort" className={TEXTLINK}>
          Mit Passwort anmelden
        </Link>
        <Link href="/anmelden/hilfe" className={TEXTLINK}>
          Hilfe
        </Link>
      </div>
    </OeffentlicheSeite>
  );
}
