"use client";

import type React from "react";
import { useFormStatus } from "react-dom";

type Props = {
  idleLabel: string;
  pendingLabel: string;
  className?: string;
  disabled?: boolean;
  name?: string;
  value?: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
};

export function FormSubmitButton({ idleLabel, pendingLabel, className, disabled = false, name, value, onClick }: Props) {
  const { pending } = useFormStatus();
  const isDisabled = disabled || pending;
  return (
    <button type="submit" name={name} value={value} disabled={isDisabled} className={className} onClick={onClick}>
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}
