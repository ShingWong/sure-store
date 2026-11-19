/**
 * The closed guard vocabulary, evaluated without `eval` or `new Function`.
 *
 * Only the forms used by the catalog's guards are accepted; anything else is
 * a parse error (fail closed). Numbers, strings, `==`, `!=`, `+`, `-`,
 * parentheses, the row bindings (`rows`, `record`, `series`, …), `totals`,
 * `F:`/`P:` references and the built-ins `sum`, `count`, `len` and
 * `ifpresent` are supported — the same surface sure-factor's projection
 * scanner recognises (see validate.mjs).
 */

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      let value = "";
      while (j < src.length && src[j] !== quote) {
        if (src[j] === "\\" && quote === '"') { value += src[j + 1]; j += 2; continue; }
        value += src[j++];
      }
      if (j >= src.length) throw new Error(`unterminated string in guard: ${src}`);
      tokens.push({ type: "string", value });
      i = j + 1;
      continue;
    }
    if (ch >= "0" && ch <= "9") {
      let j = i;
      while (j < src.length && /[\d.]/.test(src[j])) j++;
      tokens.push({ type: "number", value: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /\w/.test(src[j])) j++;
      // `F:name` / `P:name` are two tokens to the scanner but one name here.
      if ((ch === "F" || ch === "P") && src[j] === ":") {
        const nameStart = j + 1;
        let k = nameStart;
        while (k < src.length && /\w/.test(src[k])) k++;
        tokens.push({ type: "ident", value: src.slice(nameStart, k), ref: ch });
        i = k;
        continue;
      }
      tokens.push({ type: "ident", value: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["==", "!=", ">=", "<=", ">", "<"].includes(two)) {
      tokens.push({ type: "op", value: two });
      i += 2;
      continue;
    }
    if ("+-().,".includes(ch)) {
      tokens.push({ type: ch });
      i++;
      continue;
    }
    throw new Error(`unexpected character "${ch}" in guard: ${src}`);
  }
  tokens.push({ type: "eof" });
  return tokens;
}

const ROW_ROOTS = new Set(["rows", "row", "record", "data", "series", "item", "fields", "input"]);

function resolve(parts, input, row) {
  const [root, ...restTokens] = parts;
  const rest = restTokens.map((t) => t.value);
  let base;
  if (root.ref === "F") base = row ?? input;
  else if (root.ref === "P") base = input.parameters ?? {};
  else base = input[root.value];
  if (rest.length === 0) return base;
  if (Array.isArray(base)) return base.map((item) => (item == null ? undefined : item[rest[0]]));
  if (base && typeof base === "object") return base[rest[0]];
  return undefined;
}

function evaluate(src, input, row) {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const take = () => tokens[pos++];
  const expect = (type) => {
    const t = take();
    if (t.type !== type) throw new Error(`expected ${type} in guard "${src}", got ${t.type}`);
    return t;
  };

  function primary() {
    const t = peek();
    if (t.type === "(") {
      take();
      const value = equality();
      expect(")");
      return value;
    }
    if (t.type === "number" || t.type === "string") return take().value;
    if (t.type === "ident" && !t.ref && ["true", "false", "null"].includes(t.value)) {
      take();
      return t.value === "true" ? true : t.value === "false" ? false : null;
    }
    if (t.type === "ident") {
      const name = take();
      if (peek().type === "(") {
        take();
        const args = [];
        if (peek().type !== ")") {
          args.push(equality());
          while (peek().type === ",") { take(); args.push(equality()); }
        }
        expect(")");
        return call(name.value, args, src);
      }
      const parts = [name];
      while (peek().type === ".") {
        take();
        parts.push(expect("ident"));
      }
      return resolve(parts, input, row);
    }
    throw new Error(`unexpected token ${t.type} in guard: ${src}`);
  }

  function additive() {
    let left = primary();
    while (peek().type === "+" || peek().type === "-") {
      const op = take().type;
      const right = primary();
      left = op === "+" ? Number(left) + Number(right) : Number(left) - Number(right);
    }
    return left;
  }

  function comparison() {
    let left = additive();
    while (
      peek().type === "op" &&
      [">=", "<=", ">", "<"].includes(peek().value)
    ) {
      const op = take().value;
      const right = additive();
      left =
        op === ">=" ? Number(left) >= Number(right)
        : op === "<=" ? Number(left) <= Number(right)
        : op === ">" ? Number(left) > Number(right)
        : Number(left) < Number(right);
    }
    return left;
  }

  function equality() {
    let left = comparison();
    while (peek().type === "op" && (peek().value === "==" || peek().value === "!=")) {
      const op = take().value;
      const right = comparison();
      left = op === "==" ? left === right : left !== right;
    }
    return left;
  }

  const result = equality();
  if (peek().type !== "eof") throw new Error(`trailing tokens in guard: ${src}`);
  return result;
}

function call(name, args, src) {
  switch (name) {
    case "sum": {
      const v = args[0];
      if (Array.isArray(v)) return v.reduce((n, x) => n + Number(x), 0);
      return Number(v);
    }
    case "count": {
      const v = args[0];
      if (Array.isArray(v)) return v.length;
      if (v && typeof v === "object") return Object.keys(v).length;
      return v === undefined || v === null ? 0 : 1;
    }
    case "len": {
      const v = args[0];
      if (typeof v === "string" || Array.isArray(v)) return v.length;
      throw new Error(`len() needs a string or array in guard: ${src}`);
    }
    case "ifpresent": {
      const v = args[0];
      return v === undefined || v === null ? args[1] : v;
    }
    default:
      throw new Error(`unknown function "${name}" in guard: ${src}`);
  }
}

/** Evaluate every guard against a fixture input. Throws on malformed guards. */
export function runGuards(guards, input) {
  const rows = Array.isArray(input.rows) ? input.rows : input.record;
  const results = {};
  for (const guard of guards) {
    const values = Array.isArray(rows) ? rows : [undefined];
    results[guard] = values.every((row) => Boolean(evaluate(guard, input, row)));
  }
  return results;
}
