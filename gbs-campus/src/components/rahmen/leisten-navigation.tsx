"use client";

/**
 * GBS Campus — Navigation in der Leiste (links am Rechner, im Menü am Handy)
 *
 * Markiert den Bereich, in dem man gerade ist (längster passender Pfad, siehe
 * `aktiverPunkt`), mit `aria-current="page"`. Zahlen erscheinen nur, wo etwas
 * wartet (offene Anmeldungen) — als dunkler Punkt mit Zahl, für Vorlesesoftware
 * mit „offen“ ausgeschrieben.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons";
import { aktiverPunkt, type NavPunkt } from "@/lib/navigation";

export type LeistenPunkt = NavPunkt & { zahl?: number };
export type LeistenGruppe = { titel?: string; punkte: LeistenPunkt[] };

export function LeistenNavigation({
  gruppen,
  onNavigieren,
}: {
  gruppen: LeistenGruppe[];
  /** Am Handy schließt ein Klick das Menü. */
  onNavigieren?: () => void;
}) {
  const pfadname = usePathname() ?? "";
  const aktiv = aktiverPunkt(
    gruppen.flatMap((g) => g.punkte),
    pfadname,
  );

  return (
    <nav aria-label="Hauptnavigation" className="flex flex-col">
      {gruppen.map((gruppe, index) => (
        <div key={gruppe.titel ?? `gruppe-${index}`}>
          {gruppe.titel && (
            <div className="px-2.5 pb-1.5 pt-5 text-[11px] font-semibold uppercase tracking-[0.06em] text-dezent">
              {gruppe.titel}
            </div>
          )}
          <ul className="flex flex-col gap-0.5">
            {gruppe.punkte.map((punkt) => {
              const istAktiv = punkt.schluessel === aktiv;
              return (
                <li key={punkt.schluessel}>
                  <Link
                    href={punkt.pfad}
                    aria-current={istAktiv ? "page" : undefined}
                    onClick={onNavigieren}
                    className={`flex h-11 items-center gap-2.5 rounded-lg px-2.5 text-[14px] font-medium text-foreground lg:h-8 lg:text-[13.5px] ${
                      istAktiv
                        ? "bg-background shadow-[0_1px_2px_rgb(0_0_0/0.06),0_0_0_1px_rgb(0_0_0/0.035)]"
                        : "hover:bg-feld/70"
                    }`}
                  >
                    <Icon
                      name={punkt.icon}
                      className={`h-[18px] w-[18px] shrink-0 lg:h-[17px] lg:w-[17px] ${istAktiv ? "text-foreground" : "text-muted-foreground"}`}
                    />
                    <span className="truncate">{punkt.titel}</span>
                    {punkt.zahl ? (
                      <span className="ml-auto grid h-[18px] min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-semibold tabular-nums text-primary-foreground">
                        {punkt.zahl}
                        <span className="sr-only"> offen</span>
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
