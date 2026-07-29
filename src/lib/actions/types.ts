/** État renvoyé par les actions serveur aux formulaires (useActionState). */
export type ActionState = { error?: string; success?: string } | null;

export const erreur = (message: string): ActionState => ({ error: message });
export const succes = (message: string): ActionState => ({ success: message });
