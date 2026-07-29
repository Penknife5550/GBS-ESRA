import { DabeiBestaetigen } from "./bestaetigen";

/**
 * Öffentliche „Ich bin dabei"-Seite der Semesterüberleitung.
 *
 * Ohne Anmeldung erreichbar — der Besitz des kurzlebigen Links ist der Nachweis.
 * Der Token steht im URL-FRAGMENT (#token=…), das der Browser nicht an den
 * Server schickt; diese Seite kennt ihn also gar nicht, sondern die
 * Client-Komponente liest ihn und bestätigt per POST. Ein Klick meldet niemanden
 * an, er setzt nur die Teilnahme auf „bestätigt".
 */
export const metadata = { title: "Bist du dabei?" };

export default function DabeiSeite() {
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <h1 className="text-2xl font-bold tracking-tight">Bist du im nächsten Semester dabei?</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Mit einem Klick bestätigst du deine Teilnahme am kommenden Semester der Gemeindebibelschule
        Minden. Du meldest dich damit nicht an — es geht nur um deine Rückmeldung.
      </p>
      <DabeiBestaetigen />
    </main>
  );
}
