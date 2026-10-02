import type { FC } from "hono/jsx";
import { ChevronLeft, ChevronRight } from "./icons";
import { pageWindow } from "../../lib/pagination";
import { buildUrl } from "../../lib/buildUrl";

/**
 * The one offset pager. `/search`, `/explore/genres/:genre` and
 * `/authors/:author` each used to carry a byte-for-byte copy of this markup,
 * and the copies had already drifted.
 *
 * Callers supply the base path and whatever query params must survive
 * pagination (`q`, `sort`, `lang`); `buildUrl` drops the empty ones, so a
 * caller can pass `lang` unconditionally.
 */
export const Pagination: FC<{
  basePath: string;
  currentPage: number;
  totalPages: number;
  /** Query params carried onto every page link, alongside `page`. */
  params?: Record<string, string | number | undefined | null>;
}> = ({ basePath, currentPage, totalPages, params = {} }) => {
  if (totalPages <= 1) return null;

  const href = (page: number) => buildUrl(basePath, { ...params, page });
  const step = "btn btn-sm btn-ghost min-h-10 min-w-10";

  return (
    <nav class="flex flex-wrap items-center justify-center gap-2" aria-label="Pagination">
      <PageStep href={currentPage > 1 ? href(currentPage - 1) : null} label="Previous" />

      {pageWindow(currentPage, totalPages).map((pageNum) => {
        const isCurrentPage = pageNum === currentPage;
        return (
          <a
            key={pageNum}
            href={href(pageNum)}
            class={`btn btn-sm min-h-10 min-w-10 tabular-nums ${isCurrentPage ? "btn-primary" : "btn-ghost"}`}
            aria-current={isCurrentPage ? "page" : undefined}
          >
            {pageNum}
          </a>
        );
      })}

      <PageStep href={currentPage < totalPages ? href(currentPage + 1) : null} label="Next" />
    </nav>
  );

  /** A prev/next arrow, rendered as a disabled `<span>` when there's nowhere to go. */
  function PageStep({ href: to, label }: { href: string | null; label: "Previous" | "Next" }) {
    const icon = label === "Previous" ? <ChevronLeft /> : <ChevronRight />;
    if (!to) {
      return (
        <span class={`${step} opacity-50`} aria-disabled="true">
          <span class="sr-only">{label}</span>
          {icon}
        </span>
      );
    }
    return (
      <a href={to} class={step}>
        <span class="sr-only">{label}</span>
        {icon}
      </a>
    );
  }
};
