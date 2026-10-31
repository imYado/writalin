import { useEffect, useState } from "react";
import { renderCardMarkdown, type ResolveImage } from "../cardMarkdown";

/** One side of a flashcard, with its Markdown, math and images shown. Plain text until it's ready. */
export function CardText({ text, resolveImage, className = "" }: { text: string; resolveImage?: ResolveImage; className?: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setHtml(null);
    void renderCardMarkdown(text, resolveImage).then((h) => live && setHtml(h), () => {});
    return () => {
      live = false;
    };
  }, [text, resolveImage]);
  return html == null ? <span className={`card-md card-md-plain ${className}`}>{text}</span> : <span className={`card-md ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
