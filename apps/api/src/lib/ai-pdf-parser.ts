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
// Quality-first ordering per user preference. The first model to
// succeed wins; if all fail, OpenRouter surfaces the last error in
// standard OpenAI APIError shape.
const FALLBACK_CHAIN = [
  'anthropic/claude-haiku-4.5',   // primary: best accuracy for procurement
  'openai/gpt-4o-mini',            // fallback 1: ~10× cheaper, similar quality
  'google/gemini-2.5-flash',       // fallback 2: ultra-cheap, current Google fast tier
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
        description: 'PO identifier, e.g. PO/2026/04/00057 or SP-2026-0001',
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
          required: [
            'description',
            'qty',
            'unitPrice',
            'discountPercent',
            'taxPercent',
            'amount',
          ],
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

// ── Client (lazy-init so the module loads cleanly without API key) ────────

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env['OPENROUTER_API_KEY'];
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is not set. Add it to apps/api/.env or use mode=regex.',
    );
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

  // OpenRouter accepts the standard OpenAI body shape plus a few
  // extensions: `models` (auto-fallback chain) and `provider`
  // (provider routing rules). The OpenAI Node SDK's TypeScript types
  // are strict about unknown fields, so we build the body object as
  // a typed base + an extension intersection, then assert through.
  // The fields are passed verbatim to the OpenRouter endpoint — there
  // is no runtime stripping done by the SDK.
  const body: ChatCompletionCreateParamsNonStreaming & {
    models: readonly string[];
    provider: { require_parameters: boolean };
  } = {
    model: FALLBACK_CHAIN[0],
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: PARSED_PO_SCHEMA,
    },
    temperature: 0,
    models: FALLBACK_CHAIN,
    provider: { require_parameters: true },
  };

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
    throw new Error(
      `OpenRouter response was not valid JSON: ${(err as Error).message}`,
    );
  }

  return {
    ...parsed,
    // pdf-parse text isn't useful to the client (already shaped into
    // fields); set to empty string for type compat with ParsedOdooPo.
    rawText: '',
    servedBy: response.model ?? FALLBACK_CHAIN[0],
  };
}
