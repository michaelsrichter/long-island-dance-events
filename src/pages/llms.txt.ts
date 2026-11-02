import type { APIRoute } from 'astro';
import { llmsSummary } from '../lib/llms';

/** Navigation aid for AI assistants (llmstxt.org). Facts only; no private or speculative content. */
export const GET: APIRoute = async ({ site }) => new Response(await llmsSummary(site!), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });