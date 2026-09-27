/**
 * GBS Campus — Knopfklassen
 *
 * Eine Regel aus dem Oberflächenplan (09/2026): **ein** dunkler Knopf je Seite
 * für die Hauptaktion, alles andere hell oder als Textknopf. Am Handy sind
 * Knöpfe 44 px hoch (Tippfläche nach WCAG 2.5.5), am Rechner 36 px. Als
 * Klassenfunktion statt Komponente, damit `<button>`, `<Link>` und `<a>`
 * gleich aussehen, ohne dass jede Form eine eigene Hülle braucht.
 */

export type KnopfArt = "primaer" | "sekundaer" | "leise" | "gefahr";
export type KnopfGroesse = "klein" | "normal" | "gross";

const BASIS =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-colors " +
  "disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:pointer-events-none aria-disabled:opacity-60";

const ARTEN: Record<KnopfArt, string> = {
  primaer: "rounded-lg bg-primary text-primary-foreground hover:bg-primary/90",
  sekundaer: "rounded-lg border border-input bg-background text-foreground hover:bg-muted",
  leise: "rounded-lg text-primary hover:bg-muted",
  gefahr: "rounded-lg border border-credo-rot/40 bg-background text-credo-rot hover:bg-credo-rot/5",
};

const GROESSEN: Record<KnopfGroesse, string> = {
  klein: "h-9 px-3 text-[13px] lg:h-8",
  normal: "h-11 px-4 text-sm lg:h-9 lg:px-3.5",
  gross: "h-12 w-full rounded-xl px-5 text-[15px] font-semibold",
};

/** Klassen für einen Knopf: `knopf("primaer")`, `knopf("leise", "klein")` … */
export function knopf(art: KnopfArt = "sekundaer", groesse: KnopfGroesse = "normal"): string {
  return `${BASIS} ${ARTEN[art]} ${GROESSEN[groesse]}`;
}
