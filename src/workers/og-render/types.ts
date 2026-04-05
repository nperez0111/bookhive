// ─── Card prop interfaces ────────────────────────────────────────────────────

export interface BookOgCardProps {
  title: string;
  authors: string[];
  coverUrl: string | null;
  rating: number | null;
  ratingsCount: number | null;
  seriesTitle: string | null;
  seriesPosition: number | null;
  publicationYear: number | null;
  pageCount: number | null;
  readerCount: number;
}

export interface StatsOgCardProps {
  handle: string;
  displayName: string | undefined;
  avatarUrl: string | undefined;
  year: number;
  booksCount: number;
  averageRating: number | null;
  topGenre: string | null;
  pagesRead: number;
  booksPerMonth: number | null;
  firstBook: { title: string; coverUrl: string | null } | null;
  lastBook: { title: string; coverUrl: string | null } | null;
  longestBook: { title: string; pageCount: number } | null;
}

export interface ProfileOgCardProps {
  handle: string;
  displayName: string | undefined;
  avatarUrl: string | undefined;
  bio: string | null;
  totalBooks: number;
  booksThisYear: number;
  currentlyReading: string | null;
  recentCovers: string[];
  topGenres: { genre: string; count: number }[];
}

export interface LabeledCoverCardProps {
  label: string;
  name: string;
  totalBooks: number;
  covers: string[];
  avgRating?: number | null;
  readerCount?: number | null;
}

export interface MarketingOgCardProps {
  origin: string;
}

export interface AppOgCardProps {
  origin: string;
}

// ─── Message protocol ────────────────────────────────────────────────────────

export type OgCard =
  | { kind: "book"; props: BookOgCardProps }
  | { kind: "stats"; props: StatsOgCardProps }
  | { kind: "profile"; props: ProfileOgCardProps }
  | { kind: "labeled-cover"; props: LabeledCoverCardProps }
  | { kind: "marketing"; props: MarketingOgCardProps }
  | { kind: "app"; props: AppOgCardProps };

export type OgRenderRequest = {
  type: "render";
  id: string;
  card: OgCard;
};

export type OgRenderResponse =
  | { type: "render-result"; id: string; ok: true; buffer: ArrayBuffer }
  | { type: "render-result"; id: string; ok: false; error: string };
