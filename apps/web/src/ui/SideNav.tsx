import { Link, useLocation } from 'wouter';
import { RuneMark, RuneWordmark } from './Logo';
import styles from './shell.module.css';
import { activeTab, NavEntry, SIDE_ITEMS, useTabLinks } from './TabBar';
import { useColorScheme } from './use-color-scheme';

/**
 * Navigation latérale sur PC (largeur ≥ 900 px, spec refonte §5) : la marque, puis les mêmes entrées que la
 * barre d'onglets, l'entrée active portant `aria-current="page"`.
 */
export function SideNav() {
  const [path] = useLocation();
  const active = activeTab(path);
  const links = useTabLinks(SIDE_ITEMS);
  const dark = useColorScheme() === 'dark';
  return (
    <div className={styles.sideNav} data-testid="side-nav">
      <Link href="/" className={styles.brand} aria-label="Rune">
        <RuneMark glow={dark} />
        <RuneWordmark />
      </Link>
      <nav aria-label="Navigation principale">
        <ul className={styles.sideList}>
          {links.map((t) => (
            <li key={t.href}>
              <NavEntry
                item={t}
                current={t.href === active}
                className={styles.sideItem}
                dotClassName={styles.sideRunningDot}
              />
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
