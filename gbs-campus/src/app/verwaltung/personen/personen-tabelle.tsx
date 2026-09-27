/**
 * Die Personenliste (Oberflächenplan 09/2026): eine Zeile je Person mit
 * Initialen, Teilnahme, Wohnort, Anwesenheit als Status-Punkt und Status —
 * feine Linien, feste Zeilenhöhe, Farbe nur als Punkt. Die ganze Zeile führt in
 * die Akte.
 *
 * Bewusst eine Liste aus Links in einem Raster statt einer <table>: So ist die
 * ganze Zeile anklickbar, ohne verschachtelte oder unsichtbare Links, und am
 * Handy wird daraus eine zweizeilige Liste ohne seitliches Scrollen (die frühere
 * Tabelle schnitt dort die Spalte „Ort“ ab). Die Spaltenköpfe sind nur fürs
 * Auge; jede Zeile liest sich für Vorlesesoftware als Satz.
 */

import Link from "next/link";
import { initialen } from "@/lib/navigation";
import { personStatusTon, type AnwesenheitsTon } from "@/lib/heute";
import { Icon } from "@/components/icons";
import { LadeHinweis } from "@/components/ui/lade-hinweis";
import { StatusPunkt } from "@/components/ui/status-punkt";

export type PersonenZeile = {
  id: string;
  vorname: string;
  nachname: string;
  /** „Schüler“ / „Hörer“ oder leer. */
  teilnahme: string;
  ort: string | null;
  anwesenheit: { text: string; ton: AnwesenheitsTon } | null;
  status: { code: string; bezeichnung: string };
  /** Nur mit NOTEN_VERWALTEN und nur, wenn es Bewertungen gibt. */
  noten: { bestanden: number; gesamt: number } | null;
};

const SPALTEN = "md:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_1rem]";
const SPALTEN_MIT_NOTEN =
  "md:grid-cols-[minmax(0,2.2fr)_minmax(0,0.9fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,1.1fr)_1rem]";

export function PersonenTabelle({
  zeilen,
  mitNoten,
  beschriftung,
}: {
  zeilen: PersonenZeile[];
  /** Spalte „Noten (bestanden)“ — nur für die Schulleitung, und nur wenn es Noten gibt. */
  mitNoten: boolean;
  beschriftung: string;
}) {
  const spalten = mitNoten ? SPALTEN_MIT_NOTEN : SPALTEN;
  const kopf = "text-[11.5px] font-semibold uppercase tracking-[0.06em] text-dezent";

  return (
    <div>
      <div aria-hidden="true" className={`hidden gap-x-4 border-b border-linie pb-2 md:grid ${spalten}`}>
        <span className={`${kopf} pl-11`}>Name</span>
        <span className={kopf}>Teilnahme</span>
        <span className={kopf}>Wohnort</span>
        <span className={kopf}>Anwesenheit</span>
        {mitNoten && <span className={kopf}>Noten (bestanden)</span>}
        <span className={kopf}>Status</span>
        <span />
      </div>
      <ul aria-label={beschriftung} className="divide-y divide-linie border-b border-linie">
        {zeilen.map((z) => {
          const nebenbei = [z.teilnahme, z.ort, z.status.code === "AKTIV" ? null : z.status.bezeichnung].filter(Boolean).join(" · ");
          const ton = personStatusTon(z.status.code);
          return (
            <li key={z.id}>
              <Link
                href={`/verwaltung/personen/${z.id}`}
                className={`grid min-h-14 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 py-2 hover:bg-muted/60 focus-visible:bg-muted/60 md:min-h-[42px] md:gap-x-4 md:py-1 ${spalten}`}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-feld text-[11px] font-semibold text-muted-foreground"
                  >
                    {initialen(z.vorname, z.nachname)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {z.nachname}, {z.vorname}
                      <LadeHinweis className="ml-2" />
                    </span>
                    {nebenbei && <span className="block truncate text-[13px] text-muted-foreground md:hidden">{nebenbei}</span>}
                  </span>
                </span>
                <span className="hidden truncate text-sm text-foreground md:block">{z.teilnahme || "—"}</span>
                <span className="hidden truncate text-sm text-muted-foreground md:block">{z.ort || "—"}</span>
                <span className="min-w-0">
                  {z.anwesenheit ? (
                    <StatusPunkt ton={z.anwesenheit.ton}>
                      <span className="sr-only">Anwesenheit: </span>
                      {z.anwesenheit.text}
                    </StatusPunkt>
                  ) : (
                    <span className="hidden text-sm text-dezent md:inline">—</span>
                  )}
                </span>
                {mitNoten && (
                  <span className="hidden text-sm tabular-nums text-foreground md:block">
                    {z.noten ? (
                      <>
                        {z.noten.bestanden}/{z.noten.gesamt}
                        <span className="sr-only"> Noten bestanden</span>
                      </>
                    ) : (
                      <span className="text-dezent">—</span>
                    )}
                  </span>
                )}
                <span className="hidden min-w-0 md:block">
                  {ton === null ? (
                    <span className="text-[13px] text-muted-foreground">{z.status.bezeichnung}</span>
                  ) : (
                    <StatusPunkt ton={ton}>{z.status.bezeichnung}</StatusPunkt>
                  )}
                </span>
                <Icon name="weiter" className="h-4 w-4 shrink-0 text-dezent" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
