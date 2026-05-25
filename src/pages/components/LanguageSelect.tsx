import { type FC } from "hono/jsx";
import { Script } from "../utils/script";

interface LanguageSelectProps {
  languages: string[];
  currentLang?: string;
  baseUrl: string;
  /** Additional query params to preserve when changing language */
  extraParams?: Record<string, string | undefined>;
  paramName?: string;
}

/**
 * Server-rendered language filter dropdown.
 * On change, navigates to the same page with the selected language as a query param.
 * Also reads localStorage `preferred_language` on load to apply preference if no explicit param is set.
 */
export const LanguageSelect: FC<LanguageSelectProps> = ({
  languages,
  currentLang,
  baseUrl,
  extraParams,
  paramName = "lang",
}) => {
  // Build the data attributes for the script to read
  const dataAttrs: Record<string, string> = {
    "data-base-url": baseUrl,
    "data-param-name": paramName,
  };
  if (extraParams) {
    dataAttrs["data-extra-params"] = JSON.stringify(extraParams);
  }

  return (
    <div class="flex items-center">
      <select
        id="lang-filter"
        class="btn btn-ghost cursor-pointer appearance-none bg-[length:16px_16px] bg-[right_0.5rem_center] bg-no-repeat pr-7 text-sm"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='currentColor'%3E%3Cpath fill-rule='evenodd' d='M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z'/%3E%3C/svg%3E")`,
        }}
        {...dataAttrs}
      >
        <option value="">All languages</option>
        {languages.map((l) => (
          <option value={l} selected={l === currentLang}>
            {l}
          </option>
        ))}
      </select>

      <Script
        script={(document) => {
          const select = document.getElementById("lang-filter") as HTMLSelectElement;
          if (!select) return;
          const baseUrl = select.getAttribute("data-base-url") || "";
          const paramName = select.getAttribute("data-param-name") || "lang";
          const extraParamsRaw = select.getAttribute("data-extra-params");
          const extraParams: Record<string, string> = extraParamsRaw
            ? JSON.parse(extraParamsRaw)
            : {};

          // If no lang param was set by the server, apply localStorage preference
          if (!select.value) {
            const stored = localStorage.getItem("preferred_language");
            if (stored) {
              // Check if the stored language exists in the options
              const options = Array.from(select.options);
              const match = options.find((o) => o.value === stored);
              if (match) {
                select.value = stored;
                // Navigate to apply the preference
                navigateWithLang(stored);
                return;
              }
            }
          }

          select.addEventListener("change", () => {
            const lang = select.value;
            // Update localStorage to match the explicit user choice
            if (lang) {
              localStorage.setItem("preferred_language", lang);
            } else {
              localStorage.removeItem("preferred_language");
            }
            navigateWithLang(lang);
          });

          function navigateWithLang(lang: string) {
            const params = new URLSearchParams();
            if (lang) params.set(paramName, lang);
            for (const [k, v] of Object.entries(extraParams)) {
              if (v) params.set(k, v);
            }
            const qs = params.toString();
            window.location.href = qs ? `${baseUrl}?${qs}` : baseUrl;
          }
        }}
      />
    </div>
  );
};
