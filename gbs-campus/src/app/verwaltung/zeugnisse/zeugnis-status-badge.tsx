import { Badge } from "@/components/ui/badges";
import { zeugnisStatusName } from "@/lib/zeugnis";

/**
 * Stand eines Zeugnisses als Badge (gültig / ersetzt / storniert) — auf der
 * Zeugnisseite und in der Detailakte. Die Aussage trägt das Wort, nicht allein
 * die Farbe (WCAG 1.4.1). Rein darstellend, kein "use client": Server- und
 * Client-Komponenten setzen sie ein.
 */
const TON: Record<string, string> = {
  GUELTIG: "bg-credo-gruen/15 text-foreground",
  ERSETZT: "bg-muted text-muted-foreground",
  STORNIERT: "bg-credo-rot/12 text-foreground",
};

export function ZeugnisStatusBadge({ status }: { status: string }) {
  return <Badge ton={TON[status]}>{zeugnisStatusName(status)}</Badge>;
}
