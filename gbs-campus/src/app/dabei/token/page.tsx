import { EINRICHTUNG } from "@/lib/constants";
import { OeffentlicheSeite } from "@/app/anmelden/oeffentlich";
import { DabeiBestaetigen } from "./bestaetigen";

/**
 * Öffentliche Rückmeldeseite der Semesterüberleitung: „Ich bin dabei" oder
 * „Ich bin raus".
 *
 * Ohne Anmeldung erreichbar — der Besitz des kurzlebigen Links ist der Nachweis.
 * Der Token steht im URL-FRAGMENT (#token=…), das der Browser nicht an den
 * Server schickt; diese Seite kennt ihn also gar nicht, sondern die
 * Client-Komponente liest ihn und schickt die Antwort per POST. Ein Klick meldet
 * niemanden an, er setzt nur die Rückmeldung an der Teilnahme.
 */
export const metadata = { title: "Sind Sie dabei?" };

export default function DabeiSeite() {
  // Die Frist („Bis zum Tag vor Semesterbeginn …“) steht als Hinweis über den
  // Knöpfen und nach der Antwort mit dem genauen Datum (bestaetigen.tsx).
  return (
    <OeffentlicheSeite
      titel="Sind Sie im nächsten Semester dabei?"
      satz={
        <>
          Sagen Sie uns mit einem Klick, ob Sie am kommenden Semester der {EINRICHTUNG.name} teilnehmen. Sie melden
          sich damit nicht an — es geht nur um Ihre Rückmeldung.
        </>
      }
    >
      <DabeiBestaetigen />
    </OeffentlicheSeite>
  );
}
