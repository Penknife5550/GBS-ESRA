/**
 * GBS Campus — Status-Punkt
 *
 * Farbe als Signal, nicht als Dekoration (Oberflächenplan 09/2026): ein kleiner
 * Punkt in einer CREDO-Farbe vor einem Wort. Die Aussage trägt immer das Wort
 * (WCAG 1.4.1), der Text bleibt dunkel. Ersetzt in Listen die farbigen Pillen;
 * `badges.tsx` bleibt für Stellen, an denen ein Etikett wirklich hilft.
 */

import type { ReactNode } from "react";

export type StatusTon = "gruen" | "gelb" | "rot" | "blau" | "grau";

const PUNKT: Record<StatusTon, string> = {
  gruen: "bg-credo-gruen",
  gelb: "bg-credo-gelb",
  rot: "bg-credo-rot",
  blau: "bg-credo-blau",
  grau: "bg-dezent",
};

export function StatusPunkt({
  ton = "grau",
  children,
  className = "",
}: {
  ton?: StatusTon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap text-[13px] text-foreground ${className}`}>
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${PUNKT[ton]}`} />
      {children}
    </span>
  );
}
