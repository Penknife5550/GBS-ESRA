/**
 * Semesterauswahl der Notenseite — ein schlichtes GET-Formular (wie die
 * Personenliste): Die Auswahl steht im Query-Parameter, gewechselt wird erst mit
 * „Anzeigen“, nicht schon beim Durchblättern der Liste (WCAG 3.2.2). Als echter
 * Seitenwechsel fragt der Browser vorher nach, solange die Notenmatrix
 * ungespeicherte Änderungen hat (`beforeunload` in `NotenMatrix`).
 */
export function SemesterWahl({
  semesters,
  gewaehltId,
}: {
  semesters: { id: string; bezeichnung: string }[];
  gewaehltId: string;
}) {
  return (
    <form method="get" action="/verwaltung/noten" className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor="noten-semesterwahl" className="block text-sm font-medium">
          Semester
        </label>
        <select
          id="noten-semesterwahl"
          name="semester"
          defaultValue={gewaehltId}
          className="mt-1.5 min-h-11 rounded-lg border border-input bg-background px-3 py-1.5 text-sm"
        >
          {semesters.map((s) => (
            <option key={s.id} value={s.id}>
              {s.bezeichnung}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        Anzeigen
      </button>
    </form>
  );
}
