/**
 * RFC 4180 CSV parser.
 *
 * Hand-written rather than a dependency because the requirements are small and precise, and
 * the failure mode of getting it wrong is silent: a naive `split(",")` corrupts every row
 * containing a quoted comma, which in a transaction export means every note and every payee
 * with a comma in it. Handles quoted fields, escaped quotes, embedded newlines, CRLF, and a
 * UTF-8 BOM.
 */

export function parseCsv(input: string): string[][] {
  // Excel writes a BOM; left in place it becomes part of the first column's name and the
  // header never matches.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // escaped quote
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (char === ",") {
      endField();
      i++;
      continue;
    }
    if (char === "\r") {
      // CRLF or a lone CR both terminate the row.
      if (text[i + 1] === "\n") i++;
      endRow();
      i++;
      continue;
    }
    if (char === "\n") {
      endRow();
      i++;
      continue;
    }

    field += char;
    i++;
  }

  // A trailing newline should not produce a phantom empty row.
  if (field !== "" || row.length > 0) endRow();

  return rows;
}

export interface CsvTable {
  headers: string[];
  rows: Record<string, string>[];
}

/** Parses with the first row as headers. Duplicate headers get a numeric suffix. */
export function parseCsvTable(input: string): CsvTable {
  const raw = parseCsv(input).filter((row) => row.some((cell) => cell.trim() !== ""));
  if (raw.length === 0) return { headers: [], rows: [] };

  const seen = new Map<string, number>();
  const headers = raw[0]!.map((header) => {
    const name = header.trim() || "column";
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count === 0 ? name : `${name}_${count + 1}`;
  });

  const rows = raw.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = (cells[index] ?? "").trim();
    });
    return record;
  });

  return { headers, rows };
}
