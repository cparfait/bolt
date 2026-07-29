"use client";

import { useTransition } from "react";
import type { ReactNode } from "react";

/**
 * Bouton déclenchant une action serveur, avec confirmation facultative.
 * Le `useTransition` évite le double clic et grise le bouton pendant l'appel.
 */
export function BoutonAction({
  action,
  confirmation,
  className,
  title,
  children,
}: {
  action: () => Promise<void>;
  confirmation?: string;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      title={title}
      disabled={pending}
      onClick={() => {
        if (confirmation && !window.confirm(confirmation)) return;
        start(async () => {
          await action();
        });
      }}
      className={className}
    >
      {children}
    </button>
  );
}
