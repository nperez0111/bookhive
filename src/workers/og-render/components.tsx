/** @jsxImportSource react */
/**
 * Pure OG image JSX components — no DB, Hono, or metrics imports.
 * Used by the OG render worker to generate images off the main thread.
 */
import type {
  BookOgCardProps,
  StatsOgCardProps,
  ProfileOgCardProps,
  LabeledCoverCardProps,
  MarketingOgCardProps,
  AppOgCardProps,
} from "./types";

// ─── Constants ───────────────────────────────────────────────────────────────

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export const COLORS = {
  bg: "#f9eabc", // sand background
  card: "#fef9c3", // yellow-50
  border: "#e5d5a0", // sand-dark
  text: "#1c1917", // stone-900
  textMuted: "#78716c", // stone-500
  primary: "#d97706", // amber-600
  primaryLight: "#fef3c7", // amber-100
  white: "#ffffff",
};

export const OG_RENDER_OPTIONS = {
  width: OG_WIDTH,
  height: OG_HEIGHT,
  format: "webp" as const,
};

// ─── Shared UI components ────────────────────────────────────────────────────

/** SVG star — avoids missing-glyph boxes since Geist has no ★ */
function StarIcon({ filled, size = 28 }: { filled: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "#f59e0b" : "#d6d3d1"}>
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

function StarRating({
  rating,
  max = 5,
  size = 28,
}: {
  rating: number;
  max?: number;
  size?: number;
}) {
  const filled = Math.round(rating);
  return (
    <div tw="flex items-center gap-1">
      {Array.from({ length: max }, (_, i) => (
        <StarIcon key={i} filled={i < filled} size={size} />
      ))}
    </div>
  );
}

/** BookHive logo mark using the sidebar book SVG */
function BrandMark({ size = 32 }: { size?: number }) {
  const h = size;
  const w = Math.round(size * (532 / 688));
  return (
    <div tw="flex items-center gap-3">
      <svg width={w} height={h} viewBox="0 0 532 688" fill="none">
        {/* Book body */}
        <path
          fill="#d97706"
          d="m69.206-.401 5.605-.02a3601.71 3601.71 0 0 1 15.37-.015c5.53 0 11.06-.016 16.59-.03C117.6-.491 128.429-.5 139.258-.501c8.802-.002 17.604-.008 26.406-.017 20.899-.022 41.798-.04 62.697-.04h2.024a589133.313 589133.313 0 0 1 16.272.002c21.155.002 42.31-.02 63.465-.061 23.78-.047 47.558-.072 71.337-.07 12.587.001 25.173-.007 37.76-.04 10.714-.026 21.428-.033 32.143-.013 5.466.01 10.931.01 16.397-.016 5.006-.023 10.012-.019 15.018.007 1.809.005 3.617 0 5.425-.017C500.414-.872 508.21.67 518.086 8.422 523.409 13.836 527.156 18.949 530 26l1.043 2.155c1.21 3.594 1.231 6.94 1.206 10.685l.008 2.385c.006 2.647-.002 5.293-.01 7.94a5722.312 5722.312 0 0 1 0 21.53c-.007 5.673-.002 11.346.002 17.02.005 11.117 0 22.233-.01 33.35-.01 12.935-.01 25.87-.01 38.805 0 23.768-.01 47.536-.025 71.305a98889.16 98889.16 0 0 0-.019 69.317v14.574c.001 22.017-.006 44.034-.014 66.051-.003 9.027-.004 18.053-.004 27.079 0 10.99-.005 21.98-.014 32.971-.005 5.612-.008 11.225-.007 16.837.001 5.13-.002 10.26-.01 15.39v5.59c.002 2.517-.002 5.035-.007 7.553l.006 2.23c-.02 5.005-.02 5.005-1.135 7.233h-2l-.328 2.215c-1.54 6.383-6.179 12.275-11.672 15.785h-2l.02 1.662c.154 13.372.27 26.743.343 40.116.036 6.467.086 12.934.165 19.4.076 6.245.118 12.488.136 18.732.013 2.38.038 4.758.076 7.137.051 3.34.058 6.677.055 10.017l.076 2.962c-.078 7.475-2.63 11.728-7.871 16.974-4.88 4.125-8.433 7.12-14.944 7.136l-3.188.015h-3.529l-3.728.013c-3.425.011-6.85.017-10.276.022-3.69.006-7.38.018-11.07.029-6.396.018-12.793.033-19.19.045-9.25.019-18.5.043-27.75.07-15.007.043-30.014.082-45.022.118l-2.724.006a840797.91 840797.91 0 0 1-41.012.098l-2.722.007c-14.95.036-29.902.076-44.853.119-9.232.026-18.463.048-27.695.067-6.32.012-12.64.028-18.96.047-3.651.011-7.303.02-10.955.025-3.95.005-7.899.018-11.848.032h-3.536l-3.18.015-2.766.007c-2.045-.098-2.045-.098-3.052 1.129-.11 2.897-.162 5.774-.176 8.672a5576.72 5576.72 0 0 1-.072 5.39c-.035 2.842-.064 5.684-.078 8.526a784.6 784.6 0 0 1-.1 8.209l.006 2.564c-.106 5.14-.7 7.914-4.58 11.639-4.755 3.07-9.561 3.096-15 2-5.462-2.261-10.488-5.444-15.528-8.506-3.41-2.06-6.861-4.046-10.314-6.034-3.09-1.78-6.168-3.58-9.245-5.382L139 666l-1.932-1.203c-2.774-1.07-4.252-.677-7.068.203-2.242 1.142-2.242 1.142-4.406 2.625l-2.485 1.63L120.5 671l-2.703 1.766c-3.946 2.594-7.839 5.211-11.578 8.097-6.042 4.64-10.593 7.138-18.367 7.04-4.198-1.329-7.138-3.414-9.852-6.903-.94-3.425-.82-6.68-.684-10.21l.03-2.935c.04-3.078.127-6.153.216-9.23.036-2.092.068-4.185.096-6.277.077-5.118.198-10.232.342-15.348l-1.904.027c-2.881.035-5.762.057-8.643.078l-2.995.043c-7.888.045-14.168-.98-21.458-4.148l-2.617-1.098C33.743 628.852 27.536 624.767 22 620v-2l-1.875-.687C17.385 615.62 16.95 614.008 16 611h-2c-4-6.75-4-6.75-4-9H8l-1-6-3-1-1-10H1c-.9-5.382-1.146-10.559-1.14-16.01l-.009-2.694c-.008-2.983-.01-5.965-.012-8.948l-.015-6.476c-.014-5.935-.022-11.87-.028-17.806-.006-5.09-.016-10.18-.027-15.27-.033-16.77-.054-33.539-.073-50.308l-.015-13.101a154512.013 154512.013 0 0 1-.086-100.23l-.002-2.366c-.016-25.29-.054-50.581-.105-75.872a45104.554 45104.554 0 0 1-.097-91.282c-.005-11.625-.03-23.25-.062-34.876a9323.796 9323.796 0 0 1-.03-35.094c.006-6.331.003-12.662-.028-18.993a2031.9 2031.9 0 0 1-.004-17.417c.003-2.09-.004-4.182-.022-6.273C-.904 53.786 1.88 38.132 14 24l1.492-1.937C22.45 13.257 31.744 7.308 42 3l3.56-1.558C53.146-1.035 61.311-.424 69.205-.4z"
        />
        {/* Book pages (cream interior) */}
        <path
          fill="#fef3c7"
          d="M83.065 519.64a3150.364 3150.364 0 0 1 19.572.013c5.16.012 10.319.007 15.478.005 8.935-.001 17.87.008 26.804.025 12.918.024 25.836.032 38.754.036 20.959.006 41.918.026 62.877.055 20.358.027 40.716.048 61.074.061l3.803.003 18.89.011c52.228.031 104.456.084 156.683.151l-1.249 3.225-1.638 4.287-.82 2.114c-2.66 6.994-4.154 13.972-5.293 21.374l-.434 2.645c-2.483 19.469.801 39.77 9.434 57.355v2a162232.596 162232.596 0 0 1-124.998.111c-13.89.01-27.78.025-41.672.043-14.247.019-28.494.03-42.741.034-8.795.003-17.59.012-26.386.028-6.026.01-12.053.014-18.08.011-3.48-.001-6.96 0-10.44.011-3.768.01-7.537.008-11.306.003l-3.349.017-3.054-.012-2.637.002c-2.562-.272-4.168-.874-6.337-2.248-1.265-2.53-1.118-4.272-1.11-7.105l-.002-3.226.007-3.501c-.014-2.432-.029-4.863-.045-7.295-.023-3.845-.037-7.69-.025-11.534.009-3.704-.02-7.405-.055-11.109l.037-3.482-.05-3.255-.004-2.855c-.885-3.102-2.243-4.748-4.827-6.675-3.812-1.906-7.786-1.655-11.967-1.61l-3.018-.027a831.578 831.578 0 0 0-9.847.01c-2.287-.003-4.573-.008-6.86-.015-4.787-.007-9.575.004-14.363.027-6.134.029-12.267.012-18.4-.018-4.72-.018-9.44-.012-14.16 0-2.262.004-4.523 0-6.785-.011-3.162-.013-6.323.006-9.485.034l-2.825-.03c-4.372.07-7.307.29-10.781 3.092-3.358 3.565-3.565 5.172-3.64 9.953l-.06 3.397-.051 3.68-.063 3.758c-.055 3.298-.105 6.596-.153 9.894-.05 3.365-.106 6.73-.161 10.094A13586.2 13586.2 0 0 0 77 613c-1.763.018-3.526.03-5.289.042l-2.974.023c-10.86-.258-20.216-6.627-27.924-13.753-8.617-9.08-12.46-20.214-12.942-32.636C28.384 553.79 33.482 542.59 42 533c2.513-2.302 5.111-4.199 8-6l1.742-1.14c10.15-6.269 19.854-6.285 31.323-6.22z"
        />
        {/* Spine */}
        <path
          fill="#92400e"
          d="M57.182 26.405 59 27l-.016 3.301c-.018 4.06-.03 8.118-.039 12.178-.005 1.753-.012 3.507-.02 5.26-.013 2.527-.018 5.054-.023 7.581l-.015 2.359c0 4.236.388 8.136 1.113 12.321-.22 1.968-.444 3.936-.733 5.894-.45 3.552-.411 7.093-.392 10.668l-.012 2.17.004 2.147.004 1.893c.103 2.426.103 2.426.667 5.583.451 3.558.347 6.528-.007 10.086-.705 8.525-.448 16.988-.213 25.53.56 21.05.723 42.027.296 63.08-.14 6.964-.257 13.928-.37 20.892l-.034 2.16c-.38 23.7-.322 47.403-.282 71.105.012 6.968.016 13.935.02 20.902.007 12.415.017 24.83.031 37.246l.003 2.215a550368.398 550368.398 0 0 0 .039 33.765l.002 2.267c.014 12.463.023 24.925.03 37.388.005 7.628.013 15.256.026 22.884.009 5.795.013 11.59.016 17.385.002 2.373.005 4.747.01 7.12.008 3.23.009 6.462.009 9.693l.01 2.853c-.013 8.42-.013 8.42-1.124 12.074-1.623 1.207-1.623 1.207-3.719 2.027l-2.314.953-2.467.957c-7.588 3.143-14.15 6.61-20.602 11.731C27 514 27 514 25 514a100173.194 100173.194 0 0 1-.44-192.664l-.003-2.045c-.034-21.86-.094-43.72-.167-65.579a26273.97 26273.97 0 0 1-.143-69.335c-.01-13.838-.045-27.675-.11-41.513-.043-9.494-.055-18.988-.045-28.483.005-5.474-.003-10.948-.046-16.423-.039-5.02-.04-10.04-.013-15.06A342.4 342.4 0 0 0 24 77.473c-.198-15.072 3.535-26.083 13.186-37.912 13.941-14.28 13.941-14.28 19.995-13.157z"
        />
      </svg>
      <span tw="font-bold text-xl" style={{ color: COLORS.primary }}>
        BookHive
      </span>
    </div>
  );
}

/** 3×2 grid of book covers filling the available space */
function CoverGrid({ covers }: { covers: string[] }) {
  return (
    <div tw="flex flex-wrap flex-1 overflow-hidden" style={{ gap: 0 }}>
      {covers.slice(0, 6).map((url, i) => (
        <img
          key={i}
          src={url}
          style={{
            width: "33.333%",
            height: 315,
            objectFit: "contain",
            backgroundColor: COLORS.border,
          }}
        />
      ))}
    </div>
  );
}

/** Left sidebar + cover grid layout shared by ProfileOgCard and LabeledCoverCard */
function SidebarLayout({
  sidebarWidth,
  sidebarPadding,
  children,
  covers,
}: {
  sidebarWidth: number;
  sidebarPadding: string;
  children: React.ReactNode;
  covers: string[];
}) {
  return (
    <div tw="flex w-full h-full" style={{ backgroundColor: COLORS.bg, fontFamily: "Geist" }}>
      <div
        tw="flex flex-col justify-between"
        style={{
          width: sidebarWidth,
          backgroundColor: COLORS.card,
          borderRight: `2px solid ${COLORS.border}`,
          padding: sidebarPadding,
        }}
      >
        {children}
      </div>
      {covers.length > 0 && <CoverGrid covers={covers} />}
    </div>
  );
}

// ─── OG card components ──────────────────────────────────────────────────────

export function BookOgCard({
  title,
  authors,
  coverUrl,
  rating,
  ratingsCount,
  seriesTitle,
  seriesPosition,
  publicationYear,
  pageCount,
  readerCount,
}: BookOgCardProps) {
  const shortTitle = title.length > 52 ? title.slice(0, 49) + "…" : title;
  const authorLine =
    authors.length === 1
      ? authors[0]!
      : authors.slice(0, 2).join(", ") + (authors.length > 2 ? " & more" : "");
  // rating is stored as score × 1000 (e.g. 4520 = 4.52 / 5)
  const displayRating = rating != null ? rating / 1000 : null;

  // Build series line e.g. "Book 3 in The Stormlight Archive"
  const seriesLine = seriesTitle
    ? seriesPosition
      ? `Book ${seriesPosition} in ${seriesTitle.length > 30 ? seriesTitle.slice(0, 27) + "…" : seriesTitle}`
      : seriesTitle.length > 35
        ? seriesTitle.slice(0, 32) + "…"
        : seriesTitle
    : null;

  // Build metadata line e.g. "2017 · 1,232 pages"
  const metaParts: string[] = [];
  if (publicationYear && publicationYear > 0) metaParts.push(String(publicationYear));
  if (pageCount && pageCount > 0) metaParts.push(`${pageCount.toLocaleString()} pages`);
  const metaLine = metaParts.length > 0 ? metaParts.join(" · ") : null;

  return (
    <div tw="flex w-full h-full" style={{ backgroundColor: COLORS.bg, fontFamily: "Geist" }}>
      {coverUrl && (
        <img
          src={coverUrl}
          style={{ width: 420, height: 630, objectFit: "cover", flexShrink: 0 }}
        />
      )}

      {/* Content panel: justify-between so BrandMark anchors to bottom */}
      <div tw="flex flex-col justify-between flex-1" style={{ padding: "30px 36px", gap: 0 }}>
        <div tw="flex flex-col" style={{ gap: 14 }}>
          <div
            tw="font-bold leading-tight"
            style={{ color: COLORS.text, fontSize: coverUrl ? 52 : 64, lineHeight: 1.05 }}
          >
            {shortTitle}
          </div>
          <div tw="text-3xl" style={{ color: COLORS.textMuted }}>
            by {authorLine}
          </div>
          {seriesLine && (
            <div tw="text-2xl font-semibold" style={{ color: COLORS.primary }}>
              {seriesLine}
            </div>
          )}
          {metaLine && (
            <div tw="text-xl" style={{ color: COLORS.textMuted }}>
              {metaLine}
            </div>
          )}
          {displayRating != null && (
            <div tw="flex items-center gap-3">
              <StarRating rating={displayRating} size={38} />
              <span tw="text-2xl" style={{ color: COLORS.textMuted }}>
                {displayRating.toFixed(1)}
                {ratingsCount != null && ` · ${ratingsCount.toLocaleString()} ratings`}
              </span>
            </div>
          )}
          {readerCount > 0 && (
            <div tw="text-xl" style={{ color: COLORS.primary }}>
              {readerCount.toLocaleString()} reader{readerCount !== 1 ? "s" : ""} on BookHive
            </div>
          )}
        </div>
        <BrandMark size={26} />
      </div>
    </div>
  );
}

export function StatsOgCard({
  handle,
  displayName,
  avatarUrl,
  year,
  booksCount,
  averageRating,
  topGenre,
  pagesRead,
  booksPerMonth,
  firstBook,
  lastBook,
  longestBook,
}: StatsOgCardProps) {
  const name = displayName || `@${handle}`;
  const truncTitle = (t: string, max: number) => (t.length > max ? t.slice(0, max - 1) + "…" : t);

  return (
    <div tw="flex w-full h-full" style={{ backgroundColor: COLORS.bg, fontFamily: "Geist" }}>
      {/* Left panel: avatar + identity + branding */}
      <div
        tw="flex flex-col items-center justify-center"
        style={{
          width: 260,
          backgroundColor: COLORS.card,
          borderRight: `2px solid ${COLORS.border}`,
          padding: "24px 20px",
          gap: 8,
        }}
      >
        {avatarUrl && (
          <img
            src={avatarUrl}
            style={{
              width: 130,
              height: 130,
              borderRadius: 65,
              objectFit: "cover",
              border: `3px solid ${COLORS.primary}`,
            }}
          />
        )}
        <div
          tw="font-bold text-center"
          style={{ color: COLORS.text, fontSize: 22, lineHeight: 1.2 }}
        >
          {name}
        </div>
        <div tw="text-base text-center" style={{ color: COLORS.textMuted }}>
          @{handle}
        </div>
        <BrandMark size={24} />
      </div>

      {/* Right panel: stats */}
      <div
        tw="flex flex-col flex-1 justify-center"
        style={{ backgroundColor: COLORS.bg, padding: "20px 32px", gap: 16 }}
      >
        <div tw="flex items-baseline" style={{ gap: 12 }}>
          <span tw="font-bold" style={{ color: COLORS.primary, fontSize: 96, lineHeight: 1 }}>
            {booksCount}
          </span>
          <span tw="text-4xl font-semibold" style={{ color: COLORS.text }}>
            books read in {year}
          </span>
        </div>

        <div tw="flex" style={{ gap: 32 }}>
          {averageRating != null && (
            <div tw="flex flex-col" style={{ gap: 2 }}>
              <div tw="flex items-center" style={{ gap: 6 }}>
                <StarIcon filled={true} />
                <span tw="text-3xl font-bold" style={{ color: COLORS.text }}>
                  {averageRating.toFixed(1)}
                </span>
              </div>
              <span tw="text-xl" style={{ color: COLORS.textMuted }}>
                avg rating
              </span>
            </div>
          )}
          {pagesRead > 0 && (
            <div tw="flex flex-col" style={{ gap: 2 }}>
              <span tw="text-3xl font-bold" style={{ color: COLORS.text }}>
                {pagesRead.toLocaleString()}
              </span>
              <span tw="text-xl" style={{ color: COLORS.textMuted }}>
                pages read
              </span>
            </div>
          )}
          {booksPerMonth != null && (
            <div tw="flex flex-col" style={{ gap: 2 }}>
              <span tw="text-3xl font-bold" style={{ color: COLORS.text }}>
                {booksPerMonth.toFixed(1)}
              </span>
              <span tw="text-xl" style={{ color: COLORS.textMuted }}>
                books/mo
              </span>
            </div>
          )}
          {topGenre && (
            <div tw="flex flex-col" style={{ gap: 2 }}>
              <span tw="text-3xl font-bold" style={{ color: COLORS.text }}>
                {topGenre}
              </span>
              <span tw="text-xl" style={{ color: COLORS.textMuted }}>
                top genre
              </span>
            </div>
          )}
        </div>

        {/* Bookends: first & last book of the year */}
        {firstBook && lastBook && (
          <div tw="flex" style={{ gap: 24 }}>
            {[
              { label: "First read", book: firstBook },
              { label: "Last read", book: lastBook },
            ].map(({ label, book }) => (
              <div key={label} tw="flex items-center" style={{ gap: 10 }}>
                {book.coverUrl && (
                  <img
                    src={book.coverUrl}
                    style={{
                      width: 60,
                      height: 90,
                      objectFit: "cover",
                      borderRadius: 4,
                      border: `1px solid ${COLORS.border}`,
                    }}
                  />
                )}
                <div tw="flex flex-col" style={{ gap: 2 }}>
                  <span tw="text-base font-semibold" style={{ color: COLORS.textMuted }}>
                    {label}
                  </span>
                  <span tw="text-lg font-bold" style={{ color: COLORS.text }}>
                    {truncTitle(book.title, 22)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {longestBook && (
          <div tw="text-lg" style={{ color: COLORS.textMuted }}>
            Longest: {truncTitle(longestBook.title, 28)} ({longestBook.pageCount.toLocaleString()}{" "}
            pages)
          </div>
        )}
      </div>
    </div>
  );
}

export function ProfileOgCard({
  handle,
  displayName,
  avatarUrl,
  bio,
  totalBooks,
  booksThisYear,
  currentlyReading,
  recentCovers,
  topGenres,
}: ProfileOgCardProps) {
  const name = displayName || `@${handle}`;
  const shortBio = bio ? (bio.length > 50 ? bio.slice(0, 47) + "…" : bio) : null;
  const bookCountLabel =
    booksThisYear > 0
      ? `${totalBooks} books · ${booksThisYear} this year`
      : `${totalBooks} books on BookHive`;

  return (
    <SidebarLayout sidebarWidth={300} sidebarPadding="36px 24px" covers={recentCovers}>
      <div tw="flex flex-col items-center" style={{ gap: 10 }}>
        {avatarUrl && (
          <img
            src={avatarUrl}
            style={{
              width: 140,
              height: 140,
              borderRadius: 70,
              objectFit: "cover",
              border: `4px solid ${COLORS.primary}`,
            }}
          />
        )}
        <div
          tw="font-bold text-center"
          style={{ color: COLORS.text, fontSize: 26, lineHeight: 1.2 }}
        >
          {name}
        </div>
        <div tw="text-lg text-center" style={{ color: COLORS.textMuted }}>
          @{handle}
        </div>
        {shortBio && (
          <div tw="text-sm text-center" style={{ color: COLORS.textMuted, lineHeight: 1.3 }}>
            {shortBio}
          </div>
        )}
        <div tw="flex flex-col items-center" style={{ gap: 2 }}>
          <div
            tw="font-bold text-center"
            style={{ color: COLORS.primary, fontSize: 44, lineHeight: 1 }}
          >
            {totalBooks}
          </div>
          <div tw="text-sm text-center" style={{ color: COLORS.textMuted }}>
            {bookCountLabel}
          </div>
        </div>
        {currentlyReading && (
          <div tw="flex flex-col items-center" style={{ gap: 2 }}>
            <div tw="text-xs" style={{ color: COLORS.textMuted }}>
              Currently reading
            </div>
            <div
              tw="text-sm font-semibold text-center"
              style={{ color: COLORS.text, lineHeight: 1.2 }}
            >
              {currentlyReading.length > 30
                ? currentlyReading.slice(0, 27) + "…"
                : currentlyReading}
            </div>
          </div>
        )}
      </div>

      <div tw="flex flex-col items-center" style={{ gap: 10 }}>
        {topGenres.length > 0 && (
          <div tw="flex flex-wrap justify-center" style={{ gap: 6 }}>
            {topGenres.slice(0, 4).map((g) => (
              <div
                key={g.genre}
                tw="text-sm px-3 py-1 rounded-full"
                style={{
                  backgroundColor: COLORS.primaryLight,
                  color: COLORS.primary,
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                {g.genre}
              </div>
            ))}
          </div>
        )}
        <BrandMark size={22} />
      </div>
    </SidebarLayout>
  );
}

export function LabeledCoverCard({
  label,
  name,
  totalBooks,
  covers,
  avgRating,
  readerCount,
}: LabeledCoverCardProps) {
  const shortName = name.length > 28 ? name.slice(0, 25) + "…" : name;
  // avgRating is stored as score × 1000 (e.g. 4520 = 4.52 / 5)
  const displayRating = avgRating != null ? avgRating / 1000 : null;
  return (
    <SidebarLayout sidebarWidth={320} sidebarPadding="44px 36px" covers={covers}>
      <div tw="flex flex-col" style={{ gap: 14 }}>
        <div tw="text-2xl font-semibold" style={{ color: COLORS.primary }}>
          {label}
        </div>
        <div
          tw="font-bold leading-tight"
          style={{ color: COLORS.text, fontSize: 72, lineHeight: 1.0 }}
        >
          {shortName}
        </div>
        <div tw="text-xl" style={{ color: COLORS.textMuted }}>
          {totalBooks.toLocaleString()} book{totalBooks !== 1 ? "s" : ""} on BookHive
        </div>
        {displayRating != null && (
          <div tw="flex items-center" style={{ gap: 6 }}>
            <StarIcon filled={true} size={22} />
            <span tw="text-xl" style={{ color: COLORS.textMuted }}>
              {displayRating.toFixed(1)} avg rating
            </span>
          </div>
        )}
        {readerCount != null && readerCount > 0 && (
          <div tw="text-xl" style={{ color: COLORS.primary }}>
            {readerCount.toLocaleString()} reader{readerCount !== 1 ? "s" : ""}
          </div>
        )}
      </div>
      <BrandMark size={28} />
    </SidebarLayout>
  );
}

export function MarketingOgCard({ origin }: MarketingOgCardProps) {
  return (
    <div
      style={{
        display: "flex",
        width: OG_WIDTH,
        height: OG_HEIGHT,
        backgroundColor: COLORS.bg,
        fontFamily: "Geist",
        padding: 0,
        alignItems: "stretch",
      }}
    >
      {/* Left: logo panel */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: 400,
          flexShrink: 0,
          backgroundColor: COLORS.card,
          borderRight: `2px solid ${COLORS.border}`,
        }}
      >
        <img src={`${origin}/barry_alone_no_bg.svg`} style={{ width: 320, height: 320 }} />
      </div>
      {/* Right: text panel */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "space-between",
          padding: "50px 56px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ color: COLORS.text, fontSize: 64, fontWeight: 700, lineHeight: 1.1 }}>
            Reading is better together
          </div>
          <div style={{ color: COLORS.textMuted, fontSize: 30, lineHeight: 1.45 }}>
            Track your books, connect with friends, and discover your next favourite read on an
            open, social platform.
          </div>
        </div>
        <BrandMark size={30} />
      </div>
    </div>
  );
}

export function AppOgCard({ origin }: AppOgCardProps) {
  return (
    <div
      style={{
        display: "flex",
        width: OG_WIDTH,
        height: OG_HEIGHT,
        backgroundColor: COLORS.bg,
        fontFamily: "Geist",
        padding: 0,
        alignItems: "stretch",
      }}
    >
      {/* Left: mascot + phone mockup hint */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: 400,
          flexShrink: 0,
          backgroundColor: COLORS.card,
          borderRight: `2px solid ${COLORS.border}`,
        }}
      >
        <img src={`${origin}/barry_alone_no_bg.svg`} style={{ width: 280, height: 280 }} />
      </div>
      {/* Right: text + App Store badge */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "space-between",
          padding: "50px 56px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ color: COLORS.text, fontSize: 56, fontWeight: 700, lineHeight: 1.1 }}>
            BookHive for iPhone
          </div>
          <div style={{ color: COLORS.textMuted, fontSize: 28, lineHeight: 1.45 }}>
            Manage, organize, and review your books anywhere. Follow friends, leave comments, and
            discover your next great read — now on iOS.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <img
            src={`${origin}/download_app_store.svg`}
            style={{ height: 54 }}
          />
          <BrandMark size={30} />
        </div>
      </div>
    </div>
  );
}
