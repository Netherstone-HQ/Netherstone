// Builds the assistant's bundled model catalog from models.dev and LiteLLM's
// model list: what each model takes in, its limits, and whether it thinks.
// Run with `node scripts/ai-catalog.mjs`, or pass the two JSON files to read
// them from disk: `node scripts/ai-catalog.mjs models.json litellm.json`.

import { readFile, writeFile } from "node:fs/promises";

const MODELS_DEV = "https://models.dev/api.json";
const LITELLM =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const OUT = new URL(
  "../src-tauri/src/assistant/catalog.json",
  import.meta.url,
);

/** Our provider id: its models.dev id, its LiteLLM provider and key prefix. */
const PROVIDERS = {
  openai: { modelsDev: "openai", litellm: "openai", prefix: "" },
  anthropic: { modelsDev: "anthropic", litellm: "anthropic", prefix: "" },
  google: { modelsDev: "google", litellm: "gemini", prefix: "gemini/" },
  openrouter: {
    modelsDev: "openrouter",
    litellm: "openrouter",
    prefix: "openrouter/",
  },
};

/** models.dev types and LiteLLM modes a chat can't use. */
const NOT_CHAT_TYPES = new Set(["embedding", "image", "speech", "realtime", "video"]);
const CHAT_MODES = new Set(["chat", "responses"]);

async function load(path, url) {
  if (path) return JSON.parse(await readFile(path, "utf8"));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

function fromModelsDev(model) {
  const input = model.modalities?.input ?? [];
  return {
    name: model.name,
    context: model.limit?.context,
    output: model.limit?.output,
    reasoning: model.reasoning,
    tools: model.tool_call,
    images: input.includes("image"),
    pdfs: input.includes("pdf"),
    caching: model.cost?.cache_read !== undefined || undefined,
    chat: NOT_CHAT_TYPES.has(model.type) ? false : undefined,
  };
}

function fromLitellm(model) {
  return {
    context: model.max_input_tokens,
    output: model.max_output_tokens,
    reasoning: model.supports_reasoning,
    tools: model.supports_function_calling,
    images: model.supports_vision,
    pdfs: model.supports_pdf_input,
    caching: model.supports_prompt_caching,
    chat: CHAT_MODES.has(model.mode) ? undefined : false,
    responsesOnly: model.mode === "responses" || undefined,
  };
}

/** Fills what `first` leaves unknown from `second`. */
function merge(first = {}, second = {}) {
  const merged = { ...second };
  for (const [key, value] of Object.entries(first)) {
    if (value !== undefined && value !== null) merged[key] = value;
  }
  // Only true or a number says something; false for these is the default.
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined || merged[key] === null) delete merged[key];
    else if (merged[key] === false && key !== "chat") delete merged[key];
  }
  return merged;
}

const [modelsDevPath, litellmPath] = process.argv.slice(2);
const modelsDev = await load(modelsDevPath, MODELS_DEV);
const litellm = await load(litellmPath, LITELLM);

const catalog = {};
for (const [id, source] of Object.entries(PROVIDERS)) {
  const fromLite = {};
  for (const [key, model] of Object.entries(litellm)) {
    if (model?.litellm_provider !== source.litellm) continue;
    if (source.prefix && !key.startsWith(source.prefix)) continue;
    fromLite[key.slice(source.prefix.length)] = fromLitellm(model);
  }
  const fromDev = {};
  for (const [key, model] of Object.entries(modelsDev[source.modelsDev]?.models ?? {})) {
    if (model.status === "deprecated") continue;
    fromDev[key] = fromModelsDev(model);
  }

  const models = {};
  for (const key of [...new Set([...Object.keys(fromDev), ...Object.keys(fromLite)])].sort()) {
    const model = merge(fromDev[key], fromLite[key]);
    if (Object.keys(model).length > 0) models[key] = model;
  }
  catalog[id] = models;
}

await writeFile(OUT, `${JSON.stringify(catalog, null, 0)}\n`);
const counts = Object.entries(catalog).map(([id, models]) => `${id} ${Object.keys(models).length}`);
console.log(`Wrote ${OUT.pathname}: ${counts.join(", ")}`);
