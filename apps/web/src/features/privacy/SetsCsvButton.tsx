import { useServices } from '../../app-services';
import { useRepos } from '../../repos';
import { Banner, Button, downloadCsv, setsCsvFileName, useAction } from '../../ui';
import styles from './privacy.module.css';

/**
 * « Télécharger mes séries (CSV) » (spec brique 3 §5.6, §7.12) : les séries faites, une ligne par série, lues sur
 * le serveur (réseau nécessaire) et enregistrées sous `rune-series-AAAA-MM-JJ.csv`, ouvrables dans un tableur.
 */
export function SetsCsvButton() {
  const repos = useRepos();
  const { now } = useServices();
  const exporting = useAction(async () => {
    downloadCsv(setsCsvFileName(now()), await repos.me.exportSetsCsv());
  });
  return (
    <div className={styles.export}>
      <Button variant="secondary" disabled={exporting.pending} onClick={() => void exporting.run()}>
        Télécharger mes séries (CSV)
      </Button>
      {exporting.error ? <Banner tone="error">{exporting.error}</Banner> : null}
    </div>
  );
}
