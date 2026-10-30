import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Tabs } from '../../src/ui';
import styles from '../../src/ui/ui.module.css';
import { declarationsOf, parseCssBlocks } from '../support/css-blocks';

const css = parseCssBlocks(readFileSync(resolve(import.meta.dirname, '../../src/ui/ui.module.css'), 'utf8'));
const rule = (selector: string, media: string | null = null) => declarationsOf(css, selector, media);
const px = (value: string | undefined) => Number.parseFloat(value ?? '');

const TABS = [
  { id: 'how', label: 'Comment faire' },
  { id: 'mistakes', label: 'Erreurs' },
  { id: 'variants', label: 'Variantes' },
];

/** Onglets contrôlés par un parent qui accepte chaque changement, comme la fiche d'exercice. */
function Sheet(p: { initial?: string; onChange?(id: string): void }) {
  const [value, setValue] = useState(p.initial ?? 'how');
  return (
    <Tabs
      label="Fiche de l'exercice"
      tabs={TABS}
      value={value}
      onChange={(id) => {
        p.onChange?.(id);
        setValue(id);
      }}
    >
      {(id) => <p>{`Contenu de ${id}`}</p>}
    </Tabs>
  );
}

const tab = (name: string) => screen.getByRole('tab', { name });

describe('Tabs (motif d’onglets de l’ARIA APG)', () => {
  it('liste nommée ; onglet actif aria-selected et seul focalisable (tabIndex 0, les autres -1)', () => {
    render(<Sheet initial="mistakes" />);
    const list = screen.getByRole('tablist', { name: "Fiche de l'exercice" });
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Comment faire',
      'Erreurs',
      'Variantes',
    ]);
    for (const t of screen.getAllByRole('tab')) {
      expect(list.contains(t)).toBe(true);
      expect(t.tagName).toBe('BUTTON');
      expect(t.getAttribute('type')).toBe('button');
    }
    expect(tab('Erreurs').getAttribute('aria-selected')).toBe('true');
    expect(tab('Erreurs').tabIndex).toBe(0);
    for (const name of ['Comment faire', 'Variantes']) {
      expect(tab(name).getAttribute('aria-selected')).toBe('false');
      expect(tab(name).tabIndex).toBe(-1);
    }
  });

  it('aria-controls : chaque onglet désigne son panneau ; seul celui de l’onglet actif est visible', () => {
    const { container } = render(<Sheet />);
    for (const t of screen.getAllByRole('tab')) {
      const id = t.getAttribute('aria-controls') ?? '';
      const panel = container.querySelector(`[id="${id}"]`);
      expect(panel?.getAttribute('role'), t.textContent ?? '').toBe('tabpanel');
      expect(panel?.getAttribute('aria-labelledby')).toBe(t.id);
      expect(panel?.hasAttribute('hidden')).toBe(t.getAttribute('aria-selected') !== 'true');
    }
    const ids = screen.getAllByRole('tab').map((t) => t.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('panneau : nommé par son onglet, focalisable, rend children(id) de l’onglet actif seulement', () => {
    const children = vi.fn((id: string) => <p>{`Contenu de ${id}`}</p>);
    render(
      <Tabs label="Fiche" tabs={TABS} value="variants" onChange={() => {}}>
        {children}
      </Tabs>,
    );
    const panel = screen.getByRole('tabpanel', { name: 'Variantes' });
    expect(panel.tabIndex).toBe(0);
    expect(panel.textContent).toBe('Contenu de variants');
    expect(tab('Variantes').getAttribute('aria-controls')).toBe(panel.id);
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(new Set(children.mock.calls.map(([id]) => id))).toEqual(new Set(['variants']));
  });

  it('flèche droite : onglet suivant, focalisé et choisi ; du dernier, retour au premier', () => {
    const onChange = vi.fn();
    render(<Sheet onChange={onChange} />);
    fireEvent.keyDown(tab('Comment faire'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('mistakes');
    expect(document.activeElement).toBe(tab('Erreurs'));
    expect(tab('Erreurs').getAttribute('aria-selected')).toBe('true');
    expect(tab('Erreurs').tabIndex).toBe(0);
    expect(tab('Comment faire').tabIndex).toBe(-1);
    expect(screen.getByRole('tabpanel', { name: 'Erreurs' }).textContent).toBe('Contenu de mistakes');

    fireEvent.keyDown(tab('Erreurs'), { key: 'ArrowRight' });
    fireEvent.keyDown(tab('Variantes'), { key: 'ArrowRight' });
    expect(onChange.mock.calls.map(([id]) => id)).toEqual(['mistakes', 'variants', 'how']);
    expect(document.activeElement).toBe(tab('Comment faire'));
    expect(tab('Comment faire').getAttribute('aria-selected')).toBe('true');
  });

  it('flèche gauche : onglet précédent ; du premier, le dernier', () => {
    const onChange = vi.fn();
    render(<Sheet onChange={onChange} />);
    fireEvent.keyDown(tab('Comment faire'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tab('Variantes'));
    expect(tab('Variantes').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tab('Variantes'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tab('Erreurs'));
    expect(onChange.mock.calls.map(([id]) => id)).toEqual(['variants', 'mistakes']);
  });

  it('Début et Fin : premier et dernier onglet', () => {
    render(<Sheet initial="mistakes" />);
    fireEvent.keyDown(tab('Erreurs'), { key: 'End' });
    expect(document.activeElement).toBe(tab('Variantes'));
    expect(tab('Variantes').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tab('Variantes'), { key: 'Home' });
    expect(document.activeElement).toBe(tab('Comment faire'));
    expect(tab('Comment faire').getAttribute('aria-selected')).toBe('true');
  });

  it('les touches gérées ne font pas défiler la page ; les autres ne changent rien', () => {
    const onChange = vi.fn();
    render(<Sheet onChange={onChange} />);
    const handled = fireEvent.keyDown(tab('Comment faire'), { key: 'End' });
    expect(handled).toBe(false); // preventDefault : pas de défilement jusqu'en bas de la page
    for (const key of ['ArrowDown', 'ArrowUp', 'Tab', 'a', 'Enter']) {
      expect(fireEvent.keyDown(tab('Variantes'), { key }), key).toBe(true);
    }
    expect(onChange.mock.calls.map(([id]) => id)).toEqual(['variants']);
  });

  it('clic : onChange avec l’id ; clic sur l’onglet déjà actif : rien', () => {
    const onChange = vi.fn();
    render(<Sheet onChange={onChange} />);
    fireEvent.click(tab('Comment faire'));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(tab('Variantes'));
    expect(onChange).toHaveBeenCalledWith('variants');
    expect(tab('Variantes').getAttribute('aria-selected')).toBe('true');
  });

  it('contrôlé : un parent qui refuse le changement garde l’onglet actif', () => {
    const onChange = vi.fn();
    render(
      <Tabs label="Fiche" tabs={TABS} value="how" onChange={onChange}>
        {(id) => id}
      </Tabs>,
    );
    fireEvent.keyDown(tab('Comment faire'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('mistakes');
    expect(tab('Comment faire').getAttribute('aria-selected')).toBe('true');
    expect(tab('Erreurs').getAttribute('aria-selected')).toBe('false');
  });

  it('valeur inconnue : le premier onglet est actif, la liste reste atteignable au clavier', () => {
    const children = vi.fn((id: string) => id);
    render(
      <Tabs label="Fiche" tabs={TABS} value="inconnu" onChange={() => {}}>
        {children}
      </Tabs>,
    );
    expect(tab('Comment faire').getAttribute('aria-selected')).toBe('true');
    expect(tab('Comment faire').tabIndex).toBe(0);
    expect(children).toHaveBeenLastCalledWith('how');
  });

  it('cibles d’au moins 44 × 44 px ; actif marqué autrement que par la couleur (graisse et trait)', () => {
    render(<Sheet />);
    expect(tab('Comment faire').classList.contains(styles.tab ?? 'absente')).toBe(true);
    expect(screen.getByRole('tabpanel').classList.contains(styles.tabPanel ?? 'absente')).toBe(true);
    expect(px(rule('.tab')?.get('min-height'))).toBeGreaterThanOrEqual(44);
    expect(px(rule('.tab')?.get('min-width'))).toBeGreaterThanOrEqual(44);
    expect(Number(rule('.tab[aria-selected="true"]')?.get('font-weight'))).toBeGreaterThan(
      Number(rule('.tab')?.get('font-weight')),
    );
    const mark = rule('.tab[aria-selected="true"]::after');
    expect(px(mark?.get('height'))).toBeGreaterThanOrEqual(3);
    // Couleurs forcées : le trait reste dessiné, en couleur système.
    expect(rule('.tab[aria-selected="true"]::after', '(forced-colors: active)')?.get('background')).toBe(
      'Highlight',
    );
  });

  it('contrastes : seulement des jetons dont les paires sont vérifiées dans les 5 thèmes (contrast.test)', () => {
    // --text-muted et --text sur --bg et --surface : texte courant, 4,5:1 ; --accent sur les mêmes fonds : 4,5:1.
    expect(rule('.tab')?.get('color')).toBe('var(--text-muted)');
    expect(rule('.tab')?.get('background')).toBe('transparent');
    expect(rule('.tab[aria-selected="true"]')?.get('color')).toBe('var(--text)');
    expect(rule('.tab[aria-selected="true"]::after')?.get('background')).toBe('var(--accent)');
  });
});
