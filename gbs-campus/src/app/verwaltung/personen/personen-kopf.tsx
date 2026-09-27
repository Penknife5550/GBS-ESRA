/**
 * Kopf der Personenliste (Oberflächenplan 09/2026) — für /verwaltung/personen
 * und die frühere Seite „Aktive dieses Semester“ (/verwaltung/teilnehmer), die
 * jetzt die Ansicht „Dieses Semester“ ist: Titel, Umschalter mit Zahlen, Suche
 * (wirkt beim Absenden, ohne „Anzeigen“), rechts Excel und „Person“.
 *
 * Die Zahl „Dieses Semester“ ist dieselbe Menge wie die Liste und die
 * Excel-Datei (aktive Personen, für das Semester nicht abgemeldet).
 */

import { prisma } from "@/lib/db";
import { STATUS } from "@/lib/constants";
import { PERSON_ZAEHLT_AKTIV, TEILNAHME_ZAEHLT } from "@/lib/teilnahme-filter";
import { Icon } from "@/components/icons";
import { knopf } from "@/components/ui/knopf";
import { Segment } from "@/components/ui/segment";
import { Seitenkopf } from "@/components/ui/seitenkopf";
import { PersonAnlegen } from "./person-anlegen";

export type PersonenAnsicht = "semester" | "interessenten" | "alle";

/** Liest `?ansicht=` — ohne Angabe (und bei Unbekanntem) ist es „Dieses Semester“. */
export function personenAnsicht(wert: string | undefined): PersonenAnsicht {
  return wert === "interessenten" || wert === "alle" ? wert : "semester";
}

export async function PersonenKopf({
  ansicht,
  suche,
  semesterId,
  excelHref,
  darfAnlegen,
}: {
  ansicht: PersonenAnsicht;
  suche: string;
  /** Das laufende Semester — Grundlage der Zahl „Dieses Semester“. */
  semesterId: string | null;
  /** Export der Teilnehmerliste; nur in „Dieses Semester“ und mit PERSON_EXPORTIEREN. */
  excelHref: string | null;
  /** „Person“ anlegen (BENUTZER_VERWALTEN). */
  darfAnlegen: boolean;
}) {
  const [imSemester, interessenten, alle] = await Promise.all([
    semesterId
      ? prisma.teilnahme.count({ where: { semesterId, ...TEILNAHME_ZAEHLT, person: PERSON_ZAEHLT_AKTIV } })
      : Promise.resolve(0),
    prisma.person.count({ where: { statusCode: STATUS.INTERESSENT } }),
    prisma.person.count(),
  ]);

  return (
    <Seitenkopf
      titel="Personen"
      aktionen={
        <>
          <form action="/verwaltung/personen" method="get" role="search" className="relative w-full lg:w-56">
            {ansicht !== "semester" && <input type="hidden" name="ansicht" value={ansicht} />}
            <label htmlFor="personen-suche" className="sr-only">
              Nach Name oder E-Mail-Adresse suchen
            </label>
            <Icon name="suche" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-dezent" />
            <input
              id="personen-suche"
              name="suche"
              type="search"
              defaultValue={suche}
              placeholder="Name oder E-Mail"
              autoComplete="off"
              className="h-11 w-full rounded-lg bg-feld pl-8 pr-3 text-sm text-foreground placeholder:text-dezent focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 lg:h-9"
            />
          </form>
          {excelHref && (
            <a href={excelHref} className={knopf("sekundaer")} title="Teilnehmerliste als Excel-Datei herunterladen">
              <Icon name="herunterladen" className="h-4 w-4" />
              Excel
            </a>
          )}
          {darfAnlegen && <PersonAnlegen />}
        </>
      }
    >
      <Segment
        label="Personen filtern"
        eintraege={[
          { text: "Dieses Semester", href: "/verwaltung/personen", aktiv: ansicht === "semester", zahl: imSemester },
          { text: "Interessenten", href: "/verwaltung/personen?ansicht=interessenten", aktiv: ansicht === "interessenten", zahl: interessenten },
          { text: "Alle", href: "/verwaltung/personen?ansicht=alle", aktiv: ansicht === "alle", zahl: alle },
        ]}
      />
    </Seitenkopf>
  );
}
