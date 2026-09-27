/**
 * Optional: lets Claude read the search request when ANTHROPIC_API_KEY is set.
 * Returns the same shape as parseRules(), or null so the caller falls back to
 * the rule parser — a missing key, a timeout or a refusal never breaks search.
 */
import { config } from '../config.js';
import { CATEGORY_WORDS } from './assistant.js';
import { allLocations } from './geo.js';

let clientPromise = null;
const getClient = () => {
  if (!config.anthropic.apiKey) return null;
  clientPromise ||= import('@anthropic-ai/sdk').then(({ default: Anthropic }) =>
    new Anthropic({ apiKey: config.anthropic.apiKey, timeout: 12_000, maxRetries: 1 }));
  return clientPromise;
};

export const llmEnabled = () => Boolean(config.anthropic.apiKey);

const nullable = (type, extra = {}) => ({ type: [type, 'null'], ...extra });

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'filters', 'fields', 'navigate', 'serviceName'],
  properties: {
    intent: { type: 'string', enum: ['search', 'filter', 'availability', 'subscribe', 'fill', 'navigate', 'clear'] },
    navigate: nullable('string', { enum: ['subscriptions', 'cards', 'payments', 'usage', 'coupons', 'profile', 'settings', 'dashboard', null] }),
    serviceName: nullable('string'),
    filters: {
      type: 'object',
      additionalProperties: false,
      required: ['q', 'category', 'minPrice', 'maxPrice', 'nearMe', 'distance', 'area', 'days', 'duration', 'offers', 'type', 'sort', 'minSubscribers'],
      properties: {
        q: nullable('string'),
        category: nullable('string'),
        minPrice: nullable('number'),
        maxPrice: nullable('number'),
        nearMe: { type: 'boolean' },
        distance: nullable('number'),
        area: nullable('string'),
        days: { type: 'array', items: { type: 'string', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] } },
        duration: nullable('integer'),
        offers: { type: 'boolean' },
        type: nullable('string', { enum: ['in_person', 'doorstep', 'online', null] }),
        sort: nullable('string', { enum: ['price_asc', 'price_desc', 'popular', 'distance', 'newest', null] }),
        minSubscribers: nullable('integer'),
      },
    },
    fields: {
      type: 'object',
      additionalProperties: false,
      required: ['months', 'couponCode', 'upiTxnId'],
      properties: { months: nullable('integer'), couponCode: nullable('string'), upiTxnId: nullable('string') },
    },
  },
};

// Stable across requests, so it caches.
const SYSTEM = () => `You turn requests to Subtize.ai, a platform for nearby monthly subscription services in India, into structured actions.
Prices are monthly, in rupees. "near me" means nearMe=true with distance 5 unless a distance is given.
Category must be one of these slugs or null: ${Object.keys(CATEGORY_WORDS).join(', ')}.
Area must be one of these known areas or null: ${allLocations().map((l) => l.area).join(', ')}.
intent: search (a new search), filter (narrows the current results without naming a new kind of service), availability (asks when/whether a service is open),
subscribe (wants to start a subscription), fill (gives checkout details: plan length, coupon code, UPI transaction ID), navigate (open a section of their account), clear (reset filters).
serviceName: the specific business named, if any. q: leftover keywords not captured elsewhere, or null.
Transaction IDs are spoken as digit runs; join them without spaces.`;

export async function parseWithClaude(text, context = {}) {
  const client = await getClient();
  if (!client) return null;
  try {
    const response = await client.beta.messages.create({
      model: config.anthropic.model,
      max_tokens: 2000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: [{ type: 'text', text: SYSTEM(), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Page: ${context.page || 'search'}\nRequest: ${String(text).slice(0, 500)}` }],
    });
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
    const block = response.content.find((b) => b.type === 'text');
    if (!block) return null;
    const out = JSON.parse(block.text);

    // Drop nulls so the result merges exactly like the rule parser's output.
    const filters = Object.fromEntries(Object.entries(out.filters).filter(([, v]) => v !== null && v !== false && !(Array.isArray(v) && !v.length)));
    const fields = Object.fromEntries(Object.entries(out.fields).filter(([, v]) => v !== null));
    if (fields.upiTxnId) fields.upiTxnId = fields.upiTxnId.replace(/\s+/g, '').toUpperCase();
    if (fields.couponCode) fields.couponCode = fields.couponCode.toUpperCase();
    if (filters.category && !CATEGORY_WORDS[filters.category]) delete filters.category;
    return {
      intent: out.intent,
      filters,
      fields,
      navigate: out.navigate,
      text: out.serviceName ? `${text} ${out.serviceName}` : text,
      source: 'claude',
    };
  } catch (err) {
    console.warn('[assistant] Claude parse failed, using rules:', err?.status || '', err?.message || err);
    return null;
  }
}
