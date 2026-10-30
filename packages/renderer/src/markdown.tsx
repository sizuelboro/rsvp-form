import { Fragment, type ReactNode } from 'react';

/**
 * A deliberately tiny, safe Markdown subset for rich-text elements:
 * **bold**, _italic_, [links](https://…), "- " bullet lists and paragraphs.
 * Output is built from React elements — never innerHTML — so user content cannot inject markup.
 */
const SAFE_URL = /^(https?:\/\/|mailto:)/i;

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*)|(_([^_]+)_)|(\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${i++}`;
    if (m[2]) out.push(<strong key={key}>{m[2]}</strong>);
    else if (m[4]) out.push(<em key={key}>{m[4]}</em>);
    else if (m[6] && m[7]) {
      out.push(SAFE_URL.test(m[7]) ? <a key={key} href={m[7]} target="_blank" rel="noopener noreferrer nofollow">{m[6]}</a> : <Fragment key={key}>{m[6]}</Fragment>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const blocks = source.split(/\n{2,}/);
  return (
    <div className="fr-rich">
      {blocks.map((block, bi) => {
        const lines = block.split('\n');
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
          return <ul key={bi}>{lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*[-*]\s+/, ''), `${bi}-${li}`)}</li>)}</ul>;
        }
        return <p key={bi}>{lines.map((l, li) => <Fragment key={li}>{li > 0 && <br />}{inline(l, `${bi}-${li}`)}</Fragment>)}</p>;
      })}
    </div>
  );
}
