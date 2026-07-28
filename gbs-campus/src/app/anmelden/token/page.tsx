import { AnmeldungBestaetigen } from "./bestaetigen";

/**
 * Zwischenseite beim Einlösen eines Anmeldelinks.
 *
 * Warum nicht direkt im GET einlösen, wie vorher:
 *
 *  1. **Link-Scanner.** Microsoft 365 Safe Links, die Scanner von GMX und
 *     web.de und diverse Virenschutzprogramme rufen Links in E-Mails vorab ab.
 *     Ein im GET verbrauchter Einmal-Token wäre damit entwertet, bevor der
 *     Empfänger überhaupt klickt — bei passwortlosem Login ein vollständiger
 *     Zugangsausfall für einzelne Nutzer, ohne erkennbaren Grund.
 *  2. **Login-CSRF.** Ein Angreifer könnte jemanden per Bild-Tag oder
 *     Weiterleitung auf seinen eigenen Token schicken; das Opfer arbeitete dann
 *     unbemerkt im fremden Konto.
 *
 * Ein Klick auf einen Knopf, der ein POST auslöst, entschärft beides.
 */
export const metadata = { title: "Anmeldung bestätigen" };

export default async function TokenSeite({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <main className="mx-auto max-w-md px-6 py-24">
        <h1 className="text-2xl font-bold tracking-tight">Der Link war unvollständig</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Bitte fordere auf der Anmeldeseite einen neuen Link an.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <h1 className="text-2xl font-bold tracking-tight">Anmeldung bestätigen</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Ein Klick, und du bist angemeldet. Der Link gilt danach als verbraucht.
      </p>
      <AnmeldungBestaetigen token={token} />
    </main>
  );
}
