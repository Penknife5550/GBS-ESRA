/**
 * GBS Campus — Segment (Umschalter)
 *
 * Ersetzt Auswahlliste plus „Anzeigen“: Jeder Eintrag ist ein Link, der Filter
 * wirkt also sofort, lässt sich als Lesezeichen merken und funktioniert ohne
 * JavaScript. Der aktive Eintrag trägt `aria-current`, damit Vorlesesoftware
 * ihn ansagt. Am Handy scrollt eine lange Reihe seitlich, statt umzubrechen.
 */

import Link from "next/link";

export type SegmentEintrag = {
  text: string;
  href: string;
  aktiv: boolean;
  /** Kleine Zahl hinter dem Text, z. B. die Anzahl der Personen. */
  zahl?: number;
};

export function Segment({ eintraege, label }: { eintraege: SegmentEintrag[]; label: string }) {
  return (
    <nav aria-label={label} className="max-w-full overflow-x-auto">
      <ul className="inline-flex gap-0.5 rounded-[10px] bg-feld p-0.5">
        {eintraege.map((eintrag) => (
          <li key={eintrag.href}>
            <Link
              href={eintrag.href}
              aria-current={eintrag.aktiv ? "page" : undefined}
              className={`inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13px] font-medium lg:h-7 ${
                eintrag.aktiv
                  ? "bg-background text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.08)]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {eintrag.text}
              {eintrag.zahl !== undefined && <span className="tabular-nums text-dezent">{eintrag.zahl}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
