/**
 * GBS Campus — Suchfeld in der Leiste
 *
 * Findet Personen von jeder Seite aus: ein schlichtes GET-Formular auf die
 * Personenliste, über alle Personen (`ansicht=alle`), damit auch Interessenten
 * und Ehemalige gefunden werden. Funktioniert ohne JavaScript.
 */

import { Icon } from "@/components/icons";

export function Suchfeld({ id = "leisten-suche" }: { id?: string }) {
  return (
    <form action="/verwaltung/personen" method="get" role="search" className="relative">
      <input type="hidden" name="ansicht" value="alle" />
      <label htmlFor={id} className="sr-only">
        Personen suchen
      </label>
      <Icon name="suche" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-dezent" />
      <input
        id={id}
        name="suche"
        type="search"
        placeholder="Suchen"
        autoComplete="off"
        className="h-10 w-full rounded-lg bg-feld pl-8 pr-2.5 text-sm text-foreground placeholder:text-dezent focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 lg:h-8 lg:text-[13px]"
      />
    </form>
  );
}
