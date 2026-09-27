/**
 * Die Liste links im Postfach der Anmeldungen (Oberflächenplan 09/2026) — auf
 * /verwaltung/anmeldungen und neben der gewählten Anmeldung
 * (/verwaltung/anmeldungen/[id]). Je Zeile Name, Eingang, Teilnahme und Wohnort.
 *
 * Bewusst ohne Antworten: Die Liste lädt die Spalte `antworten` gar nicht
 * (Art. 9, und jede Anmeldung hat davon mehrere Kilobyte). Gelesen wird in der
 * Einzelansicht — dort mit Art.-9-Schutz und protokolliert. Deshalb steht hier
 * auch keine erste Zeile der Motivation: Sie ist eine Art.-9-Angabe, und ein
 * Blick in die Liste wäre ein Abruf, der nirgends protokolliert ist.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { STATUS } from "@/lib/constants";
import { eingangKurz, tagMonat } from "@/lib/heute";
import { teilnahmeformName } from "@/lib/semester";
import { LeererZustand } from "@/components/ui/hinweis";
import { Segment } from "@/components/ui/segment";

export type AnmeldungsAnsicht = "offen" | "entschieden";

/** Liest `?ansicht=` — ohne Angabe die offenen. */
export function anmeldungsAnsicht(wert: string | undefined): AnmeldungsAnsicht {
  return wert === "entschieden" ? "entschieden" : "offen";
}

/**
 * Entwürfe sind unfertige Eingaben fremder Menschen, und Anmeldungen
 * anonymisierter Personen sind geschlossen (Code-Review 4, M7) — beide gehören
 * nicht in die Arbeitsliste.
 */
const SICHTBAR: Prisma.AnmeldungWhereInput = {
  OR: [{ personId: null }, { person: { statusCode: { not: STATUS.ANONYMISIERT } } }],
};

export async function ladeAnmeldungsListe(ansicht: AnmeldungsAnsicht) {
  const [anzahlOffen, anmeldungen] = await Promise.all([
    prisma.anmeldung.count({ where: { status: "EINGEREICHT", ...SICHTBAR } }),
    prisma.anmeldung.findMany({
      where: { ...SICHTBAR, status: ansicht === "offen" ? "EINGEREICHT" : { in: ["ANGENOMMEN", "ABGELEHNT"] } },
      select: {
        id: true,
        status: true,
        eingereichtAm: true,
        entschiedenAm: true,
        teilnahmeform: true,
        person: { select: { vorname: true, nachname: true, ort: true, teilnahmeform: true } },
      },
      orderBy: ansicht === "offen" ? [{ eingereichtAm: "desc" }] : [{ entschiedenAm: "desc" }, { eingereichtAm: "desc" }],
      take: 200,
    }),
  ]);
  return { anzahlOffen, anmeldungen };
}

export type ListenAnmeldung = Awaited<ReturnType<typeof ladeAnmeldungsListe>>["anmeldungen"][number];

export type ListenZeile = {
  id: string;
  href: string;
  name: string;
  zeit: string;
  unterzeile: string;
  /** Nur bei entschiedenen: der Stand (Badge) und wann. */
  stand: ReactNode | null;
  entschieden: string | null;
};

/** Eine Zeile der Liste; `stand` ist der Badge der Seite (nur für entschiedene gezeigt). */
export function alsListenZeile(anmeldung: ListenAnmeldung, ansicht: AnmeldungsAnsicht, jetzt: Date, stand: ReactNode): ListenZeile {
  const offen = anmeldung.status === "EINGEREICHT";
  return {
    id: anmeldung.id,
    href: `/verwaltung/anmeldungen/${anmeldung.id}${ansicht === "entschieden" ? "?ansicht=entschieden" : ""}`,
    name: anmeldung.person ? `${anmeldung.person.vorname} ${anmeldung.person.nachname}` : "Ohne Akte",
    zeit: anmeldung.eingereichtAm ? eingangKurz(anmeldung.eingereichtAm, jetzt) : "",
    unterzeile: [teilnahmeformName(anmeldung.teilnahmeform ?? anmeldung.person?.teilnahmeform), anmeldung.person?.ort]
      .filter(Boolean)
      .join(" · "),
    stand: offen ? null : stand,
    entschieden: !offen && anmeldung.entschiedenAm ? `am ${tagMonat(anmeldung.entschiedenAm)}` : null,
  };
}

export function AnmeldungsListe({
  ansicht,
  anzahlOffen,
  zeilen,
  gewaehlt,
  ueberschrift,
  className = "",
}: {
  ansicht: AnmeldungsAnsicht;
  anzahlOffen: number;
  zeilen: ListenZeile[];
  gewaehlt?: string;
  /** Auf der Listenseite ist „Anmeldungen“ die Hauptüberschrift, neben einer Anmeldung deren Name. */
  ueberschrift: "h1" | "h2";
  className?: string;
}) {
  const Ueberschrift = ueberschrift;
  return (
    <section aria-labelledby="anmeldungen-liste" className={`flex min-h-0 flex-col lg:border-r lg:border-linie ${className}`}>
      <div className="flex flex-col gap-3 border-b border-linie px-4 pb-3 pt-4 sm:px-6 lg:min-h-14 lg:flex-row lg:items-center lg:gap-2 lg:px-4 lg:py-2.5">
        <Ueberschrift
          id="anmeldungen-liste"
          className="text-[28px] font-bold leading-tight tracking-tight text-foreground lg:text-base lg:font-semibold"
        >
          Anmeldungen
        </Ueberschrift>
        <div className="lg:ml-auto">
          <Segment
            label="Anmeldungen filtern"
            eintraege={[
              { text: "Offen", href: "/verwaltung/anmeldungen", aktiv: ansicht === "offen", zahl: anzahlOffen },
              { text: "Entschieden", href: "/verwaltung/anmeldungen?ansicht=entschieden", aktiv: ansicht === "entschieden" },
            ]}
          />
        </div>
      </div>

      {zeilen.length === 0 ? (
        <div className="p-4">
          <LeererZustand icon={ansicht === "offen" ? "bestaetigt" : "eingang"} titel={ansicht === "offen" ? "Keine offenen Anmeldungen" : "Noch nichts entschieden"}>
            {ansicht === "offen" ? "Neue Anmeldungen erscheinen hier." : null}
          </LeererZustand>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-linie overflow-y-auto border-b border-linie lg:border-b-0">
          {zeilen.map((zeile) => {
            const aktiv = zeile.id === gewaehlt;
            return (
              <li key={zeile.id}>
                {/* prefetch aus: Die Einzelansicht protokolliert jeden Abruf — ein
                    Vorladen beim Blättern wäre ein Abruf, den niemand gemacht hat. */}
                <Link
                  href={zeile.href}
                  prefetch={false}
                  aria-current={aktiv ? "page" : undefined}
                  className={`relative block px-4 py-3 sm:px-6 lg:px-4 ${
                    aktiv ? "bg-feld before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary" : "hover:bg-muted/60"
                  }`}
                >
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{zeile.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-dezent">{zeile.zeit}</span>
                  </span>
                  {zeile.unterzeile && <span className="block truncate text-[13px] text-foreground">{zeile.unterzeile}</span>}
                  {zeile.stand && (
                    <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      {zeile.stand}
                      {zeile.entschieden}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
