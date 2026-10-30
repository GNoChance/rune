import type { ReactNode } from 'react';
import styles from './public.module.css';

/** Pictogramme au trait sur une grille de 24, décoratif (le nom vient du texte qui l'accompagne). */
export function Glyph(p: { size: number; children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width={p.size}
      height={p.size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {p.children}
    </svg>
  );
}

/**
 * Lien vers un site extérieur, ouvert dans un nouvel onglet : le texte, le pictogramme « sortie », puis, pour
 * les lecteurs d'écran seulement, « (nouvel onglet) », précédé de `context` quand le texte se répète (« Source
 * (Squat goblet : position de départ, nouvel onglet) »). Le nom lu commence toujours par le texte affiché.
 */
export function ExternalLink(p: { href: string; children: ReactNode; context?: string }) {
  return (
    <a href={p.href} target="_blank" rel="noreferrer" className={styles.source}>
      {p.children}
      <Glyph size={14}>
        <path d="M14 4h6v6" />
        <path d="M20 4 11 13" />
        <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
      </Glyph>
      <span className={styles.srOnly}>
        {p.context ? ` (${p.context}, nouvel onglet)` : ' (nouvel onglet)'}
      </span>
    </a>
  );
}
