import type { Role } from '@rune/contracts';

export interface SessionUser {
  id: string;
  username: string;
  role: Role;
  birthDate: string;
  mustChangePassword: boolean;
  /** Drapeaux de relecteur (spec brique 2 §3.1), relus en base à chaque requête : un retrait vaut tout de suite. */
  catalogReviewer: boolean;
  healthProfessional: boolean;
}

export type AppEnv = {
  Variables: {
    requestId: string;
    clientIp: string | null;
    user: SessionUser | null;
    sessionId: string | null;
    sessionUnavailable?: boolean;
  };
};
