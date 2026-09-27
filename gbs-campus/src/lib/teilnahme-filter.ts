/**
 * GBS Campus — Filter „zählende Teilnahme"
 *
 * Eine Teilnahme mit gesetztem `abgemeldetAm` zählt nicht: Die Person hat zur
 * Semesterüberleitung „bin raus" gesagt oder bis Semesterstart nicht
 * geantwortet. Sie fällt aus ALLEN Listen und Abfragen dieses Semesters —
 * Teilnehmerliste und Excel, Anwesenheit und Quote, Noten, Zeugnislauf,
 * Kennzahlen. Der Personenstatus bleibt dabei unverändert; die Teilnahme selbst
 * bleibt als Nachweis stehen (deshalb legt auch die Sammelübernahme sie nicht
 * neu an).
 *
 * Ein reines Objekt ohne Prisma-Import, damit jede Abfrage es in ihr `where`
 * einmischen kann (`{ semesterId, ...TEILNAHME_ZAEHLT }` bzw.
 * `teilnahmen: { some: { ...TEILNAHME_ZAEHLT } }`) und die Prüfskripte es ohne
 * Datenbank finden. Wer eine neue Teilnahme-Abfrage für ein Semester schreibt,
 * mischt diesen Filter ein — `scripts/pruefe-semesterlogik.ts` prüft die
 * bekannten Stellen im Quelltext nach.
 */
export const TEILNAHME_ZAEHLT = { abgemeldetAm: null } as const;

/**
 * Filter „aktive Person": ein Personenstatus mit `istAktiv`. Welche Zustände
 * das sind, entscheidet die Tabelle `teilnehmer_status` (ABSOLVENT etwa nicht).
 * Einzumischen als `person: PERSON_ZAEHLT_AKTIV` in Teilnahme-Abfragen bzw.
 * `where: { ...PERSON_ZAEHLT_AKTIV }` in Personen-Abfragen. Vorher stand
 * `status: { istAktiv: true }` an vierzehn Stellen in zehn Dateien — wer die
 * Regel ändern wollte, musste sie alle finden. (Die Zeugnisseite hat mit
 * `ZEUGNIS_PERSON` in zeugnis-io.ts bewusst eine eigene Regel, die Absolventen
 * einschließt.)
 */
export const PERSON_ZAEHLT_AKTIV = { status: { istAktiv: true } } as const;
