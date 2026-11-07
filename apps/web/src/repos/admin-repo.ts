import {
  AdminNutritionSchema,
  CoachAdminView,
  CoachReportDetail,
  CoachReportSummary,
  type CreateInvitationRequest,
  CreateInvitationResponse,
  GymSummary,
  InvitationSummary,
  MemberSummary,
  OpsStatusResponse,
  ResetLinkResponse,
  type Role,
  type UserStatus,
} from '@rune/contracts';
import { z } from 'zod';
import type { AppServices } from '../app-services';
import { sendThenPull } from './rows';

export interface AdminRepo {
  members(): Promise<MemberSummary[]>;
  resetLink(id: string): Promise<ResetLinkResponse>;
  revokeSessions(id: string): Promise<void>;
  setStatus(id: string, s: UserStatus): Promise<void>;
  /** `password` : mot de passe de l'admin (P-AUT-5). */
  setRole(id: string, r: Role, password: string): Promise<void>;
  setBirthDate(id: string, d: string): Promise<void>;
  deleteMember(id: string, confirmUsername: string, password: string): Promise<void>;
  invitations(): Promise<InvitationSummary[]>;
  createInvitation(r: CreateInvitationRequest): Promise<CreateInvitationResponse>;
  revokeInvitation(id: string): Promise<void>;
  opsStatus(): Promise<OpsStatusResponse>;
  gyms(): Promise<GymSummary[]>;
  deleteGym(id: string): Promise<void>;
  /** Administration du coach (spec brique 4 §17.2) : état, coûts, compteurs ; les signalements seuls portent du C3. */
  coach(): Promise<CoachAdminView>;
  setCoachEnabled(enabled: boolean): Promise<void>;
  resumeCoach(): Promise<void>;
  coachReports(): Promise<CoachReportSummary[]>;
  coachReport(id: string): Promise<CoachReportDetail>;
  /** Classer : supprime la ligne du signalement. */
  classifyCoachReport(id: string): Promise<void>;
  /** Interrupteur « Repères chiffrés » (spec brique 5 §7, D4) : `full_open`, fermé à l'installation. */
  nutritionFullOpen(): Promise<boolean>;
  setNutritionFullOpen(open: boolean): Promise<boolean>;
}

export function createAdminRepo(s: AppServices): AdminRepo {
  const { api } = s;
  const member = (id: string, action: string) => `/api/admin/members/${encodeURIComponent(id)}/${action}`;
  const post = async (path: string, body?: unknown) => {
    await sendThenPull(s, 'POST', path, { body });
  };

  return {
    members: () => api.get('/api/admin/members', z.array(MemberSummary)),
    resetLink: (id) => sendThenPull(s, 'POST', member(id, 'reset-link'), { schema: ResetLinkResponse }),
    revokeSessions: (id) => post(member(id, 'revoke-sessions')),
    setStatus: (id, status) => post(member(id, 'status'), { status }),
    setRole: (id, role, password) => post(member(id, 'role'), { role, password }),
    setBirthDate: (id, birthDate) => post(member(id, 'birth-date'), { birthDate }),
    deleteMember: (id, confirmUsername, password) =>
      post(member(id, 'delete'), { confirmUsername, password }),
    invitations: () => api.get('/api/admin/invitations', z.array(InvitationSummary)),
    createInvitation: (r) =>
      sendThenPull(s, 'POST', '/api/admin/invitations', { body: r, schema: CreateInvitationResponse }),
    revokeInvitation: (id) => post(`/api/admin/invitations/${encodeURIComponent(id)}/revoke`),
    opsStatus: () => api.get('/api/admin/ops-status', OpsStatusResponse),
    gyms: () => api.get('/api/gyms', z.array(GymSummary)),
    coach: () => api.get('/api/admin/coach', CoachAdminView),
    async setCoachEnabled(enabled) {
      await sendThenPull(s, 'PUT', '/api/admin/coach/state', { body: { enabled } });
    },
    resumeCoach: () => post('/api/admin/coach/resume', {}),
    coachReports: () => api.get('/api/admin/coach/reports', z.array(CoachReportSummary)),
    coachReport: (id) => api.get(`/api/admin/coach/reports/${encodeURIComponent(id)}`, CoachReportDetail),
    async classifyCoachReport(id) {
      await sendThenPull(s, 'DELETE', `/api/admin/coach/reports/${encodeURIComponent(id)}`);
    },
    async nutritionFullOpen() {
      return (await api.get('/api/admin/nutrition', AdminNutritionSchema)).full_open;
    },
    async setNutritionFullOpen(open) {
      const saved = await api.send('PUT', '/api/admin/nutrition', { full_open: open }, AdminNutritionSchema);
      return saved.full_open;
    },
    async deleteGym(id) {
      await sendThenPull(s, 'DELETE', `/api/admin/gyms/${encodeURIComponent(id)}`);
    },
  };
}
