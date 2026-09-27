import Link from "next/link";
import { ZurueckLeiste } from "@/components/ui/zurueck-leiste";
import { PasswortAnmeldung } from "./passwort-anmeldung";

export const metadata = { title: "Mit Passwort anmelden" };

export default function PasswortSeite() {
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <ZurueckLeiste href="/anmelden" label="Mit Anmeldelink stattdessen" />

      <h1 className="mt-6 text-3xl font-bold tracking-tight">Mit Passwort anmelden</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Das geht nur, wenn du im Portal ein Passwort gesetzt hast. Es ist freiwillig — der Anmeldelink
        funktioniert weiterhin.
      </p>

      <PasswortAnmeldung />

      {/* Kein eigenes Zuruecksetzen-Verfahren: Der Anmeldelink IST der Weg
          zurueck. Wer ihn anfordert, kommt hinein und setzt im Portal ein neues
          Passwort — ohne zweiten Token-Typ und ohne Wartezeit. */}
      <div className="mt-10 rounded-lg border border-border bg-muted px-4 py-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Passwort vergessen?</p>
        <p className="mt-1">
          Dann{" "}
          <Link href="/anmelden" className="underline underline-offset-4">
            fordere einen Anmeldelink an
          </Link>{" "}
          — damit kommst du sofort hinein und kannst unter „Meine Daten" ein neues Passwort setzen.
        </p>
        <p className="mt-3">
          Du kommst auch an dein Postfach nicht mehr heran?{" "}
          <Link href="/anmelden/hilfe" className="underline underline-offset-4">
            Hier melden
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
