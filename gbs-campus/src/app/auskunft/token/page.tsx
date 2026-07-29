import { AuskunftAbrufen } from "./abrufen";

/**
 * Abrufseite für die Datenauskunft nach Art. 15 DSGVO.
 *
 * Öffentlich erreichbar (keine Anmeldung nötig) — der Besitz des kurzlebigen,
 * geheimen Links ist der Nachweis. Der Token steht im URL-FRAGMENT (#token=…),
 * das der Browser nicht an den Server schickt; diese Seite kennt ihn also gar
 * nicht, sondern die Client-Komponente liest ihn und löst per POST auf. Damit
 * landet der Token in keinem Zugriffslog, und Link-Scanner in
 * Mail-Sicherheitslösungen bekommen ihn nicht zu sehen.
 */
export const metadata = { title: "Datenauskunft abrufen" };

export default function AuskunftSeite() {
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <h1 className="text-2xl font-bold tracking-tight">Deine Datenauskunft</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Hier kannst du die Auskunft über die zu dir gespeicherten Daten nach Art. 15 DSGVO als PDF
        herunterladen. Sie enthält persönliche Angaben — lade sie an einem Ort herunter, zu dem nur du
        Zugang hast.
      </p>
      <AuskunftAbrufen />
    </main>
  );
}
