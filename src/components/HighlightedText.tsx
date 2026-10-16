/** A stretch of shard text from the backend, highlighted or not. */
export interface TextPart {
  text: string;
  highlight: boolean;
}

/** Highlights a match, such as a tag or a searched word, in a line of text. */
export function Highlight({ children }: { children: React.ReactNode }) {
  return (
    <mark className="rounded-[3px] bg-sidebar-primary/15 px-0.5 text-sidebar-primary">
      {children}
    </mark>
  );
}

/** Shard text with its matches highlighted, always drawn as plain text. */
export function HighlightedText({ parts }: { parts: TextPart[] }) {
  return parts.map((part, index) =>
    part.highlight ? (
      <Highlight key={index}>{part.text}</Highlight>
    ) : (
      <span key={index}>{part.text}</span>
    ),
  );
}
