import type { MemberSummary } from '@rune/contracts';
import { logSecurityEvent } from '../auth/security-log';
import { writeStamp } from '../db/rev';
import type { DbExecutor } from '../db/schema';
import type { AppDeps } from '../deps';
import { httpError } from '../http/errors';
import { memberSummary } from './members';

type AdminActor = { actorId: string; ip: string | null };

export interface ReviewerFlags {
  catalogReviewer: boolean;
  healthProfessional: boolean;
}

/**
 * Écrit les drapeaux de relecteur d'un membre (spec brique 2 §3.1) et rend son `MemberSummary`. Le mot de passe
 * de l'admin (P-AUT-5) est vérifié avant, hors transaction (la route).
 * - L'admin ne coche jamais `health_professional` sur son propre compte (`self_health_flag`), quelle que soit la
 *   valeur en base : il peut seulement l'y décocher. Sur un autre admin, le drapeau est accepté mais sans effet
 *   (`isHealthReviewer` exige le rôle `member`).
 * - Valeurs inchangées : ni écriture ni journal. Sinon, nouveau rev (le compte suit dans son propre pull) et
 *   `reviewer_flags_changed` avec les valeurs avant et après.
 */
export async function setReviewerFlags(
  trx: DbExecutor,
  deps: AppDeps,
  actor: AdminActor,
  targetId: string,
  flags: ReviewerFlags,
): Promise<MemberSummary> {
  if (targetId === actor.actorId && flags.healthProfessional) throw httpError('self_health_flag');
  const target = await trx
    .selectFrom('user')
    .select(['catalogReviewer', 'healthProfessional'])
    .where('id', '=', targetId)
    .executeTakeFirst();
  if (!target) throw httpError('not_found');
  const before: ReviewerFlags = {
    catalogReviewer: target.catalogReviewer === 1,
    healthProfessional: target.healthProfessional === 1,
  };
  const changed =
    before.catalogReviewer !== flags.catalogReviewer ||
    before.healthProfessional !== flags.healthProfessional;
  if (changed) {
    const stamp = await writeStamp(trx, deps, actor.actorId);
    await trx
      .updateTable('user')
      .set({
        catalogReviewer: flags.catalogReviewer ? 1 : 0,
        healthProfessional: flags.healthProfessional ? 1 : 0,
        ...stamp,
      })
      .where('id', '=', targetId)
      .execute();
    await logSecurityEvent(trx, deps, {
      type: 'reviewer_flags_changed',
      actorId: actor.actorId,
      targetId,
      ip: actor.ip,
      outcome: 'success',
      details: {
        catalogReviewerBefore: before.catalogReviewer,
        catalogReviewerAfter: flags.catalogReviewer,
        healthProfessionalBefore: before.healthProfessional,
        healthProfessionalAfter: flags.healthProfessional,
      },
    });
  }
  return memberSummary(trx, deps, targetId);
}
