import type { ConsentState, ConsentStatus, ConsentType } from '@rune/contracts';
import { writeStamp } from '../db/rev';
import type { DbExecutor } from '../db/schema';
import type { AppDeps } from '../deps';

const INACTIVE: ConsentStatus = { active: false, textVersion: null, at: null };

async function latestEvent(db: DbExecutor, userId: string, type: ConsentType): Promise<ConsentStatus> {
  const row = await db
    .selectFrom('consentEvent')
    .select(['action', 'textVersion', 'createdAt'])
    .where('ownerId', '=', userId)
    .where('type', '=', type)
    .orderBy('createdAt', 'desc')
    .orderBy('rev', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!row) return { ...INACTIVE };
  return { active: row.action === 'grant', textVersion: row.textVersion, at: row.createdAt };
}

/** R-CST-1 : le dernier événement de chaque type fait foi (created_at, puis rev). */
export async function getConsentState(db: DbExecutor, userId: string): Promise<ConsentState> {
  return {
    health: await latestEvent(db, userId, 'health'),
    aiCoach: await latestEvent(db, userId, 'ai_coach'),
  };
}

export async function isConsentActive(db: DbExecutor, userId: string, type: ConsentType): Promise<boolean> {
  return (await latestEvent(db, userId, type)).active;
}

export async function isHealthConsentActive(db: DbExecutor, userId: string): Promise<boolean> {
  return isConsentActive(db, userId, 'health');
}

/**
 * Événement d'accord ou de retrait, rev neuf. Ici et non dans `consent.ts` : le retrait de l'accord coach
 * (`coach/consent.ts`) l'écrit aussi, et `consent.ts` importe `coach/consent.ts` (crochet du retrait santé) ; ce
 * module commun évite le cycle d'imports.
 */
export async function insertConsentEvent(
  trx: DbExecutor,
  deps: AppDeps,
  userId: string,
  type: ConsentType,
  action: 'grant' | 'withdraw',
  textVersion: string,
): Promise<void> {
  const stamp = await writeStamp(trx, deps, userId);
  await trx
    .insertInto('consentEvent')
    .values({
      id: deps.ids.uuidv7(),
      ownerId: userId,
      type,
      action,
      textVersion,
      createdAt: stamp.updatedAt,
      ...stamp,
    })
    .execute();
}
