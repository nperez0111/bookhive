import type { FC } from "hono/jsx";
import { sourceAvatarImageUrl } from "../../../utils/imageProxy";

const sizeMap = {
  sm: { avatar: "h-8 w-8", showDisplayName: false },
  md: { avatar: "h-10 w-10", showDisplayName: true },
  lg: { avatar: "h-20 w-20", showDisplayName: true },
} as const;

export const UserBlock: FC<{
  handle: string;
  displayName?: string | null;
  avatar?: string | null;
  size?: "sm" | "md" | "lg";
  suffix?: string;
  class?: string;
  /** When true, do not render links (for use inside a parent link e.g. profile chip) */
  noLink?: boolean;
}> = ({ handle, displayName, avatar, size = "md", suffix, class: className, noLink = false }) => {
  const { avatar: avatarClass, showDisplayName } = sizeMap[size];
  const showName = showDisplayName && (displayName ?? null);

  const avatarEl = avatar ? (
    <img
      src={sourceAvatarImageUrl(avatar, { size: 160 })}
      alt=""
      loading="lazy"
      class={`${avatarClass} rounded-full object-cover`}
    />
  ) : (
    <div class={`bg-muted ${avatarClass} rounded-full`} />
  );

  // Callers fall back to the raw DID when a handle hasn't resolved yet
  // (`user.handle ?? user.did`). A 32-char `did:plc:…` reads as noise and blows out narrow
  // columns, so show it shortened while keeping the full value in the tooltip.
  const isDid = handle.startsWith("did:");
  const label = isDid ? `${handle.slice(0, 12)}…${handle.slice(-4)}` : `@${handle}`;

  const handleEl = (
    // `truncate`, not `whitespace-nowrap`: without it these chips overflow their column at 320px.
    <>
      <span class="text-foreground block truncate font-semibold" title={handle}>
        {label}
      </span>
      {showName && <div class="text-muted-foreground truncate text-xs">{displayName}</div>}
    </>
  );

  const baseClass = "flex min-w-0 items-start gap-2";
  return (
    <div class={className ? `${baseClass} ${className}` : baseClass}>
      {noLink ? (
        <span class="shrink-0">{avatarEl}</span>
      ) : (
        <a href={`/profile/${handle}`} class="shrink-0">
          {avatarEl}
        </a>
      )}
      <div class="flex-1 min-w-0">
        {noLink ? (
          handleEl
        ) : (
          <>
            <a
              href={`/profile/${handle}`}
              class="text-foreground hover:text-primary font-semibold truncate block"
              title={handle}
            >
              {label}
            </a>
            {showName && <div class="text-muted-foreground text-xs truncate">{displayName}</div>}
          </>
        )}
      </div>
      {suffix && <span class="text-muted-foreground shrink-0 text-sm">{suffix}</span>}
    </div>
  );
};
