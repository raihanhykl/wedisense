// Phase 17 v2 / spec §2.3 — AI-backed Odoo PO PDF parser.
//
// We extract text with pdf-parse, then ship it to OpenRouter (via the
// OpenAI Node SDK with a swapped baseURL) for structured extraction.
// OpenRouter handles cross-provider fallback automatically when the
// `models[]` parameter is set — the primary tier is Anthropic Claude
// Haiku 4.5; if that fails the request transparently falls through to
// GPT-4o-mini and then Gemini 2.5 Flash. Caller sees `servedBy` in
// the response so the UI can show which model actually answered.
//
// Why OpenRouter + json_schema (vs Anthropic SDK + tool_use):
//   - One API key + one billing account
//   - One-line model swap (no SDK swap when switching providers)
//   - json_schema strict mode is auto-normalised cross-provider by
//     OpenRouter; with tool_use we'd need an explicit
//     "structured-outputs-2025-11-13" header per the May 2026 docs
//
// Verified against OpenRouter docs + openai-node @6.39.0 (May 2026).

import OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import { PDFParse } from 'pdf-parse';
import type { ParsedOdooPo } from './odoo-pdf-parser.js';

// ── Fallback chain (May 2026 model slugs) ──────────────────────────────────
//
// Free-tier chain — all three slugs verified live against
// https://openrouter.ai/api/v1/models and confirmed to support
// `response_format` + `structured_outputs`. Quality-first ordering:
// Gemma 31B dense first (best instruction following on multilingual
// ID/EN text), Gemma 26B MoE next (faster, similar quality), then
// Nvidia Nemotron Super as last-resort.
//
// Free slugs churn: providers delist them without notice (e.g.
// baidu/cobuddy:free vanished in June 2026 → "404 No endpoints
// found"). When that error appears, re-verify the chain against the
// registry:
//   curl -s https://openrouter.ai/api/v1/models | \
//     jq '.data[] | select(.id | endswith(":free")) | .id'
//
// ── To switch to PAID models ─────────────────────────────────────────────
// 1. Top up your OpenRouter account at https://openrouter.ai (min $5).
// 2. Replace the slugs below — quality-first paid chain:
//      'anthropic/claude-haiku-4.5'   // best procurement accuracy
//      'openai/gpt-4o-mini'           // ~10× cheaper, similar quality
//      'google/gemini-2.5-flash'      // ultra-cheap last resort
// 3. (Optional but recommended) switch the request body in
//    `parsePdfWithAi` from `response_format: { type: 'json_object' }`
//    back to strict json_schema mode for better field-level reliability:
//      response_format: { type: 'json_schema', json_schema: PARSED_PO_SCHEMA }
//    Paid endpoints support strict mode; drop the SCHEMA_HINT
//    concatenation in the system prompt since the schema is now
//    enforced server-side.
// 4. No restart needed beyond redeploy of the API process — the OpenAI
//    client is lazy-init and picks up the new chain on the next call.
const FALLBACK_CHAIN = [
  'google/gemma-4-31b-it:free', // primary: 262K ctx, multilingual, strong struct output
  'meta-llama/llama-4-maverick:free', // fallback 1: MoE sibling, faster
  'nvidia/nemotron-3-super-120b-a12b:free', // fallback 2: 1M ctx, last-resort
] as const;

// ── JSON Schema for structured output ──────────────────────────────────────
//
// Mirrors ParsedOdooPo (the regex parser's output shape) so callers
// can treat AI / regex responses interchangeably. `additionalProperties: false`
// + `required: [...]` everywhere makes OpenRouter strict-mode reliable:
// the model must emit exactly this shape, no hallucinated keys.
//
// Note: we use `type: ['string', 'null']` rather than `nullable: true`
// because OpenAI/OpenRouter's strict schema validator follows the
// 2020-12 JSON Schema spec — `nullable` is OpenAPI 3.0, not JSON Schema.
const PARSED_PO_SCHEMA = {
  name: 'parsed_purchase_order',
  description: 'Structured data extracted from an Odoo Purchase Order PDF',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      poNumber: {
        type: ['string', 'null'],
        description: 'PO identifier, e.g. PO/2026/04/00057',
      },
      vendor: {
        type: ['string', 'null'],
        description:
          'Vendor / supplier company name. Distinct from the Wedison-side shipping recipient.',
      },
      buyer: {
        type: ['string', 'null'],
        description: 'Buyer (Wedison-side staff name) shown under the Buyer label',
      },
      orderDate: {
        type: ['string', 'null'],
        description: 'ISO date yyyy-mm-dd. Odoo default print is MM/DD/YYYY — normalise.',
      },
      expectedArrival: {
        type: ['string', 'null'],
        description: 'ISO date yyyy-mm-dd',
      },
      currency: {
        type: ['string', 'null'],
        description: '3-letter ISO 4217 code (IDR/USD/SGD/EUR/JPY). "Rp" symbol → "IDR".',
      },
      items: {
        type: 'array',
        description: 'PO line items. Multi-line descriptions should be merged.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            description: { type: 'string' },
            qty: { type: ['number', 'null'] },
            unitPrice: { type: ['number', 'null'] },
            discountPercent: {
              type: ['number', 'null'],
              description: '0..100. If column blank, return 0.',
            },
            taxPercent: {
              type: ['number', 'null'],
              description: '0..100. If column blank, return 0.',
            },
            amount: { type: ['number', 'null'] },
          },
          required: ['description', 'qty', 'unitPrice', 'discountPercent', 'taxPercent', 'amount'],
        },
      },
      untaxedAmount: { type: ['number', 'null'] },
      totalTaxes: {
        type: ['number', 'null'],
        description: 'If tax line absent, return 0',
      },
      totalAmount: { type: ['number', 'null'] },
      unparsedFields: {
        type: 'array',
        description: 'Names of fields you could NOT confidently extract',
        items: { type: 'string' },
      },
    },
    required: [
      'poNumber',
      'vendor',
      'buyer',
      'orderDate',
      'expectedArrival',
      'currency',
      'items',
      'untaxedAmount',
      'totalTaxes',
      'totalAmount',
      'unparsedFields',
    ],
  },
} as const;

const SYSTEM_PROMPT = `You extract structured data from Odoo Purchase Order PDFs for an Indonesian asset-management system (Wedison).

Rules:
- Vendor: the supplier company name (e.g. "Shopee"). NOT the shipping recipient (which is always Wedison).
- Buyer: the staff name printed under the "Buyer" label.
- Dates: convert to ISO yyyy-mm-dd. Odoo prints MM/DD/YYYY by default.
- Currency: return the ISO 4217 code. "Rp" symbol means IDR.
- Items: each PO line. Merge multi-line descriptions (Odoo wraps long product names). When a column (discount / tax) is blank, return 0.
- amounts: numeric values, no currency symbol. "Rp 3,255,600.00" → 3255600.
- Set fields you can't confidently extract to null AND list their key in unparsedFields.
- Never invent values. If unclear, prefer null + flag in unparsedFields.`;

// Inline schema description for `json_object` mode (free-tier providers
// don't all support strict json_schema — see parsePdfWithAi for why).
// We embed the exact shape as plain text in the system prompt so the
// model still knows which keys to emit. Generated from PARSED_PO_SCHEMA
// at module load so the two stay in lockstep.
const SCHEMA_HINT = `Return ONLY a single JSON object — no markdown fences, no commentary — matching exactly this shape:
${JSON.stringify(PARSED_PO_SCHEMA.schema, null, 2)}`;

// ── Client (lazy-init so the module loads cleanly without API key) ────────

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env['OPENROUTER_API_KEY'];
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set. Add it to apps/api/.env or use mode=regex.');
  }
  _client = new OpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      // App-attribution headers — populate the OpenRouter dashboard
      // and rankings page. Optional; failure to send them doesn't
      // affect routing.
      'HTTP-Referer': process.env['APP_BASE_URL'] ?? 'https://wedison.local',
      'X-Title': 'Wedison AMS',
    },
  });
  return _client;
}

// ── Helper: extract text from PDF (shared with regex parser) ──────────────

async function extractText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text ?? '';
  } finally {
    await parser.destroy();
  }
}

// ── Public entry ──────────────────────────────────────────────────────────

export interface AiParsedOdooPo extends ParsedOdooPo {
  /** Which OpenRouter-resolved model actually served the request.
   *  Useful for the UI to show "Served by anthropic/claude-haiku-4.5". */
  servedBy: string;
}

export async function parsePdfWithAi(buffer: Buffer): Promise<AiParsedOdooPo> {
  const text = await extractText(buffer);
  const client = getClient();

  // Why `json_object` (not `json_schema` strict mode):
  //
  // The free-tier endpoints serving our fallback chain are hosted by
  // third-party providers (Chutes, Targon, …) that don't all implement
  // strict json_schema validation, even though the base model advertises
  // `structured_outputs: true` in the OpenRouter registry. Combining
  // strict mode with `provider.require_parameters: true` returns
  // `404 No endpoints found that can handle the requested parameters`.
  //
  // The pragmatic fix: ask for `json_object` (universally supported),
  // describe the exact schema in the system prompt, and JSON.parse +
  // validate-light on the response. Paid endpoints (claude-haiku-4.5,
  // gpt-4o-mini) DO support strict mode — swap back to `json_schema`
  // when migrating the fallback chain to those.
  //
  // Why we iterate FALLBACK_CHAIN manually (no `models[]` extension):
  //
  // OpenRouter's auto-fallback via the `models[]` array only triggers
  // on 5xx and certain 4xx errors — NOT on 429 rate limits, which are
  // exactly what bites on free tier. So we drive the fallback ourselves:
  // try model[i], on 429 (or any error) try model[i+1], and surface
  // the last error if everything fails.
  //
  // `provider.sort: 'throughput'` asks OpenRouter to route each model
  // to its least-congested provider — reduces the chance of hitting
  // 429 for a model whose primary host is currently swamped.
  const failures: string[] = [];
  for (const model of FALLBACK_CHAIN) {
    const body: ChatCompletionCreateParamsNonStreaming & {
      provider: { sort: string };
    } = {
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT + '\n\n' + SCHEMA_HINT },
        { role: 'user', content: text },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
      provider: { sort: 'throughput' },
    };

    try {
      const response = await client.chat.completions.create(
        body as ChatCompletionCreateParamsNonStreaming,
      );

      const message = response.choices[0]?.message;
      const content = message?.content;
      if (typeof content !== 'string' || !content) {
        throw new Error('OpenRouter returned an empty response');
      }

      let parsed: ParsedOdooPo;
      try {
        parsed = JSON.parse(content) as ParsedOdooPo;
      } catch (err) {
        throw new Error(`OpenRouter response was not valid JSON: ${(err as Error).message}`);
      }

      return {
        ...parsed,
        // pdf-parse text isn't useful to the client (already shaped into
        // fields); set to empty string for type compat with ParsedOdooPo.
        rawText: '',
        servedBy: response.model ?? model,
      };
    } catch (err) {
      failures.push(`[${model}] ${err instanceof Error ? err.message : String(err)}`);
      // Continue to the next model in the chain. Any error class —
      // 429 rate limit, 503 provider down, JSON parse failure — gets
      // the same treatment: try the next one.
    }
  }

  // Every model in the chain failed. Surface ALL per-model errors —
  // showing only the last one hides the real cause (e.g. a delisted
  // last-resort slug 404ing masks the primary's 429 rate limit).
  throw new Error(`every model in the fallback chain failed: ${failures.join('; ')}`);
}
