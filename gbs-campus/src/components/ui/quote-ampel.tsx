/**
 * GBS Campus — Anwesenheits-Quote als Ampel
 *
 * Die eine Darstellung der 80-%-Quote (Modell A), geteilt von der Schüler-Akte
 * (/meine-daten) und der Personen-Detailakte (/verwaltung/personen/[id]). Der
 * Klartext + die „dringend"-Logik liegen DB-frei in `@/lib/stundenplan` (dort auch
 * per `pruefe`-Skript gegengeprüft); hier bleibt nur die Darstellung.
 *
 * Tints aus der CREDO-Linie, Text durchgehend `text-foreground` (Kontrast auf den
 * blassen Tints). Aussage NIE allein über Farbe (WCAG 1.4.1): jede kompakte Form
 * trägt zusätzlich ein Zeichen + ein (ggf. nur für Screenreader sichtbares) Wort.
 */

import {
  quoteHinweis,
  istQuoteDringend,
  type QuoteModellA,
  type QuoteSicht,
  type QuoteZustand,
} from "@/lib/stundenplan";

export const QUOTE_STIL: Record<QuoteZustand, { label: string; zeichen: string; badge: string; balken: string }> = {
  ERFUELLT: { label: "Erfüllt", zeichen: "✓", badge: "bg-credo-gruen/15 text-foreground", balken: "bg-credo-gruen" },
  OFFEN: { label: "Noch offen", zeichen: "•", badge: "bg-credo-gelb/25 text-foreground", balken: "bg-credo-gelb" },
  NICHT_ERREICHBAR: { label: "Nicht mehr erreichbar", zeichen: "✕", badge: "bg-credo-rot/15 text-foreground", balken: "bg-credo-rot" },
};

/**
 * Die volle Quote-Box mit Balken und Klartext. `sicht` wählt den Klartext: Der
 * Schüler liest „Bitte wenden Sie sich an die Schulleitung.", die Detailakte nicht.
 */
export function QuoteAmpel({ quote, sicht }: { quote: QuoteModellA; sicht: QuoteSicht }) {
  const stil = QUOTE_STIL[quote.zustand] ?? QUOTE_STIL.OFFEN;
  const dringend = istQuoteDringend(quote);
  const breite = Math.min(100, Math.max(0, quote.prozent));
  return (
    <div className="rounded-lg border border-border bg-muted px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">
          Teilgenommen: {quote.teilgenommen} von {quote.gesamt} Abenden
        </span>
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${stil.badge}`}>
          {stil.label}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-border" aria-hidden="true">
        <div className={`h-full ${stil.balken}`} style={{ width: `${breite}%` }} />
      </div>
      <p className={`mt-1.5 text-xs ${dringend ? "font-medium text-foreground" : "text-muted-foreground"}`}>
        Nötig sind {quote.benoetigt} von {quote.gesamt} Abenden ({quote.schwelleProzent}&nbsp;%). {quoteHinweis(quote, sicht)}
      </p>
    </div>
  );
}

/**
 * Kompakter Kopf-Fakt: Zeichen + „X/Y" mit Tint. Das Zeichen (✓/•/✕) und das
 * sr-only-Wort tragen die Aussage auch ohne Farbe. Geteilt von Detailakte-Kopf,
 * Schüler-Akte-Kopf und Personenliste (drei Zustände inkl. rot).
 */
export function QuoteChip({ quote }: { quote: QuoteModellA }) {
  const stil = QUOTE_STIL[quote.zustand] ?? QUOTE_STIL.OFFEN;
  return (
    <span
      title={stil.label}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${stil.badge}`}
    >
      <span aria-hidden="true">{stil.zeichen}</span>
      {quote.teilgenommen}/{quote.gesamt}
      <span className="sr-only"> — {stil.label}</span>
    </span>
  );
}
