"use client";

import { useFormStatus } from "react-dom";
import { btnPrimary } from "./ui";

/**
 * Bouton de soumission désactivé pendant l'envoi. Sans cela, un double tap sur
 * un téléphone lent crée deux fois la même demande.
 */
export function SubmitButton({
  children,
  className = btnPrimary,
  pendingLabel,
  disabled,
}: {
  children: React.ReactNode;
  className?: string;
  pendingLabel?: string;
  // Pour les formulaires dont l'envoi n'a pas de sens tant qu'un choix manque
  // (aucune séance sélectionnée, par exemple).
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} className={className}>
      {pending ? (pendingLabel ?? "Enregistrement…") : children}
    </button>
  );
}
