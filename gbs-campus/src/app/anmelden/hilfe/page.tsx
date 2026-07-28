import Link from "next/link";
import { HilfeFormular } from "./hilfe-formular";

export const metadata = { title: "Ich komme nicht mehr ins Portal" };

export default function HilfeSeite() {
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <Link href="/anmelden" className="text-sm text-muted-foreground underline underline-offset-4">
        ← Zur Anmeldung
      </Link>

      <h1 className="mt-6 text-3xl font-bold tracking-tight">Ich komme nicht mehr rein</h1>

      <div className="mt-4 space-y-3 text-sm text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">Zwei Wege führen ins Portal.</span> Hast du im
          Portal ein Passwort gesetzt, dann{" "}
          <Link href="/anmelden/passwort" className="underline underline-offset-4">
            melde dich damit an
          </Link>{" "}
          — dafür brauchst du dein Postfach nicht. Weißt du deine E-Mail-Adresse noch und erreichst dein
          Postfach, dann{" "}
          <Link href="/anmelden" className="underline underline-offset-4">
            fordere einen neuen Anmeldelink an
          </Link>{" "}
          — er ist jedes Mal frisch. Ein Passwort ist freiwillig; nicht jeder hat eines.
        </p>
        <p>
          Dieses Formular ist für den Fall, dass beides nicht geht: Du weißt nicht mehr, welche Adresse
          hinterlegt ist, oder du kommst an dein altes Postfach nicht mehr heran — und ein Passwort hast
          du auch nicht. Dann meldet sich die Schulleitung bei dir und trägt die neue Adresse ein.
        </p>
        <p>
          Wir ändern nichts allein auf diese Meldung hin — jemand aus der Schulleitung wird sich vorher
          bei dir melden. Das schützt dein Konto davor, dass sich jemand anderes als du ausgibt.
        </p>
      </div>

      <HilfeFormular />

      <p className="mt-8 text-xs text-muted-foreground">
        Deine Angaben werden ausschließlich dafür verwendet, dir wieder Zugang zu verschaffen.
      </p>
    </main>
  );
}
