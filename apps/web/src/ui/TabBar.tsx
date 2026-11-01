import { type CSSProperties, type ReactNode, type RefObject, useEffect, useRef } from 'react';
import { Link, useLocation } from 'wouter';
import { useActiveSession } from '../repos';
import styles from './shell.module.css';

export type TabHref = '/' | '/exercises' | '/workout' | '/progression' | '/profile';

/**
 * Onglets (spec brique 2 §4.1, brique 3 D1) : Exercices prend la place de Salles, dont les lieux passent dans
 * Profil › Mes lieux ; le bouton central « Séance » s'y ajoute à la brique 3. Sur PC, la navigation latérale
 * le place juste sous Accueil (`SIDE_ITEMS`).
 */
export const TAB_ITEMS: readonly { href: TabHref; label: string }[] = [
  { href: '/', label: 'Accueil' },
  { href: '/exercises', label: 'Exercices' },
  { href: '/workout', label: 'Séance' },
  { href: '/progression', label: 'Progression' },
  { href: '/profile', label: 'Profil' },
];

/** Entrées de la navigation latérale : Séance juste sous Accueil (spec brique 3 D1). */
export const SIDE_ITEMS: typeof TAB_ITEMS = [
  ...TAB_ITEMS.filter((t) => t.href === '/'),
  ...TAB_ITEMS.filter((t) => t.href === '/workout'),
  ...TAB_ITEMS.filter((t) => t.href !== '/' && t.href !== '/workout'),
];

/**
 * Préfixes rangés sous chaque onglet : le catalogue sous Exercices ; la séance et le programme sous Séance ;
 * la progression et l'historique sous Progression ; les lieux et les salles (`/places…` canonique, `/gyms…`),
 * les réglages et l'administration sous Profil.
 */
const SECTIONS: readonly { tab: TabHref; prefixes: readonly string[] }[] = [
  { tab: '/exercises', prefixes: ['/exercises'] },
  { tab: '/workout', prefixes: ['/workout', '/program'] },
  { tab: '/progression', prefixes: ['/progression', '/history'] },
  { tab: '/profile', prefixes: ['/profile', '/places', '/gyms', '/settings', '/rejections', '/admin'] },
];

/**
 * Onglet d'une adresse, par préfixe de chemin (sans tenir compte de la casse ni de la barre finale, comme
 * les routes) : « Accueil » sur `/` exactement, `null` hors des onglets (page inconnue).
 */
export function activeTab(path: string): TabHref | null {
  const p = path.toLowerCase().replace(/\/+$/, '') || '/';
  if (p === '/') return '/';
  for (const { tab, prefixes } of SECTIONS) {
    if (prefixes.some((prefix) => p === prefix || p.startsWith(`${prefix}/`))) return tab;
  }
  return null;
}

function Icon(p: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width="23"
      height="23"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {p.children}
    </svg>
  );
}

/** Icônes des onglets (maquettes MixSombre / MixClair). */
export const TAB_ICONS: Record<TabHref, ReactNode> = {
  '/': (
    <Icon>
      <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
    </Icon>
  ),
  '/exercises': (
    <Icon>
      <path d="M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12" />
    </Icon>
  ),
  '/workout': (
    <Icon>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 9.5v4l2.5 1.5M9.5 2.5h5" />
    </Icon>
  ),
  '/progression': (
    <Icon>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M14 7h7v7" />
    </Icon>
  ),
  '/profile': (
    <Icon>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </Icon>
  ),
};

/**
 * Destination et état du bouton Séance (spec brique 3 §7.1) : la séance en cours de cet appareil s'ouvre
 * directement (`/workout/:id`), sinon la séance du jour (`/workout`). Le point animé et le nom accessible
 * « Séance, en cours » signalent une séance en cours ; une séance tenue par un autre appareil n'en est pas une ici
 * (l'écran `/workout` la propose).
 */
export function useTabLinks(items: typeof TAB_ITEMS) {
  const active = useActiveSession();
  return items.map((t) => {
    const running = t.href === '/workout' && active != null;
    return {
      ...t,
      to: running ? `/workout/${active.id}` : t.href,
      running,
    };
  });
}

/** Point de la séance en cours : décoratif (le nom accessible le dit), fixe sous mouvement réduit. */
function RunningDot(p: { className: string | undefined }) {
  return <span aria-hidden="true" data-running="" className={p.className} />;
}

/** Une entrée de navigation (onglet ou navigation latérale) : le nom dit « en cours » quand c'est le cas. */
export function NavEntry(p: {
  item: { href: TabHref; label: string; to: string; running: boolean };
  current: boolean;
  className: string | undefined;
  dotClassName: string | undefined;
}) {
  const { item } = p;
  return (
    <Link
      href={item.to}
      aria-current={p.current ? 'page' : undefined}
      aria-label={item.running ? `${item.label}, en cours` : undefined}
      className={p.className}
    >
      {TAB_ICONS[item.href]}
      {item.label}
      {item.running ? <RunningDot className={p.dotClassName} /> : null}
    </Link>
  );
}

/**
 * Barre d'onglets flottante en pilule, sur téléphone (maquettes MixSombre / MixClair) : l'onglet actif porte
 * `aria-current="page"` et la pastille glisse jusqu'à lui ; sans onglet actif, elle se cache.
 */
export function TabBar() {
  const [path] = useLocation();
  const active = activeTab(path);
  const index = TAB_ITEMS.findIndex((t) => t.href === active);
  const bar = useRef<HTMLElement>(null);
  const links = useTabLinks(TAB_ITEMS);
  useFocusAboveBar(bar);
  return (
    <nav ref={bar} aria-label="Navigation principale" data-testid="tab-bar" className={styles.tabBar}>
      <span
        aria-hidden="true"
        data-tab-pill=""
        data-index={index < 0 ? undefined : String(index)}
        hidden={index < 0}
        className={styles.tabPill}
        style={{ '--tab-index': Math.max(index, 0) } as CSSProperties}
      />
      {links.map((t) => (
        <NavEntry
          key={t.href}
          item={t}
          current={t.href === active}
          className={styles.tab}
          dotClassName={styles.runningDot}
        />
      ))}
    </nav>
  );
}

/**
 * Le focus ne finit jamais sous la barre (WCAG 2.2, 2.4.11). Tabulation et Chromium s'arrêtent déjà au-dessus
 * grâce à scroll-padding-bottom (shell.module.css), mais WebKit l'ignore pour focus() (retour au bouton
 * d'origine, champ en erreur) : quand la barre recouvre le centre du contrôle qui prend le focus, il défile au
 * plus près, ce qui respecte la marge. Une feuille du bas posée par-dessus prend le point : rien ne bouge.
 * Aussi pour la barre collée de l'onboarding (StepActions).
 */
export function useFocusAboveBar(bar: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const onFocus = (event: FocusEvent) => {
      const nav = bar.current;
      const target = event.target;
      if (!nav || !(target instanceof Element) || nav.contains(target)) return;
      const box = target.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      if (hit && nav.contains(hit)) target.scrollIntoView({ block: 'nearest' });
    };
    document.addEventListener('focusin', onFocus);
    return () => document.removeEventListener('focusin', onFocus);
  }, [bar]);
}
