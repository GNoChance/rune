/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Prénom du porteur, affiché dans « hébergé chez <prénom> » (03 §13.1). */
  readonly VITE_OWNER_FIRST_NAME?: string;
  /** Version de l'appli écrite dans chaque séance (`workout_session.app_version`) ; « dev » sans elle. */
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
