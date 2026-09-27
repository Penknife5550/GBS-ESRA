import Link from "next/link";
import { EINRICHTUNG } from "@/lib/constants";

/**
 * Startseite unter gbs.fes-credo.de.
 *
 * Vorher stand hier eine Entwickler-Statusseite mit internen Zählwerten der
 * Statusmaschine und Rechtematrix — ungeschützt, und ohne Link auf die
 * Anmeldung. Am 20.08. ist das die erste Seite, die ein Interessent sieht.
 */
export const metadata = {
  // Ohne „· GBS Campus": Die Startseite ist die Seite der Bibelschule.
  title: { absolute: EINRICHTUNG.name },
};

export default function Startseite() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {EINRICHTUNG.traeger}
      </p>
      <h1 className="mt-4 text-4xl font-bold tracking-tight">{EINRICHTUNG.name}</h1>
      <p className="mt-4 max-w-prose text-muted-foreground">
        Drei Jahre Bibelschule am Abend, getragen von sechs Gemeinden. Hier meldest du dich an — und hier
        findest du später deine Unterlagen.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <Link
          href="/anmeldung"
          className="rounded-lg border border-border bg-card p-6 transition-colors hover:border-primary"
        >
          <h2 className="font-semibold">Zur Anmeldung</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Für den Jahrgang 2026–29. Dauert etwa zehn Minuten, du kannst zwischendurch speichern.
          </p>
        </Link>

        <Link
          href="/anmelden"
          className="rounded-lg border border-border bg-card p-6 transition-colors hover:border-primary"
        >
          <h2 className="font-semibold">Anmelden am Portal</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Für Teilnehmer, Dozenten und die Verwaltung. Ohne Passwort — du bekommst einen Link per E-Mail.
          </p>
        </Link>
      </div>
    </main>
  );
}
