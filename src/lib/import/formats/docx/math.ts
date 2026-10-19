import { attr, child, children, is } from "./xml";

/**
 * Word equations (Office Math, OMML) as LaTeX, the way the editor stores
 * them. Covers what Word's equation editor inserts: fractions, scripts,
 * roots, big operators, brackets, functions, accents, matrices and
 * equation arrays.
 */
export function ommlToLatex(math: Element): string {
  return clean(convertChildren(math));
}

const SYMBOLS: Record<string, string> = {
  α: "\\alpha", β: "\\beta", γ: "\\gamma", δ: "\\delta", ε: "\\epsilon", ϵ: "\\epsilon", ζ: "\\zeta", η: "\\eta",
  θ: "\\theta", ϑ: "\\vartheta", ι: "\\iota", κ: "\\kappa", λ: "\\lambda", μ: "\\mu", ν: "\\nu", ξ: "\\xi",
  π: "\\pi", ϖ: "\\varpi", ρ: "\\rho", σ: "\\sigma", ς: "\\varsigma", τ: "\\tau", υ: "\\upsilon", φ: "\\phi",
  ϕ: "\\phi", χ: "\\chi", ψ: "\\psi", ω: "\\omega", Γ: "\\Gamma", Δ: "\\Delta", Θ: "\\Theta", Λ: "\\Lambda",
  Ξ: "\\Xi", Π: "\\Pi", Σ: "\\Sigma", Υ: "\\Upsilon", Φ: "\\Phi", Ψ: "\\Psi", Ω: "\\Omega",
  "∞": "\\infty", "±": "\\pm", "∓": "\\mp", "×": "\\times", "÷": "\\div", "·": "\\cdot", "⋅": "\\cdot",
  "∘": "\\circ", "≤": "\\le", "≥": "\\ge", "≠": "\\ne", "≈": "\\approx", "≡": "\\equiv", "∼": "\\sim",
  "≅": "\\cong", "∝": "\\propto", "∈": "\\in", "∉": "\\notin", "∋": "\\ni", "⊂": "\\subset", "⊃": "\\supset",
  "⊆": "\\subseteq", "⊇": "\\supseteq", "∪": "\\cup", "∩": "\\cap", "∅": "\\emptyset", "∀": "\\forall",
  "∃": "\\exists", "¬": "\\neg", "∧": "\\wedge", "∨": "\\vee", "→": "\\to", "←": "\\leftarrow",
  "↔": "\\leftrightarrow", "⇒": "\\Rightarrow", "⇐": "\\Leftarrow", "⇔": "\\Leftrightarrow", "↦": "\\mapsto",
  "∂": "\\partial", "∇": "\\nabla", "√": "\\surd", "∠": "\\angle", "⊥": "\\perp", "∥": "\\parallel",
  "…": "\\ldots", "⋯": "\\cdots", "⋮": "\\vdots", "⋱": "\\ddots", "ℏ": "\\hbar", "ℓ": "\\ell", "ℝ": "\\mathbb{R}",
  "ℕ": "\\mathbb{N}", "ℤ": "\\mathbb{Z}", "ℚ": "\\mathbb{Q}", "ℂ": "\\mathbb{C}", "′": "'", "″": "''",
  "−": "-", "∗": "*", "⊕": "\\oplus", "⊗": "\\otimes", "≪": "\\ll", "≫": "\\gg", "∣": "\\mid",
};

const NARY: Record<string, string> = {
  "∑": "\\sum", "∏": "\\prod", "∐": "\\coprod", "∫": "\\int", "∬": "\\iint", "∭": "\\iiint", "∮": "\\oint",
  "∯": "\\oiint", "⋃": "\\bigcup", "⋂": "\\bigcap", "⋁": "\\bigvee", "⋀": "\\bigwedge", "⨁": "\\bigoplus",
  "⨂": "\\bigotimes",
};

const ACCENTS: Record<string, string> = {
  "̂": "\\hat", "^": "\\hat", "̃": "\\tilde", "~": "\\tilde", "̄": "\\bar", "̅": "\\overline",
  "⃗": "\\vec", "→": "\\vec", "̇": "\\dot", "̈": "\\ddot", "̌": "\\check",
  "́": "\\acute", "̀": "\\grave", "̆": "\\breve",
};

const FUNCTIONS = new Set([
  "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "coth", "log",
  "ln", "lg", "exp", "lim", "max", "min", "sup", "inf", "det", "dim", "ker", "deg", "gcd", "arg", "Pr",
]);

const BRACKETS: Record<string, string> = {
  "(": "(", ")": ")", "[": "[", "]": "]", "{": "\\{", "}": "\\}", "|": "|", "‖": "\\|", "⟨": "\\langle",
  "⟩": "\\rangle", "⌊": "\\lfloor", "⌋": "\\rfloor", "⌈": "\\lceil", "⌉": "\\rceil", "": ".",
};

function escapeText(text: string) {
  let out = "";
  for (const char of text) {
    if (SYMBOLS[char]) out += `${SYMBOLS[char]} `;
    else if (NARY[char]) out += `${NARY[char]} `;
    else if ("#$%&_{}".includes(char)) out += `\\${char}`;
    else if (char === "\\") out += "\\backslash ";
    else if (char === "~") out += "\\sim ";
    else if (char === "^") out += "\\hat{}";
    else out += char;
  }
  return out;
}

/** `chr` of a properties element, with Word's default when it's missing. */
function chr(props: Element | null, name: string, fallback: string) {
  const element = child(props, "m", name);
  if (!element) return fallback;
  return attr(element, "m", "val") ?? "";
}

function arg(parent: Element, name: string) {
  return clean(convertChildren(child(parent, "m", name)));
}

function group(value: string) {
  return value.length === 1 ? value : `{${value}}`;
}

function convertChildren(parent: Element | null): string {
  if (!parent) return "";
  let out = "";
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    // Stray text outside a run isn't valid OMML, but some writers leave it.
    if (node.nodeType === 3) out += escapeText(node.textContent ?? "");
    else if (node.nodeType === 1) out += convert(node as Element);
  }
  return out;
}

function convert(element: Element): string {
  if (is(element, "m", "r") || is(element, "w", "r")) {
    const textElement = child(element, "m", "t") ?? child(element, "w", "t");
    const value = textElement?.textContent ?? "";
    const plain = attr(child(child(element, "m", "rPr"), "m", "sty"), "m", "val") === "p";
    if (FUNCTIONS.has(value)) return `\\${value} `;
    if (plain && /^[A-Za-z]{2,}$/.test(value)) return `\\mathrm{${value}}`;
    if (child(child(element, "m", "rPr"), "m", "nor")) {
      if (!value.trim() || [...value].every((char) => SYMBOLS[char] || NARY[char])) return escapeText(value);
      return `\\text{${value}}`;
    }
    return escapeText(value);
  }

  if (!is(element, "m", element.localName)) return "";

  switch (element.localName) {
    case "f": {
      const type = attr(child(child(element, "m", "fPr"), "m", "type"), "m", "val");
      const num = arg(element, "num");
      const den = arg(element, "den");
      if (type === "lin") return `${group(num)}/${group(den)}`;
      if (type === "noBar") return `\\genfrac{}{}{0pt}{}{${num}}{${den}}`;
      return `\\frac{${num}}{${den}}`;
    }
    case "sSup":
      return `${group(arg(element, "e"))}^{${arg(element, "sup")}}`;
    case "sSub":
      return `${group(arg(element, "e"))}_{${arg(element, "sub")}}`;
    case "sSubSup":
      return `${group(arg(element, "e"))}_{${arg(element, "sub")}}^{${arg(element, "sup")}}`;
    case "sPre":
      return `{}_{${arg(element, "sub")}}^{${arg(element, "sup")}}${group(arg(element, "e"))}`;
    case "rad": {
      const props = child(element, "m", "radPr");
      const hidden = attr(child(props, "m", "degHide"), "m", "val");
      const degree = hidden === "1" || hidden === "on" ? "" : arg(element, "deg");
      return degree ? `\\sqrt[${degree}]{${arg(element, "e")}}` : `\\sqrt{${arg(element, "e")}}`;
    }
    case "nary": {
      const props = child(element, "m", "naryPr");
      const symbol = chr(props, "chr", "∫");
      const command = NARY[symbol] ?? escapeText(symbol);
      const subHidden = /^(1|on|true)$/.test(attr(child(props, "m", "subHide"), "m", "val") ?? "");
      const supHidden = /^(1|on|true)$/.test(attr(child(props, "m", "supHide"), "m", "val") ?? "");
      const sub = subHidden ? "" : arg(element, "sub");
      const sup = supHidden ? "" : arg(element, "sup");
      const limits = attr(child(props, "m", "limLoc"), "m", "val") === "undOvr" && command.includes("int") ? "\\limits" : "";
      return `${command}${limits}${sub ? `_{${sub}}` : ""}${sup ? `^{${sup}}` : ""} ${arg(element, "e")}`;
    }
    case "d": {
      const props = child(element, "m", "dPr");
      const open = chr(props, "begChr", "(");
      const close = chr(props, "endChr", ")");
      const separator = chr(props, "sepChr", "|");
      const parts = children(element, "m", "e").map((part) => clean(convertChildren(part)));
      const inner = parts.join(separator === "|" ? " \\mid " : ` ${escapeText(separator)} `);
      return `\\left${BRACKETS[open] ?? escapeText(open)} ${inner} \\right${BRACKETS[close] ?? escapeText(close)}`;
    }
    case "func": {
      const name = clean(convertChildren(child(element, "m", "fName")));
      const known = name.replace(/\\mathrm\{(\w+)\}/, "$1").trim();
      const head = FUNCTIONS.has(known) ? `\\${known}` : name.startsWith("\\") ? name : `\\operatorname{${known}}`;
      return `${head}{${arg(element, "e")}}`;
    }
    case "acc": {
      const symbol = chr(child(element, "m", "accPr"), "chr", "̂");
      return `${ACCENTS[symbol] ?? "\\hat"}{${arg(element, "e")}}`;
    }
    case "bar": {
      const position = attr(child(child(element, "m", "barPr"), "m", "pos"), "m", "val");
      return `${position === "top" ? "\\overline" : "\\underline"}{${arg(element, "e")}}`;
    }
    case "groupChr": {
      const props = child(element, "m", "groupChrPr");
      const symbol = chr(props, "chr", "⏟");
      const command = symbol === "⏞" ? "\\overbrace" : "\\underbrace";
      return `${command}{${arg(element, "e")}}`;
    }
    case "limLow": {
      const base = arg(element, "e");
      const limit = arg(element, "lim");
      return /^\\(lim|max|min|sup|inf)\s*$/.test(base) ? `${base.trim()}_{${limit}}` : `\\underset{${limit}}{${base}}`;
    }
    case "limUpp":
      return `\\overset{${arg(element, "lim")}}{${arg(element, "e")}}`;
    case "borderBox":
      return `\\boxed{${arg(element, "e")}}`;
    case "box":
    case "phant":
      return arg(element, "e");
    case "m": {
      const rows = children(element, "m", "mr").map((row) =>
        children(row, "m", "e").map((cell) => clean(convertChildren(cell))).join(" & "),
      );
      return `\\begin{matrix} ${rows.join(" \\\\ ")} \\end{matrix}`;
    }
    case "eqArr": {
      const rows = children(element, "m", "e").map((row) => clean(convertChildren(row)));
      return `\\begin{aligned} ${rows.join(" \\\\ ")} \\end{aligned}`;
    }
    case "oMath":
    case "oMathPara":
    case "e":
    case "num":
    case "den":
    case "sub":
    case "sup":
    case "deg":
    case "lim":
    case "fName":
      return convertChildren(element);
    default:
      // Property elements (`*Pr`) and anything unknown: no text of their own.
      return element.localName.endsWith("Pr") ? "" : convertChildren(element);
  }
}

function clean(value: string) {
  return value.replace(/\s+/g, " ").replace(/ ([}^_)])/g, "$1").trim();
}
