import Link from "next/link";
import { knopf } from "@/components/ui/knopf";
import { EINRICHTUNG } from "@/lib/constants";

/**
 * Startseite unter gbs.fes-credo.de.
 *
 * Vorher stand hier eine Entwickler-Statusseite mit internen Zählwerten der
 * Statusmaschine und Rechtematrix — ungeschützt, und ohne Link auf die
 * Anmeldung. Am 20.08. ist das die erste Seite, die ein Interessent sieht.
 *
 * Oberflächenplan 09/2026 („Zwei klare Wege“): eine ruhige Marke und zwei
 * eindeutige Knöpfe statt zweier Karten, die nicht wie Knöpfe aussahen. Der
 * Name trennt am Handy mit Silbentrennung, statt rechts aus dem Bild zu laufen.
 */
export const metadata = {
  // Ohne „· GBS Campus": Die Startseite ist die Seite der Bibelschule.
  title: { absolute: EINRICHTUNG.name },
};

export default function Startseite() {
  return (
    <main className="mx-auto flex min-h-[calc(100dvh-6px)] w-full max-w-md flex-col px-6 pb-11 pt-14 sm:justify-center sm:pb-20 sm:pt-10">
      <span
        aria-hidden="true"
        className="grid h-14 w-14 place-items-center rounded-[15px] bg-primary text-[17px] font-bold tracking-wide text-primary-foreground"
      >
        GBS
      </span>
      <p className="mt-6 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {EINRICHTUNG.traeger}
      </p>
      <h1 className="mt-1.5 hyphens-auto break-words text-[31px] font-bold leading-[1.12] tracking-[-0.03em] text-foreground sm:text-4xl">
        {EINRICHTUNG.name}
      </h1>
      <p className="mt-3.5 text-base leading-relaxed text-muted-foreground">
        Drei Jahre Bibelschule am Abend, getragen von sechs Gemeinden.
      </p>

      <div className="mt-auto grid gap-2.5 pt-12 sm:mt-10 sm:pt-0">
        <Link href="/anmeldung" className={knopf("primaer", "gross")}>
          Jetzt anmelden
        </Link>
        <Link href="/anmelden" className={knopf("sekundaer", "gross")}>
          Ins Portal
        </Link>
        <p className="mt-2 text-center text-[12.5px] leading-relaxed text-muted-foreground">
          Für den Jahrgang 2026 bis 2029 · Anmeldung dauert etwa zehn Minuten
        </p>
      </div>
    </main>
  );
}
