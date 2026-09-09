"use client";

import { useFormStatus } from "react-dom";
import { btnPrimary } from "./ui";

/**
 * Bouton de soumission désactivé pendant l'envoi. Sans cela, un double tap sur
 * un téléphone lent crée deux fois la même demande.
 *
 * `name`/`value` : pour les formulaires à deux boutons (« Enregistrer » et
 * « Enregistrer et tester »), où c'est le bouton pressé qui dit au serveur
 * quelle variante exécuter. Les deux se désarment ensemble pendant l'envoi.
 */
export function SubmitButton({
  children,
  className = btnPrimary,
  pendingLabel,
  disabled,
  name,
  value,
}: {
  children: React.ReactNode;
  className?: string;
  pendingLabel?: string;
  // Pour les formulaires dont l'envoi n'a pas de sens tant qu'un choix manque
  // (aucune séance sélectionnée, par exemple).
  disabled?: boolean;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending || disabled}
      className={className}
    >
      {pending ? (pendingLabel ?? "Enregistrement…") : children}
    </button>
  );
}
