import type { APIRoute } from 'astro';
import { llmsFull } from '../lib/llms';

/** Every upcoming event as one line of plain text, grouped by day (for AI assistants). */
export const GET: APIRoute = async ({ site }) => new Response(await llmsFull(site!), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });