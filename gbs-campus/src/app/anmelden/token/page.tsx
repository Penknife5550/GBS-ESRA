import { AnmeldungBestaetigen } from "./bestaetigen";

/**
 * Zwischenseite beim Einlösen eines Anmeldelinks.
 *
 * Warum nicht direkt im GET einlösen, wie ganz früher einmal:
 *
 *  1. **Link-Scanner.** Microsoft 365 Safe Links, die Scanner von GMX und
 *     web.de und diverse Virenschutzprogramme rufen Links in E-Mails vorab ab.
 *     Ein im GET verbrauchter Einmal-Token wäre damit entwertet, bevor der
 *     Empfänger überhaupt klickt — bei passwortlosem Login ein vollständiger
 *     Zugangsausfall für einzelne Nutzer, ohne erkennbaren Grund.
 *  2. **Login-CSRF.** Ein Angreifer könnte jemanden per Bild-Tag oder
 *     Weiterleitung auf seinen eigenen Token schicken; das Opfer arbeitete dann
 *     unbemerkt im fremden Konto.
 *
 * Ein Klick auf einen Knopf, der ein POST auslöst, entschärft beides.
 *
 * Der Token steht im URL-FRAGMENT (#token=…), das der Browser nicht an den
 * Server schickt: Diese Seite kennt ihn also gar nicht, die Client-Komponente
 * liest ihn aus location.hash. Damit landet der Kontoschlüssel in keinem
 * Zugriffslog des Reverse Proxy.
 */
export const metadata = { title: "Anmeldung bestätigen" };

export default function TokenSeite() {
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <h1 className="text-2xl font-bold tracking-tight">Anmeldung bestätigen</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Ein Klick, und du bist angemeldet. Der Link gilt danach als verbraucht.
      </p>
      <AnmeldungBestaetigen />
    </main>
  );
}
