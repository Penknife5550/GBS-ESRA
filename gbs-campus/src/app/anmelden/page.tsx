import Link from "next/link";
import { AnmeldeFormular } from "./anmelde-formular";

const FEHLERTEXTE: Record<string, string> = {
  fehlend: "Der Link war unvollständig. Bitte fordere einen neuen an.",
  ungueltig: "Dieser Link ist abgelaufen oder wurde bereits benutzt. Bitte fordere einen neuen an.",
};

export default async function AnmeldenSeite({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string }>;
}) {
  const { fehler } = await searchParams;

  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <h1 className="text-3xl font-bold tracking-tight">Anmelden</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Gib deine E-Mail-Adresse ein. Du bekommst einen Link, mit dem du dich ohne Passwort anmeldest.
      </p>

      <AnmeldeFormular linkFehler={fehler ? (FEHLERTEXTE[fehler] ?? null) : null} />

      {/* Zwei Wege hinein, damit der Verlust EINES von beiden niemanden
          aussperrt: Der Link braucht das Postfach, das Passwort nicht. */}
      <div className="mt-10 rounded-lg border border-border bg-muted px-4 py-4 text-sm text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">Du brauchst kein Passwort.</span> Jeder Link ist
          neu und nur einmal verwendbar. Wer im Portal eines gesetzt hat, kann sich auch{" "}
          <Link href="/anmelden/passwort" className="underline underline-offset-4">
            mit Passwort anmelden
          </Link>{" "}
          — das hilft, wenn das Postfach einmal nicht erreichbar ist.
        </p>
        <p className="mt-3">
          Du weißt nicht mehr, welche Adresse hinterlegt ist, oder kommst an dein Postfach nicht mehr
          heran und hast auch kein Passwort?{" "}
          <Link href="/anmelden/hilfe" className="underline underline-offset-4">
            Hier melden
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
