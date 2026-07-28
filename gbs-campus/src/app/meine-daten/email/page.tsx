import { EmailBestaetigen } from "./bestaetigen";

export const metadata = { title: "Neue E-Mail-Adresse bestätigen" };

/**
 * Zwischenseite für den Bestätigungslink aus der Mail an die NEUE Adresse.
 * Absichtlich ohne Anmeldung erreichbar: Der Link wird im neuen Postfach
 * geöffnet, oft auf einem anderen Gerät.
 */
export default async function EmailBestaetigenSeite({
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
          Bitte beantrage die Änderung im Portal unter „Meine Daten" noch einmal.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <h1 className="text-2xl font-bold tracking-tight">Neue E-Mail-Adresse bestätigen</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Danach läuft dein Zugang zum Portal über diese Adresse. Bis zu diesem Klick gilt die bisherige.
      </p>
      <EmailBestaetigen token={token} />
    </main>
  );
}
