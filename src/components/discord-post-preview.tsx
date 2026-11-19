import type { MessageData } from "../../supabase/functions/_shared/discord-types.ts";
import { discordInline, type Inline } from "@/lib/discord-preview";

const ZERO_WIDTH = /^[​\s]*$/;

function Rich({ text, timeZone, now }: { text: string; timeZone: string; now: Date }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <span key={i} className="block">
          {discordInline(line, { timeZone, now }).map((part: Inline, j) => {
            if (part.kind === "bold") return <strong key={j}>{part.text}</strong>;
            if (part.kind === "link") return <span key={j} className="text-accent-text">{part.text}</span>;
            if (part.kind === "time") return <span key={j} className="rounded-control bg-background px-0.5">{part.text}</span>;
            return <span key={j}>{part.text}</span>;
          })}
        </span>
      ))}
    </>
  );
}

const BUTTON_STYLE: Record<number, string> = {
  3: "bg-accent text-accent-foreground", // success
  4: "border-2 border-danger bg-surface text-danger", // danger
  5: "border-2 border-accent-soft bg-surface text-foreground", // link
};

/**
 * A picture of an ArmoryBot post in a Discord channel, drawn from the bot's own message
 * data (renderEventPost). Illustration only: links and buttons don't do anything.
 */
export function DiscordPostPreview({ message, timeZone, now, caption }: { message: MessageData; timeZone: string; now: Date; caption: string }) {
  const embed = message.embeds?.[0];
  if (!embed) return null;
  const rich = (text: string) => <Rich text={text} timeZone={timeZone} now={now} />;

  return (
    <figure className="space-y-2">
      <div className="rounded-container border border-border bg-surface p-3">
        <div className="flex items-center gap-2 pb-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny static app icon */}
          <img src="/icon" alt="" className="size-icon-lg rounded-full" />
          <span className="text-heading-01">ArmoryBot</span>
          <span className="rounded-control bg-highlight px-1 text-tag text-highlight-foreground">APP</span>
        </div>

        <div className="space-y-2 rounded-control border border-l-4 border-border border-l-accent bg-background p-3">
          {embed.author && <p className="text-label">{embed.author.name}</p>}
          {embed.title && <p className="text-heading-02 text-accent-text">{embed.title}</p>}
          {embed.description && <div className="text-body-compact">{rich(embed.description)}</div>}
          <dl className="grid grid-cols-3 gap-x-3 gap-y-2">
            {embed.fields?.map((f, i) => (
              <div key={i} className={`min-w-0 break-words ${f.inline ? "" : "col-span-3"}`}>
                <dt className="text-heading-01">{ZERO_WIDTH.test(f.name) ? " " : f.name}</dt>
                <dd className="text-helper text-muted">{ZERO_WIDTH.test(f.value) ? null : rich(f.value)}</dd>
              </div>
            ))}
          </dl>
          {embed.footer && <p className="text-helper text-muted">{embed.footer.text}</p>}
        </div>

        <div className="space-y-2 pt-2">
          {message.components?.map((row, i) => (
            <div key={i} className="flex flex-wrap gap-2">
              {row.components.map((b) => (
                <span
                  key={b.label}
                  className={`inline-flex min-h-control-sm items-center rounded-control px-3 text-heading-01 ${BUTTON_STYLE[b.style] ?? BUTTON_STYLE[5]}`}
                >
                  {b.label}
                  {b.style === 5 && <span aria-hidden> {"↗︎"}</span>}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
      <figcaption className="text-helper text-muted">{caption}</figcaption>
    </figure>
  );
}
