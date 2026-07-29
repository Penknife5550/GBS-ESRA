/**
 * GBS Campus — minimaler PDF-Erzeuger (rein in Node, ohne Abhaengigkeit)
 *
 * Warum von Hand statt mit einer Bibliothek: Das Image installiert die
 * Abhaengigkeiten mit `npm ci --ignore-scripts` (siehe Dockerfile). Aus genau
 * diesem Grund faellt im Projekt schon die Passwort-Hashfunktion auf Nodes
 * eingebautes scrypt statt auf bcrypt/argon2 (README). Eine PDF-Bibliothek
 * brächte transitive Pakete und eine Neugenerierung der Lockfile mit sich — auf
 * diesem Rechner eine dokumentierte Fehlerquelle (UEBERGABE.md). Für ein
 * schlichtes Textdokument (Ueberschriften, Absaetze, Feld/Wert-Zeilen) reicht
 * ein eigener Erzeuger, der nur Node-Bordmittel braucht.
 *
 * Bewusst klein gehalten: nur die 14 Standard-Fonts (Helvetica, hier als
 * Arial-Ersatz gemaess CREDO-Fallback), kein Einbetten, kein Bild, keine Farbe
 * ausser Grau fuer Kleingedrucktes. Umlaute kommen ueber WinAnsiEncoding
 * (deckungsgleich mit Latin-1 fuer die deutschen Sonderzeichen).
 */

export type PdfBlock =
  | { art: "titel"; text: string }
  | { art: "h2"; text: string }
  | { art: "absatz"; text: string }
  | { art: "kv"; label: string; wert: string }
  | { art: "klein"; text: string }
  | { art: "leer" };

const SEITE_B = 595.28; // A4 hoch, PostScript-Punkte
const SEITE_H = 841.89;
const RAND = 60;
const TEXTBREITE = SEITE_B - 2 * RAND;
const OBEN = SEITE_H - RAND;
const UNTEN = RAND;

type Zeile = { text: string; size: number; bold: boolean; gray: boolean };

/**
 * Ersetzt Zeichen ausserhalb von Latin-1 durch nahe Entsprechungen, escaped die
 * PDF-Sonderzeichen ( ) \ und gibt die Bytes zurueck. Zeichen, die sich nicht
 * abbilden lassen (z. B. Emoji aus einer Freitextantwort), werden zu „?" — der
 * Erzeuger darf an keiner Nutzereingabe scheitern.
 */
function pdfText(s: string): Buffer {
  const ersetzt = s
    .replace(/€/g, "EUR")
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[•·]/g, "-");

  const bytes: number[] = [];
  for (const ch of ersetzt) {
    let code = ch.codePointAt(0)!;
    if (code === 0x28 || code === 0x29 || code === 0x5c) {
      bytes.push(0x5c, code); // ( ) \  escapen
      continue;
    }
    if (code > 0xff) code = 0x3f; // ? als Rueckfall
    else if (code < 0x20) code = 0x20; // Steuerzeichen -> Leerzeichen
    bytes.push(code);
  }
  return Buffer.from(bytes);
}

/**
 * Bricht Text auf eine geschaetzte Zeichenzahl um. Ohne Font-Metriken wird die
 * Zeichenbreite konservativ ueberschaetzt (Faktor 0.52/0.55 der Schriftgroesse),
 * damit eine Zeile nie ueber den rechten Rand laeuft. Zu lange Woerter (etwa
 * eine ununterbrochene IBAN oder ein Link) werden hart getrennt.
 */
function umbrich(text: string, maxZeichen: number): string[] {
  const zeilen: string[] = [];
  for (const roh of text.split("\n")) {
    const woerter = roh.split(/\s+/).filter(Boolean);
    if (woerter.length === 0) {
      zeilen.push("");
      continue;
    }
    let aktuell = "";
    for (const wort of woerter) {
      let w = wort;
      while (w.length > maxZeichen) {
        if (aktuell) {
          zeilen.push(aktuell);
          aktuell = "";
        }
        zeilen.push(w.slice(0, maxZeichen));
        w = w.slice(maxZeichen);
      }
      if (!aktuell) aktuell = w;
      else if ((aktuell + " " + w).length <= maxZeichen) aktuell += " " + w;
      else {
        zeilen.push(aktuell);
        aktuell = w;
      }
    }
    if (aktuell) zeilen.push(aktuell);
  }
  return zeilen;
}

/** Fuegt die physischen Textzeilen eines Blocks in die Sammlung ein. */
function fuegeEin(zeilen: Zeile[], text: string, size: number, bold: boolean, gray: boolean): void {
  const factor = bold ? 0.55 : 0.52;
  const maxZ = Math.max(8, Math.floor(TEXTBREITE / (size * factor)));
  for (const z of umbrich(text, maxZ)) zeilen.push({ text: z, size, bold, gray });
}

/** Erzeugt aus den Bloecken die fertige PDF als Buffer. */
export function erzeugePdf(bloecke: PdfBlock[]): Buffer {
  // 1) Bloecke in physische Zeilen (mit Groesse/Schnitt) uebersetzen.
  const zeilen: Zeile[] = [];
  for (const b of bloecke) {
    switch (b.art) {
      case "titel":
        fuegeEin(zeilen, b.text, 20, true, false);
        zeilen.push({ text: "", size: 8, bold: false, gray: false });
        break;
      case "h2":
        zeilen.push({ text: "", size: 8, bold: false, gray: false });
        fuegeEin(zeilen, b.text, 13, true, false);
        zeilen.push({ text: "", size: 3, bold: false, gray: false });
        break;
      case "absatz":
        fuegeEin(zeilen, b.text, 10.5, false, false);
        break;
      case "kv":
        fuegeEin(zeilen, `${b.label}: ${b.wert}`, 10.5, false, false);
        break;
      case "klein":
        fuegeEin(zeilen, b.text, 9, false, true);
        break;
      case "leer":
        zeilen.push({ text: "", size: 6, bold: false, gray: false });
        break;
    }
  }

  // 2) Zeilen auf Seiten verteilen und je Seite einen Inhaltsstrom bauen.
  const seiten: Buffer[] = [];
  let strom: Buffer[] = [];
  let y = OBEN;
  const flush = () => {
    seiten.push(strom.length ? Buffer.concat(strom) : Buffer.from(""));
    strom = [];
    y = OBEN;
  };
  for (const z of zeilen) {
    const lh = z.size * 1.42;
    if (y - lh < UNTEN) flush();
    y -= lh;
    if (!z.text) continue;
    const font = z.bold ? "F2" : "F1";
    const farbe = z.gray ? "0.4 0.4 0.4 rg\n" : "";
    const reset = z.gray ? "\n0 0 0 rg" : "";
    strom.push(Buffer.from(`${farbe}BT /${font} ${z.size} Tf ${RAND} ${y.toFixed(2)} Td (`));
    strom.push(pdfText(z.text));
    strom.push(Buffer.from(`) Tj ET${reset}\n`));
  }
  flush();

  // 3) PDF-Objekte zusammensetzen.
  const N = seiten.length;
  const teile: Buffer[] = [];
  let offset = 0;
  const offsets: number[] = [];
  const push = (b: Buffer) => {
    teile.push(b);
    offset += b.length;
  };
  const obj = (nr: number, koerper: string | Buffer) => {
    offsets[nr] = offset;
    const k = typeof koerper === "string" ? Buffer.from(koerper) : koerper;
    push(Buffer.concat([Buffer.from(`${nr} 0 obj\n`), k, Buffer.from("\nendobj\n")]));
  };

  push(Buffer.from("%PDF-1.4\n"));
  push(Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // %âãÏÓ — markiert die Datei als binaer

  const seitenNr = (i: number) => 6 + i * 2;
  const kids = Array.from({ length: N }, (_, i) => `${seitenNr(i)} 0 R`).join(" ");

  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [ ${kids} ] /Count ${N} >>`);
  obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  obj(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

  for (let i = 0; i < N; i++) {
    const inhalt = seiten[i];
    const inhaltNr = 5 + i * 2;
    obj(
      inhaltNr,
      Buffer.concat([
        Buffer.from(`<< /Length ${inhalt.length} >>\nstream\n`),
        inhalt,
        Buffer.from("\nendstream"),
      ]),
    );
    obj(
      seitenNr(i),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${SEITE_B} ${SEITE_H}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${inhaltNr} 0 R >>`,
    );
  }

  // 4) Querverweistabelle und Trailer.
  const maxNr = 4 + 2 * N;
  const xrefOffset = offset;
  let xref = `xref\n0 ${maxNr + 1}\n0000000000 65535 f\r\n`;
  for (let nr = 1; nr <= maxNr; nr++) {
    xref += `${String(offsets[nr]).padStart(10, "0")} 00000 n\r\n`;
  }
  push(Buffer.from(xref));
  push(Buffer.from(`trailer\n<< /Size ${maxNr + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`));

  return Buffer.concat(teile);
}
