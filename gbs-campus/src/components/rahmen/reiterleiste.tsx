"use client";

/**
 * GBS Campus — Leiste unten am Handy (Dozenten und Teilnehmer)
 *
 * Drei Punkte, erreichbar mit dem Daumen, wie bei iPhone-Apps. Am Rechner
 * übernimmt die Leiste links (`lg:hidden`). Berücksichtigt den unteren Rand
 * des iPhones (`safe-area-inset-bottom`).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons";
import { aktiverPunkt, type NavPunkt } from "@/lib/navigation";

export function Reiterleiste({ punkte }: { punkte: readonly NavPunkt[] }) {
  const pfadname = usePathname() ?? "";
  const aktiv = aktiverPunkt(punkte, pfadname);

  return (
    <nav
      aria-label="Hauptnavigation"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-linie bg-leiste/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-flow-col auto-cols-fr">
        {punkte.map((punkt) => {
          const istAktiv = punkt.schluessel === aktiv;
          return (
            <li key={punkt.schluessel}>
              <Link
                href={punkt.pfad}
                aria-current={istAktiv ? "page" : undefined}
                className={`flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium ${
                  istAktiv ? "text-primary" : "text-dezent"
                }`}
              >
                <Icon name={punkt.icon} className={`h-6 w-6 ${istAktiv ? "stroke-[2.1]" : ""}`} />
                {punkt.titel}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
