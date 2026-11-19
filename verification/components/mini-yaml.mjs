/**
 * A deliberately small YAML reader for the component catalog — no dependency.
 *
 * The sure-store gate jobs install nothing (CI's `gate` job runs under plain
 * node from a fresh clone), so the catalog verification cannot import a YAML
 * package. This reader implements exactly the subset the catalog YAML uses:
 *
 *   - block mappings and block sequences, indented by spaces;
 *   - flow sequences `[a, b]` and flow mappings `{ k: v, ... }`;
 *   - single- and double-quoted scalars, booleans, numbers, null and bare words;
 *   - whole-line and trailing `#` comments outside quotes.
 *
 * Anything outside that subset is a parse error, not a silent guess: anchors,
 * tags, folded scalars and multi-line values fail closed. The implementation
 * was cross-checked against the published `@shing.wong/sure-factor@0.6.0`
 * `convert(yaml, 'yaml', 'json')` on all five catalog entries — the two parsers
 * produce identical objects. `test/components.test.mjs` pins the behaviour.
 */

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\" && quote === '"') { i++; continue; }
      if (ch === quote) {
        if (quote === "'" && line[i + 1] === "'") { i++; continue; }
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

/** Find the key/value colon: outside quotes and followed by space or end. */
function splitKey(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\" && quote === '"') { i++; continue; }
      if (ch === quote) {
        if (quote === "'" && text[i + 1] === "'") { i++; continue; }
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === ":" && (i + 1 === text.length || /\s/.test(text[i + 1]))) {
      return [text.slice(0, i).trim(), text.slice(i + 1).trim()];
    }
  }
  return null;
}

/** Split a flow collection's body on a separator, tracking quotes and depth. */
function splitFlow(body, sep) {
  const out = [];
  let depth = 0;
  let quote = null;
  let current = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      if (ch === "\\" && quote === '"') { current += ch + (body[i + 1] ?? ""); i++; continue; }
      if (ch === quote) {
        if (quote === "'" && body[i + 1] === "'") { current += "''"; i++; continue; }
        quote = null;
      }
      current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; current += ch; continue; }
    if (ch === "[" || ch === "{") depth++;
    if (ch === "]" || ch === "}") depth--;
    if (ch === sep && depth === 0) { out.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  if (quote !== null) throw new Error(`unterminated quote in flow collection: ${body}`);
  if (current.trim() !== "") out.push(current.trim());
  return out;
}

function scalar(text, where) {
  const s = text.trim();
  if (s.startsWith("[") && s.endsWith("]")) {
    const body = s.slice(1, -1).trim();
    return body === "" ? [] : splitFlow(body, ",").map((v) => scalar(v, where));
  }
  if (s.startsWith("{") && s.endsWith("}")) {
    const body = s.slice(1, -1).trim();
    const obj = {};
    if (body !== "") {
      for (const entry of splitFlow(body, ",")) {
        const kv = splitKey(entry);
        if (!kv) throw new Error(`${where}: bad flow mapping entry "${entry}"`);
        obj[kv[0]] = scalar(kv[1], where);
      }
    }
    return obj;
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return JSON.parse(s);
  }
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return Number(s);
  if (/^[&*!|>%@`]/.test(s)) throw new Error(`${where}: unsupported YAML syntax in "${s}"`);
  return s;
}

function tokenize(text) {
  const lines = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const noComment = stripComment(raw);
    if (noComment.trim() === "") return;
    const indent = noComment.length - noComment.trimStart().length;
    if (/\s/.test(noComment[indent])) return; // tabs are not indentation
    if (indent % 2 !== 0) throw new Error(`line ${i + 1}: indentation must be a multiple of 2`);
    lines.push({ indent, text: noComment.slice(indent).trim(), line: i + 1 });
  });
  return lines;
}

function parseBlock(lines, start, indent) {
  if (start >= lines.length) return [null, start];
  const isSeq = lines[start].text === "-" || lines[start].text.startsWith("- ");
  const value = isSeq ? [] : {};
  let i = start;

  while (i < lines.length && lines[i].indent === indent) {
    const tok = lines[i];
    const seqHere = tok.text === "-" || tok.text.startsWith("- ");
    if (seqHere !== isSeq) break;

    if (isSeq) {
      const rest = tok.text === "-" ? "" : tok.text.slice(2).trim();
      i++;
      if (rest === "") {
        if (i >= lines.length || lines[i].indent <= indent) throw new Error(`line ${tok.line}: empty sequence item`);
        const [child, next] = parseBlock(lines, i, lines[i].indent);
        value.push(child);
        i = next;
        continue;
      }
      if (rest.startsWith("{") || rest.startsWith("[")) {
        value.push(scalar(rest, `line ${tok.line}`));
        continue;
      }
      const kv = splitKey(rest);
      if (!kv) { value.push(scalar(rest, `line ${tok.line}`)); continue; }
      // `- key: value` plus continuation keys at a deeper indent.
      const item = { [kv[0]]: kv[1] === "" ? null : scalar(kv[1], `line ${tok.line}`) };
      if (i < lines.length && lines[i].indent > indent) {
        const [child, next] = parseBlock(lines, i, lines[i].indent);
        if (child && typeof child === "object" && !Array.isArray(child)) Object.assign(item, child);
        i = next;
      }
      value.push(item);
      continue;
    }

    const kv = splitKey(tok.text);
    if (!kv) throw new Error(`line ${tok.line}: expected "key: value", got "${tok.text}"`);
    const [key, rest] = kv;
    if (key === "") throw new Error(`line ${tok.line}: empty key`);
    i++;
    if (rest === "") {
      if (i >= lines.length || lines[i].indent <= indent) {
        value[key] = null;
      } else {
        const [child, next] = parseBlock(lines, i, lines[i].indent);
        value[key] = child;
        i = next;
      }
    } else {
      value[key] = scalar(rest, `line ${tok.line}`);
    }
  }
  return [value, i];
}

/** Parse the catalog's YAML subset into a plain object. Fails closed. */
export function parseYaml(text, file = "<yaml>") {
  const lines = tokenize(text);
  if (lines.length === 0) return {};
  const [value, end] = parseBlock(lines, 0, lines[0].indent);
  if (end !== lines.length) {
    throw new Error(`${file}: could not parse line ${lines[end].line}: "${lines[end].text}"`);
  }
  return value;
}
