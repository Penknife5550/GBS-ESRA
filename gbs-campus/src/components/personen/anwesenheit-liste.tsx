/**
 * GBS Campus — Anwesenheit eines Semesters in der Personenakte (nur Einsicht)
 *
 * Oben der Stand in einem Satz („Bisher alle 4 Einheiten besucht“), daneben das
 * Ziel der Quote („Ziel 16 von 20 · darf noch 4-mal fehlen“) und ein Balken mit
 * Marke bei der nötigen Zahl; darunter jede vergangene Einheit mit Datum, Fach,
 * Thema und Stand als Punkt (Oberflächenplan 09/2026). Die Zahlen kommen
 * unverändert aus der Quote-Logik (Modell A, `quoteAusVergangenen`) — dieselben
 * wie in der Schüler-Akte. Wird es knapp, steht der Klartext der
 * Verwaltungssicht darunter (`quoteHinweis(…, "verwaltung")`).
 *
 * Bewusst reine Einsicht: Erfasst wird an der Quelle beim Dozenten (/dozent),
 * „entschuldigt“ entscheidet die Schule an anderer Stelle. Server-Komponente.
 */

import { Balken, type AnzeigeTon } from "@/components/ui/anzeige";
import { Icon } from "@/components/icons";
import { Gruppe } from "@/components/ui/liste";
import { StatusPunkt } from "@/components/ui/status-punkt";
import { tagKurz, uhrzeit } from "@/lib/datum";
import { istQuoteDringend, quoteHinweis, type QuoteModellA } from "@/lib/stundenplan";
import { anwesenheitText, anwesenheitTon } from "./akte-anzeige";

/** Eine vergangene Unterrichtseinheit, wie die Akte sie zeigt. */
export type Einheit = {
  id: string;
  /** Beginn der Einheit; fehlt er, steht `ersatzText` („Di., 15.09.2026, 19:00“). */
  beginn: Date | null;
  ersatzText: string;
  /** „Bibelkunde · Genesis 1–11: Urgeschichte“ */
  titel: string;
  status: string | null;
  /** Den Eintrag hat der Teilnehmer selbst gesetzt. */
  selbst: boolean;
};

function einheitenWort(n: number): string {
  return n === 1 ? "Einheit" : "Einheiten";
}

/** Der Stand in einem Satz, gezählt über die vergangenen Einheiten. */
function standText(q: QuoteModellA, vergangen: number): string {
  if (vergangen > 1 && q.teilgenommen === vergangen) return `Bisher alle ${vergangen} Einheiten besucht`;
  return `${q.teilgenommen} von ${vergangen} ${einheitenWort(vergangen)} besucht`;
}

/**
 * Das Ziel der Quote über alle Einheiten des Semesters — dieselben Zahlen wie die
 * Quote-Ampel. Der Puffer steht dunkler da, sobald schon etwas fehlt.
 */
function Ziel({ q }: { q: QuoteModellA }) {
  const ziel = `Ziel ${q.benoetigt} von ${q.gesamt}`;
  if (q.zustand === "ERFUELLT") return <>{ziel} erreicht</>;
  if (q.zustand === "NICHT_ERREICHBAR") return <>{ziel} nicht mehr erreichbar</>;
  const puffer = q.darfNochFehlen <= 0 ? "darf nicht mehr fehlen" : `darf noch ${q.darfNochFehlen}-mal fehlen`;
  return (
    <>
      {ziel} · <span className={q.versaeumt > 0 ? "font-medium text-foreground" : undefined}>{puffer}</span>
    </>
  );
}

/** Grün, solange nichts fehlt oder das Ziel sicher ist; gelb bei Fehlzeiten; rot, wenn es dringend ist. */
function balkenTon(q: QuoteModellA): AnzeigeTon {
  if (q.zustand === "ERFUELLT") return "gruen";
  if (istQuoteDringend(q)) return "rot";
  return q.versaeumt > 0 ? "gelb" : "gruen";
}

function EinheitZeile({ einheit }: { einheit: Einheit }) {
  const wann = einheit.beginn ? `${tagKurz(einheit.beginn)} ${uhrzeit(einheit.beginn)}` : einheit.ersatzText;
  return (
    // Am Handy: Thema oben, darunter Datum und Stand; ab sm eine Zeile (Datum · Thema · Stand).
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-4 py-2.5 sm:min-h-12 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:gap-x-4">
      <span className="col-span-2 text-sm font-medium text-foreground sm:order-2 sm:col-span-1 sm:truncate">
        {einheit.titel}
      </span>
      <span className="text-[13px] tabular-nums text-muted-foreground sm:order-1 sm:text-sm">{wann}</span>
      <StatusPunkt ton={anwesenheitTon(einheit.status)} className="justify-self-end sm:order-3">
        {anwesenheitText(einheit.status, einheit.selbst)}
      </StatusPunkt>
    </li>
  );
}

export function AnwesenheitListe({
  quote,
  einheiten,
  eingeklappt = false,
}: {
  quote: QuoteModellA;
  einheiten: Einheit[];
  /** Frühere Semester: die Einheiten erst auf Klick zeigen. */
  eingeklappt?: boolean;
}) {
  const dringend = istQuoteDringend(quote);
  const liste = (
    <ul className="divide-y divide-linie">
      {einheiten.map((einheit) => (
        <EinheitZeile key={einheit.id} einheit={einheit} />
      ))}
    </ul>
  );

  return (
    <Gruppe>
      <div className="px-4 pb-3.5 pt-4 sm:px-[18px]">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
          <p className="text-[17px] font-semibold tracking-tight text-foreground">{standText(quote, einheiten.length)}</p>
          <p className="text-[13px] text-muted-foreground sm:ml-auto sm:text-right">
            <Ziel q={quote} />
          </p>
        </div>
        <Balken
          wert={quote.teilgenommen}
          max={quote.gesamt}
          marke={quote.benoetigt}
          ton={balkenTon(quote)}
          label={`Anwesenheit: ${quote.teilgenommen} von ${quote.gesamt} Einheiten besucht, nötig sind ${quote.benoetigt}`}
          className="mt-3"
        />
        {dringend && <p className="mt-3 text-[13px] font-medium text-foreground">{quoteHinweis(quote, "verwaltung")}</p>}
      </div>
      {eingeklappt ? (
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 px-4 text-[13px] font-medium text-primary hover:bg-muted/60 [&::-webkit-details-marker]:hidden">
            <Icon name="aufklappen" className="h-4 w-4 transition-transform group-open:rotate-180" />
            <span className="group-open:hidden">
              {einheiten.length} {einheitenWort(einheiten.length)} anzeigen
            </span>
            <span className="hidden group-open:inline">Einheiten ausblenden</span>
          </summary>
          <div className="border-t border-linie">{liste}</div>
        </details>
      ) : (
        liste
      )}
    </Gruppe>
  );
}
