/**
 * GBS Campus — Benutzer- und Rollenverwaltung: DB-freie Kernlogik
 *
 * Wer die Rollen einer Person ändert, setzt eine gewünschte Menge; hier wird
 * DB-frei entschieden, was das gegenüber dem Ist-Zustand bedeutet und ob die
 * Menge überhaupt zulässig ist. Ohne Datenbank, damit
 * `scripts/pruefe-benutzerverwaltung.ts` es ohne laufenden Postgres gegenprüfen
 * kann. Die eine Regel, die nicht DB-frei entscheidbar ist — „es muss immer
 * mindestens ein Administrator bleiben" —, prüft die Route (sie braucht die Zahl
 * der übrigen Administratoren).
 */

/**
 * Diese Rolle darf nicht versehentlich verschwinden: Ohne Administrator kommt
 * niemand mehr an Konten und Rollen. Der Wert spiegelt `ROLLE.ADMIN` aus
 * `constants.ts` — bewusst hier eigenständig, damit dieses Modul DB- und
 * importfrei bleibt.
 */
export const ADMIN_ROLLE = "ADMIN";

export type RollenDiff = { hinzu: string[]; weg: string[] };

/**
 * Was muss angelegt bzw. entfernt werden, um von `vorhanden` auf `gewuenscht`
 * zu kommen? Unveränderte Rollen bleiben unangetastet (so wird ihr `erteiltAm`
 * nicht bei jedem Speichern zurückgesetzt). Doppelte Einträge sind egal — es
 * wird über Mengen gerechnet.
 */
export function rollenDiff(gewuenscht: string[], vorhanden: string[]): RollenDiff {
  const gew = new Set(gewuenscht);
  const vor = new Set(vorhanden);
  return {
    hinzu: [...gew].filter((r) => !vor.has(r)),
    weg: [...vor].filter((r) => !gew.has(r)),
  };
}

/** Sind alle gewünschten Codes bekannte Rollen? Verhindert das Anlegen einer
 * Zuordnung auf eine Rolle, die es gar nicht gibt (Fremdschlüssel-500). */
export function sindRollenBekannt(gewuenscht: string[], bekannt: string[]): boolean {
  const b = new Set(bekannt);
  return gewuenscht.every((r) => b.has(r));
}

/** Würde diese Änderung der Person den Administrator-Zugang entziehen? */
export function entziehtAdmin(diff: RollenDiff): boolean {
  return diff.weg.includes(ADMIN_ROLLE);
}
