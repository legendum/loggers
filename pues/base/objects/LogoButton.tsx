import type { CSSProperties } from "react";
import { useLogoButton } from "./useLogoButton";

export type LogoButtonProps = {
  logoSrc: string;
  title?: string;
  ariaLabel?: string;
  logoAlt?: string;
  buttonClassName?: string;
  logoClassName?: string;
  logoStyle?: CSSProperties;
  wiggleIntervalMs?: number;
  seenCookieName?: string;
  seenCookieDays?: number;
  /** Optional hook for consumers that open install/help dialogs. */
  onClick?: () => void;
};

/**
 * Top-left logo button with shared behavior:
 * - auto-wiggle every `wiggleIntervalMs` until first click
 * - set a persistent cookie on first click, disabling future auto-wiggle
 * - always wiggle on hover (even after seen)
 */
export function LogoButton({
  logoSrc,
  title,
  ariaLabel,
  logoAlt = "",
  buttonClassName,
  logoClassName,
  logoStyle,
  wiggleIntervalMs = 60_000,
  seenCookieName,
  seenCookieDays = 365,
  onClick,
}: LogoButtonProps) {
  const resolvedAriaLabel = ariaLabel ?? title ?? "Logo";
  const buttonClasses = buttonClassName
    ? `pues-logo-button ${buttonClassName}`
    : "pues-logo-button";
  const logoClasses = logoClassName
    ? `pues-logo-image ${logoClassName}`
    : "pues-logo-image";
  const { imageRef, triggerWiggle, handleClick } = useLogoButton({
    wiggleIntervalMs,
    seenCookieName,
    seenCookieDays,
    onClick,
  });

  return (
    <button
      type="button"
      className={buttonClasses}
      title={title}
      aria-label={resolvedAriaLabel}
      onClick={handleClick}
      onMouseEnter={triggerWiggle}
    >
      <img
        ref={imageRef}
        src={logoSrc}
        alt={logoAlt}
        className={logoClasses}
        style={logoStyle}
      />
    </button>
  );
}
