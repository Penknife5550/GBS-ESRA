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
 * (deckungsgleich mit Latin-1 fuer die deutschen Sonderzeichen); was WinAnsi
 * darueber hinaus kennt (Š, Ž, Œ …), wird ueber eine Tabelle abgebildet, der
 * Rest transliteriert (ł -> l, ř -> r, ş -> s) — siehe `pdfText`.
 */

export type PdfBlock =
  | { art: "titel"; text: string }
  | { art: "h2"; text: string }
  | { art: "absatz"; text: string }
  | { art: "kv"; label: string; wert: string }
  | { art: "klein"; text: string }
  | { art: "leer" }
  // Erzwingt eine neue Seite — fuer den Zeugnis-Seriendruck, damit jede Person auf
  // einem eigenen Blatt beginnt.
  | { art: "seitenumbruch" };

const SEITE_B = 595.28; // A4 hoch, PostScript-Punkte
const SEITE_H = 841.89;
const RAND = 60;
const TEXTBREITE = SEITE_B - 2 * RAND;
const OBEN = SEITE_H - RAND;
const UNTEN = RAND;

type Zeile = { text: string; size: number; bold: boolean; gray: boolean; umbruch?: boolean };

/**
 * WinAnsiEncoding weicht nur in 0x80–0x9F von Latin-1 ab: Dort liegen einige
 * Buchstaben und Zeichen, deren Unicode-Codepoint ueber 0xFF liegt. Ohne diese
 * Tabelle wurde aus „Šimić" ein „?imi?" — auf einem eingefrorenen Zeugnis.
 * Nicht enthalten: € (bleibt bewusst „EUR") sowie Anfuehrungszeichen, Striche
 * und … (ersetzt `pdfText` vorher durch ASCII).
 */
const WINANSI_80_9F: Record<string, number> = {
  "ƒ": 0x83,
  "†": 0x86,
  "‡": 0x87,
  "ˆ": 0x88,
  "‰": 0x89,
  "Š": 0x8a,
  "‹": 0x8b,
  "Œ": 0x8c,
  "Ž": 0x8e,
  "˜": 0x98,
  "™": 0x99,
  "š": 0x9a,
  "›": 0x9b,
  "œ": 0x9c,
  "ž": 0x9e,
  "Ÿ": 0x9f,
};

/**
 * Zeichen, die sich nicht in Grundbuchstabe + Akzent zerlegen lassen (NFKD
 * greift nicht), aber in Namen vorkommen — polnisch ł, kroatisch/serbisch đ,
 * tuerkisch ı —, dazu seltene Striche/Apostrophe und unsichtbare Zeichen aus
 * kopiertem Text (die sonst als „?" mitten im Namen stuenden).
 */
const TRANSLITERATION: Record<string, string> = {
  "Ł": "L",
  "ł": "l",
  "Đ": "D",
  "đ": "d",
  "ı": "i",
  "Ħ": "H",
  "ħ": "h",
  "Ŧ": "T",
  "ŧ": "t",
  "Ŋ": "N",
  "ŋ": "n",
  "ĸ": "k",
  "ẞ": "SS",
  "ʻ": "'",
  "ʼ": "'",
  "‛": "'",
  "′": "'",
  "″": '"',
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "―": "-",
  "−": "-",
  "​": "",
  "‌": "",
  "‍": "",
  "⁠": "",
  "﻿": "",
};

/** Die WinAnsi-Bytes eines einzelnen Zeichens (Codepoint). */
function zeichenBytes(ch: string, zerlegen: boolean): number[] {
  const code = ch.codePointAt(0)!;
  if (code === 0x28 || code === 0x29 || code === 0x5c) return [0x5c, code]; // ( ) \  escapen
  // Steuerzeichen -> Leerzeichen, auch DEL und C1 (0x80–0x9F): Als Byte stuende
  // dort in WinAnsi ein sichtbares Zeichen (Š, Œ …), das nie im Text war.
  if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return [0x20];
  if (code <= 0xff) return [code];
  const winAnsi = WINANSI_80_9F[ch];
  if (winAnsi !== undefined) return [winAnsi];
  if (/\p{M}/u.test(ch)) return []; // alleinstehendes Akzentzeichen faellt weg
  const ersatz = TRANSLITERATION[ch];
  if (ersatz !== undefined) return [...ersatz].flatMap((c) => zeichenBytes(c, false));
  if (zerlegen) {
    // ř -> r + ˇ, ş -> s + ¸, İ -> I + ˙: der Akzent faellt oben weg.
    const teile = ch.normalize("NFKD");
    if (teile !== ch) return [...teile].flatMap((c) => zeichenBytes(c, false));
  }
  return [0x3f]; // ? als Rueckfall
}

/**
 * Wandelt Text in WinAnsi-Bytes: Latin-1 direkt, die WinAnsi-Zeichen aus
 * 0x80–0x9F ueber die Tabelle, alles andere transliteriert (ł -> l, ř -> r,
 * ş -> s), und escaped die PDF-Sonderzeichen ( ) \. Zeichen, die sich nicht
 * abbilden lassen (z. B. Emoji aus einer Freitextantwort), werden zu „?" — der
 * Erzeuger darf an keiner Nutzereingabe scheitern. Vorab NFC: Ein zerlegt
 * gespeichertes „é" (e + Akzent, etwa von macOS) wird wieder ein Latin-1-Zeichen.
 */
export function pdfText(s: string): Buffer {
  const ersetzt = s
    .normalize("NFC")
    .replace(/€/g, "EUR")
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[•·]/g, "-");

  const bytes: number[] = [];
  for (const ch of ersetzt) bytes.push(...zeichenBytes(ch, true));
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
      case "seitenumbruch":
        zeilen.push({ text: "", size: 0, bold: false, gray: false, umbruch: true });
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
    // Erzwungener Seitenumbruch: die aktuelle Seite abschliessen und neu beginnen.
    // Eine bereits leere Seite (nichts geschrieben) nicht ein zweites Mal umbrechen.
    if (z.umbruch) {
      if (strom.length > 0) flush();
      continue;
    }
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
