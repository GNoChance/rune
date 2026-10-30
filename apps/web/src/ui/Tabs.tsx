import { type KeyboardEvent, type ReactNode, useId } from 'react';
import styles from './ui.module.css';

export interface TabItem {
  /** Code court de l'onglet (`how`, `mistakes`…) : rendu à `onChange` et à `children`, repris dans les id du DOM. */
  id: string;
  label: string;
}

/** Index de l'onglet visé par une touche (flèches en boucle, Début, Fin), null pour une autre touche. */
function targetIndex(key: string, index: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * Onglets selon le motif de l'ARIA APG (spec brique 2 §4.2), contrôlés par `value` :
 * - `tablist` nommé par `label` ; chaque onglet est un `<button role="tab">` avec `aria-selected` et `aria-controls`
 *   vers son panneau ; seul l'onglet actif est dans l'ordre de tabulation (`tabIndex` 0, les autres -1) ;
 * - flèches gauche et droite (en boucle), Début et Fin : le focus va sur l'onglet visé, qui est aussitôt choisi
 *   (activation automatique : le contenu est local, il s'affiche sans attente) ;
 * - un panneau `tabpanel` par onglet, nommé par lui ; seul celui de l'onglet actif est visible, focalisable
 *   (`tabIndex` 0) et rempli par `children(id)` avec l'id de l'onglet actif ; les autres restent vides et cachés.
 * Une `value` inconnue rend le premier onglet actif, pour que la liste reste atteignable au clavier. Cibles de 44 px ;
 * l'onglet actif est en gras et souligné d'un trait d'accent, pas seulement coloré.
 */
export function Tabs(p: {
  label: string;
  tabs: readonly TabItem[];
  value: string;
  onChange(id: string): void;
  children(panelId: string): ReactNode;
}) {
  const base = useId();
  const active = p.tabs.some((t) => t.id === p.value) ? p.value : p.tabs[0]?.id;
  const tabId = (id: string) => `${base}-tab-${id}`;
  const panelId = (id: string) => `${base}-panel-${id}`;

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const target = targetIndex(e.key, index, p.tabs.length);
    const tab = target === null ? undefined : p.tabs[target];
    if (!tab) return;
    e.preventDefault();
    e.currentTarget.parentElement?.querySelector<HTMLElement>(`[id="${tabId(tab.id)}"]`)?.focus();
    if (tab.id !== active) p.onChange(tab.id);
  }

  return (
    <div className={styles.tabs}>
      <div role="tablist" aria-label={p.label} className={styles.tabList}>
        {p.tabs.map((t, index) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={tabId(t.id)}
              aria-selected={selected}
              aria-controls={panelId(t.id)}
              tabIndex={selected ? 0 : -1}
              className={styles.tab}
              onClick={() => {
                if (!selected) p.onChange(t.id);
              }}
              onKeyDown={(e) => onKeyDown(e, index)}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {p.tabs.map((t) => {
        const selected = t.id === active;
        // Panneau actif focalisable (ARIA APG) : Tab y mène depuis l'onglet actif, même sans contenu interactif.
        return (
          <div
            key={t.id}
            role="tabpanel"
            id={panelId(t.id)}
            aria-labelledby={tabId(t.id)}
            tabIndex={selected ? 0 : undefined}
            hidden={!selected}
            className={selected ? styles.tabPanel : undefined}
          >
            {selected ? p.children(t.id) : null}
          </div>
        );
      })}
    </div>
  );
}
