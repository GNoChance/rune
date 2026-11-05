import { PRIVACY_POLICY_VERSION } from '@rune/contracts';
import { Page } from '../../ui';
import { PRIVACY_SECTIONS } from './privacy-content';
import styles from './public.module.css';
import { usePublicBack } from './use-public-back';

/**
 * Fiche de traitement (03 §13), lisible sans session et hors ligne : la version, puis chaque rubrique en
 * carte, titrée comme les sections d'Aide (A05).
 */
export function PrivacyPage() {
  const back = usePublicBack();
  return (
    <Page title="Confidentialité et règles" back={back}>
      <p className={styles.version}>Version {PRIVACY_POLICY_VERSION}</p>
      {PRIVACY_SECTIONS.map((section) => (
        <section key={section.title} className={styles.section}>
          <h2>{section.title}</h2>
          <ul className={`${styles.card} ${styles.privacyList}`}>
            {section.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {section.table ? (
            <div className={`${styles.card} ${styles.tableWrap}`}>
              <table className={styles.privacyTable}>
                <thead>
                  <tr>
                    {section.table.head.map((cell) => (
                      <th key={cell} scope="col">
                        {cell}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {section.table.rows.map(([need, done]) => (
                    <tr key={need}>
                      <th scope="row">{need}</th>
                      <td>{done}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ))}
    </Page>
  );
}
