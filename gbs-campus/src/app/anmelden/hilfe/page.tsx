import Link from "next/link";
import { ZurueckLeiste } from "@/components/ui/zurueck-leiste";
import { HilfeFormular } from "./hilfe-formular";

export const metadata = { title: "Ich komme nicht mehr ins Portal" };

export default function HilfeSeite() {
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <ZurueckLeiste href="/anmelden" label="Zur Anmeldung" />

      <h1 className="mt-6 text-3xl font-bold tracking-tight">Ich komme nicht mehr rein</h1>

      <div className="mt-4 space-y-3 text-sm text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">Zwei Wege führen ins Portal.</span> Haben Sie im
          Portal ein Passwort gesetzt, dann{" "}
          <Link href="/anmelden/passwort" className="underline underline-offset-4">
            melden Sie sich damit an
          </Link>{" "}
          — dafür brauchen Sie Ihr Postfach nicht. Wissen Sie Ihre E-Mail-Adresse noch und erreichen Sie Ihr
          Postfach, dann{" "}
          <Link href="/anmelden" className="underline underline-offset-4">
            fordern Sie einen neuen Anmeldelink an
          </Link>{" "}
          — er ist jedes Mal frisch. Ein Passwort ist freiwillig; nicht jeder hat eines.
        </p>
        <p>
          Dieses Formular ist für den Fall, dass beides nicht geht: Sie wissen nicht mehr, welche Adresse
          hinterlegt ist, oder Sie kommen an Ihr altes Postfach nicht mehr heran — und ein Passwort haben
          Sie auch nicht. Dann meldet sich die Schulleitung bei Ihnen und trägt die neue Adresse ein.
        </p>
        <p>
          Wir ändern nichts allein auf diese Meldung hin — jemand aus der Schulleitung wird sich vorher
          bei Ihnen melden. Das schützt Ihr Konto davor, dass sich jemand anderes als Sie ausgibt.
        </p>
      </div>

      <HilfeFormular />

      <p className="mt-8 text-xs text-muted-foreground">
        Ihre Angaben werden ausschließlich dafür verwendet, Ihnen wieder Zugang zu verschaffen.
      </p>
    </main>
  );
}
