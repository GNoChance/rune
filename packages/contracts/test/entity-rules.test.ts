import { describe, expect, it } from 'vitest';
import { entityRules, mirroredTables, SYNC_COLUMNS } from '../src/entity-rules';

const EXPECTED: Record<string, string> = {
  applied_op: 'C0/H/user_id/false/cascade',
  consent_event: 'C1/E/owner_id/true/cascade',
  exercise: 'C0/C//false/set_null',
  exercise_comment: 'C0/H//false/set_null',
  exercise_revision: 'C0/H//false/set_null',
  exercise_validation: 'C0/H//false/set_null',
  gym: 'C0/E//false/set_null',
  gym_equipment: 'C0/E//false/set_null',
  gym_history: 'C0/H//false/set_null',
  health_screening: 'C2/E/owner_id/true/cascade',
  home_equipment: 'C1/E/owner_id/true/cascade',
  // Aucune colonne vers user : comme server_meta (la règle `set_null` d'exercise tient à reviewed_by).
  illustration: 'C0/C//false/not_linked',
  invitation: 'C0/H//false/set_null',
  limitation: 'C2/E/owner_id/true/cascade',
  password_reset: 'C0/H/user_id/false/cascade',
  place: 'C1/E/owner_id/true/cascade',
  schema_migrations: 'C0/H//false/not_linked',
  security_event: 'C0/H//false/keep',
  server_meta: 'C0/H//false/not_linked',
  session: 'C1/H/user_id/false/anonymize',
  sync_rejection: 'C1/J/owner_id/true/cascade',
  training_profile: 'C1/E/owner_id/true/cascade',
  user: 'C0/E/id/true/cascade',
  // Programmes et séances (brique 3)
  engine_decision: 'C1/D/owner_id/true/cascade',
  instance_change: 'C1/E/owner_id/true/cascade',
  performed_exercise: 'C1/J/owner_id/true/cascade',
  performed_set: 'C1/J/owner_id/true/cascade',
  program_instance: 'C1/E/owner_id/true/cascade',
  slot_state: 'C1/D/owner_id/true/cascade',
  workout_session: 'C1/J/owner_id/true/cascade',
  // Coach (brique 4) : classe H, jamais synchronisé
  coach_call: 'C1/H/user_id/true/cascade',
  coach_message: 'C3/H/user_id/true/cascade',
  coach_report: 'C3/H/user_id/true/cascade',
  coach_safety_counter: 'C0/H//false/not_linked',
  coach_state: 'C0/H//false/not_linked',
  coach_thread: 'C3/H/user_id/true/cascade',
  // Nutrition (brique 5)
  advice_sheet: 'C0/C//false/set_null',
  nutrition_checkin: 'C2/D/owner_id/true/cascade',
  nutrition_profile: 'C1/E/owner_id/true/cascade',
  nutrition_state: 'C0/H//false/set_null',
  nutrition_target: 'C2/D/owner_id/true/cascade',
  weigh_in: 'C2/J/owner_id/true/cascade',
};

/** Tables de la brique 3 : programmes (E, D) et séances (J). */
const PROGRAM_TABLES = [
  'program_instance',
  'instance_change',
  'slot_state',
  'engine_decision',
  'workout_session',
  'performed_exercise',
  'performed_set',
] as const;

/** Tables de la brique 4 : coach (classe H). */
const COACH_TABLES = [
  'coach_thread',
  'coach_message',
  'coach_call',
  'coach_report',
  'coach_safety_counter',
  'coach_state',
] as const;

/** Tables de la brique 2 : catalogue (classe C) et relecture (classe H). */
const CATALOG_TABLES = [
  'exercise',
  'illustration',
  'exercise_comment',
  'exercise_validation',
  'exercise_revision',
] as const;

const ruleOf = (t: string) => {
  const r = entityRules[t];
  if (!r) throw new Error(t);
  return r;
};

const pick = (t: string) => {
  const r = ruleOf(t);
  return [r.category, r.syncClass, r.ownerColumn ?? '', r.exported, r.onUserDelete].join('/');
};

describe('entityRules', () => {
  it('déclare les 18 tables du socle, les 5 du catalogue, les 7 des programmes et les 6 du coach, et les 6 de la nutrition avec leurs valeurs', () => {
    expect(Object.keys(entityRules).sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const t of Object.keys(EXPECTED)) expect(pick(t)).toBe(EXPECTED[t]);
  });

  it('déclare les drapeaux de relecteur du compte et les colonnes éditoriales des fiches', () => {
    expect(ruleOf('user').columns.slice(-2)).toEqual(['catalog_reviewer', 'health_professional']);
    expect(ruleOf('exercise').columns).toEqual(
      expect.arrayContaining(['batch', 'reviewed_by', 'exported_revision']),
    );
    for (const t of CATALOG_TABLES) {
      expect(ruleOf(t).secretColumns, t).toEqual([]);
      expect(ruleOf(t).pullRedact, t).toBeUndefined();
    }
  });

  it('déclare parent, colonnes C2 et valeurs C2 des tables de séance et de programme', () => {
    expect(ruleOf('performed_exercise').parent).toEqual({ entity: 'workout_session', column: 'session_id' });
    expect(ruleOf('performed_set').parent).toEqual({
      entity: 'performed_exercise',
      column: 'performed_exercise_id',
    });
    expect(ruleOf('performed_exercise').c2Columns).toEqual(['pain_level']);
    expect(ruleOf('performed_exercise').c2Values).toEqual({ swap_reason: ['pain'] });
    expect(ruleOf('slot_state').c2Columns).toEqual(['pain_streak']);
    expect(ruleOf('instance_change').c2Columns).toEqual(['reason']);
    expect(ruleOf('workout_session').clientWritable).toEqual([
      'instance_id',
      'workout_id',
      'place_id',
      'device_id',
      'started_at',
      'ended_at',
      'status',
      'week_type',
      'template_version',
      'rules_version',
      'app_version',
      'profile',
      'note',
    ]);
    // Seules les trois tables de séance sont écrites par le client ; programmes et décisions : API ou serveur.
    for (const t of ['program_instance', 'instance_change', 'slot_state', 'engine_decision'])
      expect(ruleOf(t).clientWritable, t).toEqual([]);
    for (const c of ['id', ...SYNC_COLUMNS]) expect(ruleOf('performed_set').clientWritable).not.toContain(c);
    expect(ruleOf('performed_set').clientWritable).toEqual(
      expect.arrayContaining(['performed_exercise_id', 'logged_at', 'target_variant', 'effort']),
    );
  });

  it('déclare les 6 tables du coach en classe H, sans écriture client, avec leurs colonnes C2', () => {
    for (const t of COACH_TABLES) {
      expect(ruleOf(t).syncClass, t).toBe('H');
      expect(ruleOf(t).clientWritable, t).toEqual([]);
    }
    expect(ruleOf('coach_thread').c2Columns).toEqual(['brief']);
    for (const t of COACH_TABLES.filter((x) => x !== 'coach_thread'))
      expect(ruleOf(t).c2Columns, t).toEqual([]);
    // Table alias → identifiant réel des slots ajoutés : identifiants internes, absente de l'export.
    expect(ruleOf('coach_thread').columns).toContain('slot_aliases');
    expect(ruleOf('coach_thread').secretColumns).toEqual(['slot_aliases']);
    expect(ruleOf('coach_message').columns).toEqual(
      expect.arrayContaining(['blocks', 'display_text', 'display_extras', 'client_message_id']),
    );
    expect(ruleOf('coach_call').columns).toEqual(
      expect.arrayContaining(['day', 'api_calls', 'thinking_dropped', 'counted']),
    );
  });

  it('déclare la nutrition : profil C1 à colonnes C2, pesée J écrite par le client, cibles et bilans du serveur', () => {
    expect(ruleOf('nutrition_profile').c2Columns).toEqual([
      'safety_screen_version',
      'safety_screen_at',
      'safety_pause',
      'sex_for_calc',
      'height_cm',
      'activity_level',
      'goal',
      'cumulative_adjustment_kcal',
    ]);
    expect(ruleOf('nutrition_profile').c2Values).toEqual({ mode_reason: ['safety'] });
    expect(ruleOf('nutrition_profile').c2Columns).not.toContain('mode');
    expect(ruleOf('weigh_in').clientWritable).toEqual(['date', 'weight_g']);
    for (const t of [
      'nutrition_profile',
      'nutrition_target',
      'nutrition_checkin',
      'advice_sheet',
      'nutrition_state',
    ])
      expect(ruleOf(t).clientWritable, t).toEqual([]);
    expect(ruleOf('advice_sheet').columns).toContain('content_hash');
  });

  it('porte les colonnes écrivables par le client et les secrets', () => {
    expect(ruleOf('sync_rejection').clientWritable).toEqual(['dismissed_at']);
    expect(ruleOf('user').secretColumns).toEqual(['password_hash']);
  });

  it('masque au pull les auteurs des salles et de leur matériel', () => {
    const redacted = Object.entries(entityRules)
      .filter(([, r]) => r.pullRedact !== undefined)
      .map(([t, r]) => [t, r.pullRedact]);
    expect(redacted).toEqual([
      ['gym', ['created_by', 'updated_by']],
      ['gym_equipment', ['added_by']],
    ]);
  });

  it('liste les tables miroir en ordre alphabétique, sans aucune table du catalogue', () => {
    expect(mirroredTables()).toEqual([
      'consent_event',
      'engine_decision',
      'gym',
      'gym_equipment',
      'health_screening',
      'home_equipment',
      'instance_change',
      'limitation',
      'nutrition_checkin',
      'nutrition_profile',
      'nutrition_target',
      'performed_exercise',
      'performed_set',
      'place',
      'program_instance',
      'slot_state',
      'sync_rejection',
      'training_profile',
      'user',
      'weigh_in',
      'workout_session',
    ]);
    // Catalogue servi par GET /api/catalog (classe C), relecture en ligne seulement (classe H) : hors pull.
    for (const t of CATALOG_TABLES) expect(mirroredTables(), t).not.toContain(t);
  });

  describe('invariants', () => {
    const all = Object.entries(entityRules);

    it('clientWritable est vide hors classe J', () => {
      for (const [, r] of all) if (r.syncClass !== 'J') expect(r.clientWritable).toEqual([]);
    });

    it('clientWritable, c2Columns, secretColumns et ownerColumn sont des colonnes déclarées', () => {
      for (const [, r] of all) {
        for (const c of [...r.clientWritable, ...r.c2Columns, ...r.secretColumns])
          expect(r.columns).toContain(c);
        if (r.ownerColumn) expect(r.columns).toContain(r.ownerColumn);
      }
    });

    it('les tables à owner_id portent les colonnes de synchro (consent_event sans deleted_at)', () => {
      for (const [t, r] of all) {
        if (r.ownerColumn !== 'owner_id') continue;
        const expected =
          t === 'consent_event' ? SYNC_COLUMNS.filter((c) => c !== 'deleted_at') : SYNC_COLUMNS;
        for (const c of expected) expect(r.columns, t).toContain(c);
      }
    });

    it('les tables J, D et E portent rev', () => {
      for (const [, r] of all) if (['J', 'D', 'E'].includes(r.syncClass)) expect(r.columns).toContain('rev');
    });

    it("les points d'extension, quand ils existent, sont cohérents", () => {
      for (const [, r] of all) {
        if (r.parent) {
          expect(Object.keys(entityRules)).toContain(r.parent.entity);
          expect(r.columns).toContain(r.parent.column);
        }
        for (const c of r.pullRedact ?? []) expect(r.columns).toContain(c);
        for (const c of Object.keys(r.c2Values ?? {})) {
          expect(r.columns).toContain(c);
          expect(r.c2Columns).not.toContain(c);
        }
      }
    });

    it('seules les tables des briques 3 et 5 ont un parent ou des c2Values (ni le socle ni le catalogue)', () => {
      const withExtension = all
        .filter(([, r]) => r.parent !== undefined || r.c2Values !== undefined)
        .map(([t]) => t);
      expect(withExtension.sort()).toEqual(['nutrition_profile', 'performed_exercise', 'performed_set']);
      // `nutrition_profile` (brique 5) est la seule hors des tables de séance : c2Values `mode_reason`, sans parent.
      for (const t of withExtension.filter((x) => x !== 'nutrition_profile'))
        expect(PROGRAM_TABLES).toContain(t);
    });

    it('les tables du coach ne sont pas miroir et ne portent ni owner_id, ni rev, ni deleted_at', () => {
      for (const t of COACH_TABLES) {
        expect(mirroredTables(), t).not.toContain(t);
        for (const c of ['owner_id', 'rev', 'deleted_at']) expect(ruleOf(t).columns, t).not.toContain(c);
      }
    });

    it('les tables de la brique 3 portent les colonnes de synchro, deleted_at compris', () => {
      for (const t of PROGRAM_TABLES) for (const c of SYNC_COLUMNS) expect(ruleOf(t).columns, t).toContain(c);
    });
  });
});
