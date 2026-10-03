/**
 * Parser for the structured system prompt Pi emits from 0.86.0 onwards.
 *
 * `buildSystemPromptSections` renders an untagged preamble followed by named
 * sections, each wrapped as `<name>\n${content}\n</name>`, and
 * `getSystemMessageText` joins the non-empty parts with a blank line.  Shaping
 * needs to act on individual sections without disturbing the rest, so this
 * module splits that text into ordered chunks and renders them back.
 *
 * Parsing is deliberately conservative: anything that does not match the exact
 * shape upstream emits is kept as untagged text with its source bytes intact,
 * so a prompt this parser does not understand degrades to passthrough rather
 * than corruption.
 */

/** One top-level chunk of pi's structured system prompt. */
export type PromptChunk = {
  /** Tag name, or null for untagged text (the preamble, or an unparsed remainder). */
  name: string | null;
  /** Exact source text of the chunk, tags included. */
  raw: string;
  /** Text between the tags; equals `raw` when untagged. */
  body: string;
};

/**
 * Chunk boundaries consume exactly this separator, so any additional blank
 * lines stay inside the chunk that precedes them and the round-trip stays
 * byte-exact.
 */
const CHUNK_SEPARATOR = "\n\n";

/**
 * Opens a section.  The name pattern mirrors upstream's own
 * `SYSTEM_PROMPT_SECTION_NAME`, and requiring a bare tag (no attributes) is
 * what keeps `<project_instructions path="...">` inside a section body rather
 * than starting a new one.
 */
const SECTION_OPEN_PATTERN = /<([a-z][a-z0-9_-]*)>\n/y;

/**
 * Splits a rendered system prompt into ordered chunks.
 *
 * @param text - the flattened system prompt.
 * @returns the chunks in source order; `renderSystemPromptChunks` reverses this
 *   exactly.
 */
export function parseSystemPromptChunks(text: string): PromptChunk[] {
  if (text === "") {
    return [];
  }

  const chunks: PromptChunk[] = [];
  let untaggedStart = 0;
  let searchFrom = 0;

  while (searchFrom <= text.length) {
    const start = findSectionStart(text, searchFrom);
    if (start === undefined) {
      break;
    }

    const section = readSectionAt(text, start);
    if (!section) {
      searchFrom = start + 1;
      continue;
    }

    if (start > untaggedStart) {
      chunks.push(
        untaggedChunk(
          text.slice(untaggedStart, start - CHUNK_SEPARATOR.length),
        ),
      );
    }
    chunks.push(section.chunk);
    untaggedStart = section.end + CHUNK_SEPARATOR.length;
    searchFrom = untaggedStart;
  }

  if (untaggedStart < text.length) {
    chunks.push(untaggedChunk(text.slice(untaggedStart)));
  }
  return chunks;
}

/** Renders chunks back into a system prompt string. */
export function renderSystemPromptChunks(
  chunks: readonly PromptChunk[],
): string {
  return chunks.map((chunk) => chunk.raw).join(CHUNK_SEPARATOR);
}

/**
 * Builds a named section chunk in the form upstream renders.
 *
 * Use this when shaping replaces a section's body, so the result re-parses to
 * the same chunk.
 */
export function namedSection(name: string, body: string): PromptChunk {
  return { name, raw: `<${name}>\n${body}\n</${name}>`, body };
}

/**
 * Finds the next offset at or after `from` that begins a section.
 *
 * A section begins at `from` itself, or after a blank line.  Scanning one
 * character past each rejected separator is what lets a run of newlines
 * resolve to its *last* blank line, leaving the extra newlines attached to the
 * preceding chunk.
 *
 * @returns the offset of the open tag, or undefined when none remains.
 */
function findSectionStart(text: string, from: number): number | undefined {
  if (startsSection(text, from)) {
    return from;
  }

  for (let idx = from; idx <= text.length; ) {
    const separatorIdx = text.indexOf(CHUNK_SEPARATOR, idx);
    if (separatorIdx === -1) {
      return undefined;
    }

    const candidate = separatorIdx + CHUNK_SEPARATOR.length;
    if (startsSection(text, candidate)) {
      return candidate;
    }
    idx = separatorIdx + 1;
  }
  return undefined;
}

function startsSection(text: string, offset: number): boolean {
  SECTION_OPEN_PATTERN.lastIndex = offset;
  return SECTION_OPEN_PATTERN.test(text);
}

/**
 * Reads a section starting exactly at `start`, if one is there.
 *
 * The close tag is matched by name and must end the chunk — it is followed by
 * a blank line or the end of the text — so a nested tag of a different name
 * cannot terminate the section early.
 *
 * @returns the chunk and the offset just past its close tag, or undefined when
 *   `start` does not begin a well-formed section.
 */
function readSectionAt(
  text: string,
  start: number,
): { chunk: PromptChunk; end: number } | undefined {
  SECTION_OPEN_PATTERN.lastIndex = start;
  const open = SECTION_OPEN_PATTERN.exec(text);
  if (!open) {
    return undefined;
  }

  const name = open[1];
  const bodyStart = start + open[0].length;
  const closeTag = `\n</${name}>`;

  let searchFrom = bodyStart;
  while (searchFrom <= text.length) {
    const closeIdx = text.indexOf(closeTag, searchFrom);
    if (closeIdx === -1) {
      return undefined;
    }

    const end = closeIdx + closeTag.length;
    if (end === text.length || text.startsWith(CHUNK_SEPARATOR, end)) {
      return {
        chunk: {
          name,
          raw: text.slice(start, end),
          body: text.slice(bodyStart, closeIdx),
        },
        end,
      };
    }
    searchFrom = closeIdx + 1;
  }
  return undefined;
}

function untaggedChunk(raw: string): PromptChunk {
  return { name: null, raw, body: raw };
}
