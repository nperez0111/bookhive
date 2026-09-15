import { z } from "zod";

const positiveInt = z.coerce.number().positive().transform(Math.floor).optional().catch(undefined);

const trimmedString = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1))
  .optional()
  .catch(undefined);

const secondaryAuthorSchema = z.object({
  name: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1)),
  role: trimmedString,
});

const bookMetaSchema = z.object({
  numPages: positiveInt,
  publicationYear: positiveInt,
  publisher: trimmedString,
  authorBio: trimmedString,
  language: trimmedString,
  secondaryAuthors: z
    .array(secondaryAuthorSchema.catch(undefined as never))
    .transform((arr) => arr.filter(Boolean))
    .pipe(z.array(secondaryAuthorSchema).min(1))
    .optional()
    .catch(undefined),
  ratingsDistribution: z.array(z.coerce.number().finite()).min(1).optional().catch(undefined),
});

export type NormalizedBookMeta = z.infer<typeof bookMetaSchema>;

export function normalizeBookMeta(metaJson: string | null | undefined): NormalizedBookMeta {
  if (!metaJson) return {};

  let raw: unknown;
  try {
    raw = JSON.parse(metaJson);
  } catch {
    return {};
  }

  const result = bookMetaSchema.safeParse(raw);
  return result.success ? result.data : {};
}
