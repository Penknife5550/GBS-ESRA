import type { ZeitleistenPunkt } from "@/lib/semesterplan";

const PUNKT: Record<ZeitleistenPunkt["stand"], string> = {
  erledigt: "bg-primary",
  naechster: "bg-primary ring-4 ring-primary/15",
  spaeter: "border-2 border-input bg-background",
  entfaellt: "border-2 border-dashed border-input bg-background",
};

const VORLESEN: Record<ZeitleistenPunkt["stand"], string> = {
  erledigt: " (erledigt)",
  naechster: " (als Nächstes)",
  spaeter: "",
  entfaellt: "",
};

/**
 * Die Einladung ins nächste Semester als Zeitleiste (Oberflächenplan 09/2026):
 * Einladung, drei Erinnerungen, Beginn — mit den echten Daten aus
 * `einladungsZeitleiste`. Am Rechner waagerecht, am Handy senkrecht. Der
 * Zustand steht für Vorlesesoftware auch als Wort da, nicht nur als Punkt.
 */
export function Zeitleiste({ punkte }: { punkte: ZeitleistenPunkt[] }) {
  return (
    <ol className="grid gap-3 sm:grid-cols-5 sm:gap-0">
      {punkte.map((p, i) => (
        <li
          key={p.was}
          className={`relative flex items-start gap-3 sm:flex-col sm:items-center sm:gap-2 sm:text-center ${
            i < punkte.length - 1
              ? "after:absolute after:bottom-[-14px] after:left-[6px] after:top-[18px] after:w-0.5 after:bg-linie sm:after:bottom-auto sm:after:left-[calc(50%+11px)] sm:after:right-[calc(-50%+11px)] sm:after:top-[6px] sm:after:h-0.5 sm:after:w-auto"
              : ""
          }`}
        >
          <span aria-hidden="true" className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full sm:mt-0 ${PUNKT[p.stand]}`} />
          <span className="min-w-0 text-[13px] leading-snug">
            <span className={`block font-semibold ${p.stand === "entfaellt" ? "text-muted-foreground" : "text-foreground"}`}>
              {p.wann}
            </span>
            <span className="block text-muted-foreground">
              {p.stand === "entfaellt" ? `${p.was} · entfällt` : p.was}
              {VORLESEN[p.stand] && <span className="sr-only">{VORLESEN[p.stand]}</span>}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
