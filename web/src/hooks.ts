/** Map Android's physical asset entrypoint onto the existing dashboard route. */
import type { Reroute } from '@sveltejs/kit';
import { isNativeMobile } from '$lib/transport';

/** Keep the URL/query intact; only native client route matching needs this alias. */
export const reroute: Reroute = ({ url }) =>
  isNativeMobile() && url.pathname === '/index.html' ? '/' : url.pathname;
