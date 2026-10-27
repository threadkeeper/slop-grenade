import type { M365App } from './types';

const FILTERABLE_SOURCES = new Set<M365App>(['teams', 'outlook', 'gmail']);

/** Build an overlay source predicate from the trusted shell's query string. */
export function overlaySourceEnabled(search: string, app: M365App): boolean {
  const params = new URLSearchParams(search);
  if (!params.has('sources') || !FILTERABLE_SOURCES.has(app)) return true;
  return new Set(params.get('sources')?.split(',').filter(Boolean) ?? []).has(app);
}
