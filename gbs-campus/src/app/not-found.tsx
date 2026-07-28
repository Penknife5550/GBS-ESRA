import Link from "next/link";

export default function NichtGefunden() {
  return (
    <main className="mx-auto max-w-lg px-6 py-24">
      <h1 className="text-2xl font-bold tracking-tight">Diese Seite gibt es nicht</h1>
      <p className="mt-3 text-muted-foreground">
        Vielleicht hat sich ein Tippfehler in die Adresse geschlichen, oder der Link ist veraltet.
      </p>
      <Link
        href="/"
        className="mt-8 inline-block rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground"
      >
        Zur Startseite
      </Link>
    </main>
  );
}
