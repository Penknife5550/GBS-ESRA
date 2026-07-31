/**
 * Die eigenen Zeugnisse/Bescheinigungen des Schülers — rein lesend
 * (Recht PERSON_LESEN_EIGENE). Ausgestellt werden sie von der Schulleitung; hier
 * lädt der Schüler sein Exemplar als PDF herunter. Serverkomponente ohne Interaktion.
 */
export function MeineZeugnisseAbschnitt({
  zeugnisse,
}: {
  zeugnisse: { id: string; belegNr: string; titel: string; abschnitt: string; ausgestelltAm: string }[];
}) {
  return (
    <div>
      <p className="max-w-prose text-sm text-muted-foreground">
        Deine ausgestellten Zeugnisse und Bescheinigungen. Lade sie hier als PDF herunter.
      </p>

      <ul className="mt-4 space-y-2">
        {zeugnisse.map((z) => (
          <li
            key={z.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
          >
            <div className="min-w-0">
              <span className="text-sm font-medium">{z.titel}</span>
              <span className="ml-2 text-sm text-muted-foreground">· {z.abschnitt}</span>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Beleg-Nr. {z.belegNr} · {z.ausgestelltAm}
              </div>
            </div>
            <a
              href={`/api/zeugnisse/${z.id}/pdf`}
              aria-label={`${z.titel} (${z.abschnitt}) als PDF herunterladen`}
              className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Herunterladen
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
