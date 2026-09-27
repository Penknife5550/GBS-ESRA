/**
 * Stand einer Honorar-Abrechnung als Punkt mit Wort (Oberflächenplan 09/2026:
 * Farbe nur als Signal). Dieselbe Zuordnung wie der Badge in
 * `components/ui/badges.tsx`: offen gelb, freigegeben blau, ausgezahlt grün.
 *
 * Liegt hier, weil gemeinsame Bausteine in dieser Etappe nicht geändert werden;
 * gehört später als `AbrechnungStatusPunkt` neben `AbrechnungStatusBadge`.
 */

import type { ReactNode } from "react";
import type { HonorarAbrechnungStatus } from "@prisma/client";
import { abrechnungStatusText } from "@/lib/honorar";
import { StatusPunkt, type StatusTon } from "@/components/ui/status-punkt";

function tonFuer(status: HonorarAbrechnungStatus): StatusTon {
  switch (status) {
    case "OFFEN":
      return "gelb";
    case "FREIGEGEBEN":
      return "blau";
    case "AUSGEZAHLT":
      return "gruen";
  }
}

export function AbrechnungStatusPunkt({
  status,
  children,
}: {
  status: HonorarAbrechnungStatus;
  /** Eigener Text statt des Standardworts, z. B. mit Betrag. */
  children?: ReactNode;
}) {
  return <StatusPunkt ton={tonFuer(status)}>{children ?? abrechnungStatusText(status)}</StatusPunkt>;
}
