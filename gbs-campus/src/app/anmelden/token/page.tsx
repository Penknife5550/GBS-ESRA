import { OeffentlicheSeite } from "../oeffentlich";
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
 * Wer was abfängt: Gegen die Link-Scanner hilft der Knopf — eingelöst wird erst
 * per POST nach einem Klick, ein bloßer Abruf dieser Seite (Scanner, Bild-Tag,
 * Weiterleitung) löst nichts ein. Gegen Login-CSRF genügt der POST allein
 * nicht: Eine fremde Seite kann /api/auth/token mit einem automatisch
 * abgeschickten Formular genauso per POST aufrufen. Das fängt die
 * Herkunftsprüfung ab (src/middleware.ts, lib/herkunft.ts) — ein POST von
 * fremder Seite trägt einen fremden Origin und wird mit 403 abgewiesen, bevor
 * der Token angefasst wird. Was bleibt, setzt Mitwirkung voraus: Wer einen
 * fremden Anmeldelink selbst öffnet und hier bestätigt, landet im fremden Konto.
 *
 * Der Token steht im URL-FRAGMENT (#token=…), das der Browser nicht an den
 * Server schickt: Diese Seite kennt ihn also gar nicht, die Client-Komponente
 * liest ihn aus location.hash. Damit landet der Kontoschlüssel in keinem
 * Zugriffslog des Reverse Proxy.
 */
export const metadata = { title: "Anmeldung bestätigen" };

export default function TokenSeite() {
  return (
    <OeffentlicheSeite
      titel="Anmeldung bestätigen"
      satz="Ein Klick, und Sie sind angemeldet. Der Link gilt danach als verbraucht."
    >
      <AnmeldungBestaetigen />
    </OeffentlicheSeite>
  );
}
