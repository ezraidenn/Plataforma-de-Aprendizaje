/**
 * Permiso «Puede editar identidad»: al encenderlo, el maestro gana la etiqueta
 * «Identidad» y en sus Ajustes aparece la tarjeta de la empresa.
 */
export const IDENTITY_PERMISSION_CYCLE_MS = 9_000;

export type IdentityPermissionState = {
  /** El permiso está encendido */
  allowed: boolean;
  /** La etiqueta «Identidad» junto al rol */
  badge: boolean;
  /** El maestro ve la tarjeta en sus Ajustes */
  cardVisible: boolean;
};

export function identityPermissionStory(phase: number): IdentityPermissionState {
  if (phase < 0.3) {
    return { allowed: false, badge: false, cardVisible: false };
  }
  // Se enciende el permiso
  if (phase < 0.55) {
    return { allowed: true, badge: false, cardVisible: false };
  }
  // Aparece la etiqueta junto a su rol
  if (phase < 0.78) {
    return { allowed: true, badge: true, cardVisible: false };
  }
  // Y en sus Ajustes, la tarjeta de identidad
  return { allowed: true, badge: true, cardVisible: true };
}
