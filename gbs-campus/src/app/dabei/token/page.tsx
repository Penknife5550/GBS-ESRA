import { EINRICHTUNG } from "@/lib/constants";
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
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <h1 className="text-2xl font-bold tracking-tight">Sind Sie im nächsten Semester dabei?</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Sagen Sie uns mit einem Klick, ob Sie am kommenden Semester der {EINRICHTUNG.name} teilnehmen. Sie
        melden sich damit nicht an — es geht nur um Ihre Rückmeldung. Bis zum Tag vor Semesterbeginn können
        Sie Ihre Antwort über denselben Link noch ändern; das genaue Datum steht in der E-Mail.
      </p>
      <DabeiBestaetigen />
    </main>
  );
}
