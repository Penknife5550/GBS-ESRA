import { Icon } from "@/components/icons";
import { Abschnitt, Gruppe, Symbol } from "@/components/ui/liste";

/**
 * Die eigenen Zeugnisse/Bescheinigungen — rein lesend (Recht
 * PERSON_LESEN_EIGENE). Ausgestellt werden sie von der Schulleitung; hier lädt
 * die Person ihr Exemplar als PDF herunter — die ganze Zeile ist der Link.
 * Nur gültige (`ladeEigeneZeugnisse`): Ersetzte und stornierte sind für die
 * Person nicht mehr abrufbar (PDF-Route 410). Serverkomponente ohne Interaktion.
 */
export function MeineZeugnisseAbschnitt({
  zeugnisse,
}: {
  zeugnisse: { id: string; belegNr: string; titel: string; abschnitt: string; ausgestelltAm: string }[];
}) {
  return (
    <section>
      <Abschnitt titel="Meine Zeugnisse" />
      <Gruppe>
        {zeugnisse.map((z) => (
          // Ein schlichter Link (kein next/link): Die Route liefert ein PDF.
          <a
            key={z.id}
            href={`/api/zeugnisse/${z.id}/pdf`}
            className="flex min-h-12 items-center gap-3 px-4 py-2.5 hover:bg-muted/60 focus-visible:bg-muted/60"
          >
            <Symbol icon="zeugnis" />
            <span className="min-w-0 flex-1">
              <span className="sr-only">Als PDF herunterladen: </span>
              <span className="block truncate text-sm font-semibold text-foreground">{z.titel}</span>
              <span className="block text-[13px] text-muted-foreground">
                {`${z.abschnitt} · Beleg-Nr. ${z.belegNr} · ${z.ausgestelltAm}`}
              </span>
            </span>
            <Icon name="herunterladen" className="h-5 w-5 shrink-0 text-muted-foreground" />
          </a>
        ))}
      </Gruppe>
    </section>
  );
}
