import { ladeEinwilligungstexte, ladeEntwurf, ladeVeroeffentlichteFassung } from "@/lib/anmeldung";
import {
  EinwilligungsAngebot,
  OeffentlicherAbschnitt,
  OeffentlichesFormular,
} from "./oeffentliches-formular";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Anmeldung — Gemeindebibelschule Minden",
};

export default async function AnmeldungSeite({
  searchParams,
}: {
  searchParams: Promise<{ fortsetzen?: string }>;
}) {
  const { fortsetzen } = await searchParams;

  const version = await ladeVeroeffentlichteFassung();
  if (!version) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-24">
        <h1 className="text-2xl font-bold tracking-tight">Anmeldung derzeit nicht möglich</h1>
        <p className="mt-3 text-muted-foreground">
          Zurzeit ist kein Anmeldeformular veröffentlicht. Bitte wende dich an die Schulleitung.
        </p>
      </main>
    );
  }

  const texte = await ladeEinwilligungstexte();
  const einwilligungen: EinwilligungsAngebot[] = texte.map((t) => ({
    code: t.code,
    titel: t.titel,
    text: t.text,
    istArt9: t.istArt9,
    pflicht: t.pflicht,
  }));

  // Angefangene Anmeldung fortsetzen. Ein ungültiger oder abgelaufener Token
  // führt nicht zu einer Fehlermeldung — das Formular startet dann einfach leer.
  const entwurf = fortsetzen ? await ladeEntwurf(fortsetzen) : null;

  const abschnitte: OeffentlicherAbschnitt[] = version.abschnitte.map((abschnitt) => ({
    titel: abschnitt.titel,
    beschreibung: abschnitt.beschreibung,
    felder: abschnitt.felder.map((feld) => ({
      code: feld.code,
      typ: feld.typ,
      label: feld.label,
      hilfetext: feld.hilfetext,
      platzhalter: feld.platzhalter,
      pflicht: feld.pflicht,
      optionen: Array.isArray(feld.optionen) ? (feld.optionen as string[]) : null,
      istArt9: feld.istArt9,
      personFeld: feld.personFeld,
    })),
  }));

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Gemeindebibelschule Minden · Christliches Werk Esra e.V.
      </p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight">Anmeldung</h1>

      {entwurf && (
        <p className="mt-6 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          Wir haben deine begonnene Anmeldung wiederhergestellt. Du kannst weitermachen, wo du aufgehört hast.
        </p>
      )}

      <div className="mt-10">
        <OeffentlichesFormular
          versionId={version.id}
          einleitung={version.einleitung}
          abschnitte={abschnitte}
          einwilligungen={einwilligungen}
          startAntworten={(entwurf?.antworten as Record<string, unknown>) ?? {}}
          startToken={entwurf ? (fortsetzen ?? null) : null}
        />
      </div>

    </main>
  );
}
