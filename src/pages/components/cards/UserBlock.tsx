import type { FC } from "hono/jsx";

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
      src={size === "lg" ? `/images/w_500/${avatar}` : `/images/w_100/${avatar}`}
      alt=""
      loading="lazy"
      class={`${avatarClass} rounded-full object-cover`}
    />
  ) : (
    <div class={`bg-muted ${avatarClass} rounded-full`} />
  );

  const handleEl = (
    <>
      <span class="text-foreground font-semibold truncate block">@{handle}</span>
      {showName && <div class="text-muted-foreground text-xs truncate">{displayName}</div>}
    </>
  );

  const baseClass = "flex shrink-0 w-fit max-w-[140px] items-start gap-2";
  return (
    <div class={className ? `${baseClass} ${className}` : baseClass}>
      {noLink ? (
        <span class="shrink-0">{avatarEl}</span>
      ) : (
        <a href={`/profile/${handle}`} class="shrink-0">
          {avatarEl}
        </a>
      )}
      <div class="flex-1">
        {noLink ? (
          handleEl
        ) : (
          <>
            <a
              href={`/profile/${handle}`}
              class="text-foreground hover:text-primary font-semibold truncate block"
            >
              @{handle}
            </a>
            {showName && <div class="text-muted-foreground text-xs truncate">{displayName}</div>}
          </>
        )}
      </div>
      {suffix && <span class="text-muted-foreground shrink-0 text-sm">{suffix}</span>}
    </div>
  );
};
