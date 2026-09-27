import Link from "next/link";
import { Hinweis } from "@/components/ui/hinweis";
import { OeffentlicheSeite } from "../oeffentlich";
import { HilfeFormular } from "./hilfe-formular";

export const metadata = { title: "Ich komme nicht mehr ins Portal" };

const LINK = "font-medium text-primary underline underline-offset-2";

export default function HilfeSeite() {
  return (
    <OeffentlicheSeite
      zurueck={{ href: "/anmelden", text: "Ins Portal" }}
      titel="Ich komme nicht mehr rein"
      satz="Sie wissen nicht mehr, welche Adresse hinterlegt ist, oder kommen an Ihr Postfach nicht mehr heran — und ein Passwort haben Sie auch nicht? Dann meldet sich die Schulleitung bei Ihnen und trägt die neue Adresse ein."
      // Nichts wird allein auf die Meldung hin geändert — das schützt das Konto
      // davor, dass sich jemand anderes als die Person ausgibt.
      fuss="Wir ändern nichts allein auf diese Meldung hin — die Schulleitung meldet sich vorher bei Ihnen. Ihre Angaben dienen nur dazu, Ihnen wieder Zugang zu verschaffen."
    >
      {/* Zwei Wege führen schneller hinein; ein Passwort ist freiwillig, nicht jeder hat eines. */}
      <Hinweis className="mt-6">
        Schneller geht es{" "}
        <Link href="/anmelden/passwort" className={LINK}>
          mit Passwort
        </Link>{" "}
        (dafür brauchen Sie Ihr Postfach nicht) oder mit einem{" "}
        <Link href="/anmelden" className={LINK}>
          neuen Anmeldelink
        </Link>
        .
      </Hinweis>

      <HilfeFormular />
    </OeffentlicheSeite>
  );
}
