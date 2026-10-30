import type { Hono } from 'hono';
import type { AppEnv } from '../../src/app-env';

export interface Route {
  method: string;
  path: string;
}

/** Routes enregistrées dans l'appli, une fois chacune (les middlewares `ALL` sont écartés). */
export function listRoutes(app: Hono<AppEnv>): Route[] {
  const seen = new Set<string>();
  const out: Route[] = [];
  for (const r of app.routes) {
    if (r.method === 'ALL') continue;
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ method: r.method, path: r.path });
  }
  return out;
}

/** `:id` reçoit l'identifiant donné, tout autre paramètre reçoit « x ». */
export const fillPath = (path: string, id: string): string =>
  path.replace(/:([A-Za-z]+)(\{[^}]*\})?/g, (_m, name: string) => (name === 'id' ? id : 'x'));
