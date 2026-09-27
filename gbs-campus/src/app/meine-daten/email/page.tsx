import { EmailBestaetigen } from "./bestaetigen";

export const metadata = { title: "Neue E-Mail-Adresse bestätigen" };

/**
 * Zwischenseite für den Bestätigungslink aus der Mail an die NEUE Adresse.
 * Absichtlich ohne Anmeldung erreichbar: Der Link wird im neuen Postfach
 * geöffnet, oft auf einem anderen Gerät.
 *
 * Der Token steht im URL-FRAGMENT (#token=…), das der Browser nicht an den
 * Server schickt — diese Seite kennt ihn also gar nicht. Die Client-Komponente
 * liest ihn und löst per POST ein; so landet er in keinem Zugriffslog
 * (Code-Review 4, wie bei Anmelde- und Auskunftslink).
 */
export default function EmailBestaetigenSeite() {
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <h1 className="text-2xl font-bold tracking-tight">Neue E-Mail-Adresse bestätigen</h1>
      {/* Der erklärende Absatz steht in der Client-Komponente: Er passt nur,
          solange ein Token da und noch nicht eingelöst ist. */}
      <EmailBestaetigen />
    </main>
  );
}
