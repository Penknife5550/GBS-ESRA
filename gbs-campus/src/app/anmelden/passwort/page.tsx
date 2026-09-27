import Link from "next/link";
import { OeffentlicheSeite, TEXTLINK } from "../oeffentlich";
import { PasswortAnmeldung } from "./passwort-anmeldung";

export const metadata = { title: "Mit Passwort anmelden" };

export default function PasswortSeite() {
  return (
    <OeffentlicheSeite
      zurueck={{ href: "/anmelden", text: "Ins Portal" }}
      titel="Mit Passwort anmelden"
      satz="Das geht nur, wenn Sie im Portal ein Passwort gesetzt haben. Es ist freiwillig — der Anmeldelink funktioniert weiterhin."
      fuss={
        // Kein eigenes Zuruecksetzen-Verfahren: Der Anmeldelink IST der Weg
        // zurueck. Wer ihn anfordert, kommt hinein und setzt im Portal ein neues
        // Passwort — ohne zweiten Token-Typ und ohne Wartezeit.
        <>
          Passwort vergessen? Mit dem Anmeldelink kommen Sie sofort hinein und können unter „Meine Daten“ ein neues
          Passwort setzen.
        </>
      }
    >
      <PasswortAnmeldung />

      <div className="mt-3 flex items-center justify-between gap-4">
        <Link href="/anmelden" className={TEXTLINK}>
          Anmeldelink anfordern
        </Link>
        <Link href="/anmelden/hilfe" className={TEXTLINK}>
          Hilfe
        </Link>
      </div>
    </OeffentlicheSeite>
  );
}
