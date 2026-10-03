/**
 * Loose structural types for the Anthropic `messages[]` entries this
 * extension inspects.
 *
 * They are deliberately permissive: the payload arriving at the transport
 * seam is whatever Pi built, and shaping only ever reads a handful of fields
 * from it.  Modelling the full Anthropic request type here would couple this
 * package to a surface it does not own and does not need.
 *
 * They live in their own module because both the shaping pipeline
 * (`src/request-shaping.ts`) and billing-header construction
 * (`src/billing-header.ts`) read them; declaring them in either one would
 * make that module the dependency owner of a general message shape it only
 * partly uses.
 */

/** A content block inside a message's `content` array. */
export type MessageBlock = {
  type?: string;
  text?: string;
  [key: string]: unknown;
};

/** One entry of an Anthropic request's `messages` array. */
export type MessageParam = {
  role?: string;
  content?: string | MessageBlock[];
  /** Per-message effort, on the `role: "system"` entries Pi sends for it. */
  output_config?: unknown;
  [key: string]: unknown;
};
