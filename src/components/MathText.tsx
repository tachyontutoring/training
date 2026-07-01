"use client";

import { Fragment } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

// Matches $$...$$ (display) or $...$ (inline). Non-greedy so adjacent math
// segments don't get merged. Used to render the LaTeX that math questions carry.
const TOKEN = /\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g;

/**
 * Renders a string that may contain LaTeX math wrapped in `$...$` (inline) or
 * `$$...$$` (display). Text outside the delimiters is left as-is. Only use this
 * for content that actually uses `$` as a math delimiter (i.e. math questions),
 * so that literal dollar signs in prose aren't misread as math.
 */
export function MathText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  if (!text) return null;
  if (!text.includes("$")) {
    return <span className={className}>{text}</span>;
  }

  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>);
    }
    const display = m[1] != null;
    const tex = (m[1] ?? m[2] ?? "").trim();
    let html: string;
    try {
      html = katex.renderToString(tex, {
        throwOnError: false,
        displayMode: display,
      });
    } catch {
      html = tex;
    }
    nodes.push(<span key={key++} dangerouslySetInnerHTML={{ __html: html }} />);
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    nodes.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  }
  return <span className={className}>{nodes}</span>;
}
