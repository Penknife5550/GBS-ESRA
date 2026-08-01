/**
 * GBS Campus — Linien-Icons (Inline-SVG)
 *
 * Bewusst als eigene Inline-SVG statt einer Icon-Bibliothek: lucide-react ist im
 * Projekt nicht installiert, und der Tech-Stack wird nicht im Vorbeigehen
 * erweitert. Alle Icons teilen denselben ruhigen CREDO-Strich (einfarbig
 * `currentColor`, dünn, runde Enden) — die Farbe steuert der Aufrufer über die
 * Textfarbe (z. B. `text-primary`). Rein dekorativ, deshalb `aria-hidden`.
 */

import type { ReactNode } from "react";

export type IconName =
  | "personen"
  | "teilnehmer"
  | "anmeldungen"
  | "noten"
  | "zeugnisse"
  | "semester"
  | "ueberleitung"
  | "faecher"
  | "stundenplan"
  | "honorar"
  | "formulare"
  | "einstellungen"
  | "betrieb"
  | "protokoll"
  | "meine-daten"
  | "aufgabe";

const PFADE: Record<IconName, ReactNode> = {
  personen: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M16 8.5a3 3 0 0 1 0 5" />
      <path d="M18.5 19c0-2.2-1-3.7-2.5-4.5" />
    </>
  ),
  teilnehmer: (
    <>
      <rect x="4" y="3.5" width="16" height="17" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  anmeldungen: (
    <>
      <path d="M4 4h11l5 5v11H4z" />
      <path d="M15 4v5h5" />
      <path d="M8 20v-4a3 3 0 0 1 6 0v4" />
    </>
  ),
  noten: <path d="M12 4l2.3 4.7 5.2.8-3.7 3.6.9 5.1L12 15.8 7.3 18.2l.9-5.1L4.5 9.1l5.2-.8z" />,
  zeugnisse: (
    <>
      <path d="M8 3h8l1 4H7z" />
      <rect x="6" y="7" width="12" height="13" rx="1.5" />
      <path d="M9 11h6M9 14h6M9 17h3" />
    </>
  ),
  semester: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
    </>
  ),
  ueberleitung: <path d="M3 12h6l2 5 4-11 2 6h4" />,
  faecher: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d="M3.5 9h17M9 9v11M3.5 14.5h17" />
    </>
  ),
  stundenplan: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  honorar: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5v9M9.5 10c0-1.2 1.1-2 2.5-2s2.5.7 2.5 1.8c0 2.4-5 1.2-5 3.6 0 1.1 1.1 1.9 2.5 1.9s2.5-.8 2.5-2" />
    </>
  ),
  formulare: (
    <>
      <rect x="4.5" y="3.5" width="15" height="17" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h4" />
    </>
  ),
  einstellungen: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.5v2.5M12 18v2.5M4.6 7.5l2.2 1.3M17.2 15.2l2.2 1.3M19.4 7.5l-2.2 1.3M6.8 15.2l-2.2 1.3" />
    </>
  ),
  betrieb: (
    <>
      <path d="M4 4h16v12H5.2L4 18z" />
      <path d="M8 9h8M8 12h5" />
    </>
  ),
  protokoll: (
    <>
      <path d="M12 3l7 3v5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z" />
      <path d="M9.5 12l1.8 1.8 3.5-3.6" />
    </>
  ),
  "meine-daten": (
    <>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
    </>
  ),
  aufgabe: (
    <>
      <rect x="6" y="4" width="12" height="16" rx="2" />
      <path d="M9 4h6v3H9z" />
      <path d="M9 12.5l2 2 4-4" />
    </>
  ),
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PFADE[name]}
    </svg>
  );
}
