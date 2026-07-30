"use client";

import { useRouter } from "next/navigation";

/** Semesterauswahl der Notenseite — wechselt per Query-Parameter (wie der
 * Stundenplan). Ein Klick lädt die Seite für das gewählte Semester neu. */
export function SemesterWahl({
  semesters,
  gewaehltId,
}: {
  semesters: { id: string; bezeichnung: string }[];
  gewaehltId: string;
}) {
  const router = useRouter();
  return (
    <div>
      <label htmlFor="noten-semesterwahl" className="block text-sm font-medium">
        Semester
      </label>
      <select
        id="noten-semesterwahl"
        value={gewaehltId}
        onChange={(e) => router.push(`/verwaltung/noten?semester=${e.target.value}`)}
        className="mt-1.5 min-h-11 rounded-lg border border-input bg-background px-3 py-1.5 text-sm"
      >
        {semesters.map((s) => (
          <option key={s.id} value={s.id}>
            {s.bezeichnung}
          </option>
        ))}
      </select>
    </div>
  );
}
