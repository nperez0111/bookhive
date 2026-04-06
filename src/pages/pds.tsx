import type { FC } from "hono/jsx";
import type { ProfileViewDetailed } from "../types";
import { env } from "../env";

export const PdsLanding: FC<{
  profiles: ProfileViewDetailed[];
  bookCounts: Record<string, number>;
}> = ({ profiles, bookCounts }) => {
  const publicUrl = env.PUBLIC_URL.replace(/\/$/, "");

  return (
    <div class="space-y-8">
      <div class="card">
        <div class="card-body flex flex-col items-center gap-4 text-center">
          <h1 class="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">
            bookhive.social
          </h1>
          <p class="text-muted-foreground max-w-xl text-lg">
            A community PDS (Personal Data Server) hosted by{" "}
            <a href={publicUrl} class="text-primary hover:underline">
              BookHive
            </a>
            . Your account, your data — portable anywhere on the AT Protocol.
          </p>
          <div class="mt-2 flex flex-wrap items-center justify-center gap-3">
            <a href="/pds/signup" class="btn btn-primary">
              Create an account
            </a>
            <a href={publicUrl} class="btn btn-ghost">
              What is BookHive?
            </a>
          </div>
          <div class="text-muted-foreground mt-2 flex flex-wrap items-center justify-center gap-4 text-sm">
            <a href="/legal" class="text-primary hover:underline">
              Terms of Service
            </a>
            <span aria-hidden>·</span>
            <a href="/privacy-policy" class="text-primary hover:underline">
              Privacy Policy
            </a>
          </div>
        </div>
      </div>

      {profiles.length > 0 && (
        <div>
          <h2 class="text-foreground mb-4 text-xl font-semibold">
            Accounts hosted here ({profiles.length})
          </h2>
          <div class="grid gap-4 sm:grid-cols-2">
            {profiles.map((profile) => (
              <a
                key={profile.did}
                href={`${publicUrl}/profile/${profile.handle}`}
                class="card transition hover:shadow-md"
              >
                <div class="card-body flex items-center gap-3">
                  {profile.avatar ? (
                    <img
                      src={profile.avatar}
                      alt=""
                      loading="lazy"
                      class="h-12 w-12 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <div class="bg-muted h-12 w-12 shrink-0 rounded-full" />
                  )}
                  <div class="min-w-0 flex-1">
                    {profile.displayName && (
                      <div class="text-foreground truncate font-semibold">
                        {profile.displayName}
                      </div>
                    )}
                    <div class="text-muted-foreground truncate text-sm">
                      {profile.handle.endsWith(".bookhive.social")
                        ? profile.handle.replace(/\.bookhive\.social$/, "")
                        : `@${profile.handle}`}
                    </div>
                    {bookCounts[profile.did] != null && (
                      <div class="text-muted-foreground mt-0.5 text-xs">
                        {bookCounts[profile.did]} {bookCounts[profile.did] === 1 ? "book" : "books"}
                      </div>
                    )}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
