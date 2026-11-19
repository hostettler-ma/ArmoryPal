import type { Metadata } from "next";
import Link from "next/link";
import { DiscordPostPreview } from "@/components/discord-post-preview";
import { armoryBotInviteUrl, DEFAULT_DAYS_BEFORE, DEFAULT_POST_TIME } from "@/lib/armorybot";
import { EXAMPLE_NOW, EXAMPLE_POST, EXAMPLE_TIME_ZONE } from "@/lib/discord-preview";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Set up ArmoryBot · ArmoryPal",
  description: "Post your store's Armory events in your Discord server, kept up to date by ArmoryPal.",
};

/** A slash command or option, set in monospace. */
function Cmd({ children }: { children: React.ReactNode }) {
  return <code className="whitespace-nowrap rounded-control bg-background px-1 font-mono text-body-compact">{children}</code>;
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="card flex gap-3">
      <span
        aria-hidden
        className="flex size-control-sm shrink-0 items-center justify-center rounded-full bg-highlight text-heading-02 text-highlight-foreground"
      >
        {n}
      </span>
      <div className="min-w-0 space-y-2">
        <h3 className="text-heading-02">{title}</h3>
        <div className="space-y-2 text-body-compact text-muted">{children}</div>
      </div>
    </li>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-heading-03">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * Public guide for the person setting ArmoryBot up in a store's Discord server: usually
 * the server's admin, who may not be the store's owner on ArmoryPal or even have an account.
 */
export default function DiscordBotGuidePage() {
  const inviteUrl = armoryBotInviteUrl(process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID);

  return (
    <main className="space-y-8 pb-6 [&_a:not(.btn)]:link [&_ul]:space-y-1 [&_ul_li]:ml-6 [&_ul_li]:list-disc">
      <header className="space-y-2">
        <h1 className="text-heading-04">Set up ArmoryBot for your store&apos;s Discord</h1>
        <p className="text-body text-muted">
          A free Discord bot that shows your store&apos;s weekly Armory in your server, so players can see who&apos;s
          coming and which cards are needed, and sign up with one tap.
        </p>
      </header>

      <Section id="armorypal" title="New to ArmoryPal?">
        <ul className="text-body-compact">
          <li>
            <strong>An Armory</strong> is the casual weekly Flesh and Blood event many stores run. Players often need to
            borrow a few cards to finish a deck.
          </li>
          <li>
            <strong>ArmoryPal</strong> is a free web app for that. Players mark that they&apos;re going, list the cards
            they need, and others offer to bring them. Everyone sees the list update live.
          </li>
          <li>
            <strong>ArmoryBot</strong> brings each event into your Discord server, so players don&apos;t have to open the
            app to see what&apos;s happening.
          </li>
        </ul>
        <Link href="/about" className="inline-block text-label">
          Take a quick tour of ArmoryPal ›
        </Link>
      </Section>

      <Section id="what" title="What it posts">
        <p className="text-body-compact text-muted">
          A few days before each event, ArmoryBot posts something like this in the channel you pick:
        </p>
        <DiscordPostPreview
          message={EXAMPLE_POST}
          timeZone={EXAMPLE_TIME_ZONE}
          now={EXAMPLE_NOW}
          caption="An example post for a made-up store. Dates and times show in each member's own time zone."
        />
        <ul className="text-body-compact">
          <li>
            <strong>The top:</strong> your store, the event&apos;s name, its date and time, and how long until it
            starts.
          </li>
          <li>
            <strong>Going:</strong> who&apos;s coming, in sign-up order, with how many cards each one asked for.
          </li>
          <li>
            <strong>Format:</strong> the format if the store announced one, or the current votes if players are voting
            on it.
          </li>
          <li>
            <strong>Open requests:</strong> the cards people still need, so others can check their binders.
          </li>
          <li>
            <strong>Buttons:</strong> <em>Going</em> and <em>Not going</em> sign a player up or off, and{" "}
            <em>Open in ArmoryPal</em> shows the full event. Only the player who taps sees the bot&apos;s answer.
          </li>
        </ul>
      </Section>

      <Section id="how" title="How it behaves">
        <ul className="text-body-compact">
          <li>
            <strong>One post per event,</strong> {DEFAULT_DAYS_BEFORE} days before at {DEFAULT_POST_TIME} store time
            unless you change it. Weekly Armories and one-off events both get one.
          </li>
          <li>
            <strong>The post updates itself</strong> within seconds when someone signs up, asks for a card, or votes,
            and when the store moves or cancels the event. Nobody needs to post updates by hand.
          </li>
          <li>
            <strong>After the event</strong> (or if it&apos;s cancelled), the buttons switch off and the post stays as a
            record.
          </li>
          <li>
            <strong>Anyone in the channel can tap Going,</strong> even without an ArmoryPal account. Asking for
            cards or offering to bring some needs a free account (<a href="#players">more below</a>).
          </li>
          <li>
            <strong>Optional DMs:</strong> players can ask ArmoryBot to message them when someone needs a card.
            It&apos;s off until each player turns it on.
          </li>
          <li>
            <strong>It doesn&apos;t read your server.</strong> ArmoryBot only posts and edits its own messages and
            answers its commands.
          </li>
        </ul>
      </Section>

      <Section id="before" title="Before you start">
        <ul className="text-body-compact">
          <li>
            <strong>You need Manage Server</strong> in the Discord server, to add the bot and to run its setup
            commands. You don&apos;t need to own the store on ArmoryPal, or even have an ArmoryPal account.
          </li>
          <li>
            <strong>Not a server admin?</strong> Ask one to do the steps below. Store owners and ArmoryPal admins who
            have connected their Discord can also link the store once a server admin has added the bot and{" "}
            <a href="#who">given them the command</a>.
          </li>
          <li>
            <strong>The store must be on ArmoryPal.</strong> Search for it under{" "}
            <Link href="/stores">Find a store</Link>. If it&apos;s missing, email{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with its name, city and Armory night.
          </li>
        </ul>
      </Section>

      <Section id="setup" title="Setting it up">
        <ol className="space-y-3">
          <Step n={1} title="Add ArmoryBot to your server">
            {inviteUrl ? (
              <a href={inviteUrl} className="btn btn-primary" target="_blank" rel="noopener noreferrer">
                Add ArmoryBot to Discord
              </a>
            ) : (
              <p>
                The invite link isn&apos;t available here yet. Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>{" "}
                for it.
              </p>
            )}
            <p>
              Discord asks which server to add it to; only servers where you have Manage Server are listed. Keep the
              four permissions it asks for: <strong>View Channels</strong>, <strong>Send Messages</strong>,{" "}
              <strong>Embed Links</strong> and <strong>Read Message History</strong>. ArmoryBot doesn&apos;t read your
              members&apos; messages.
            </p>
          </Step>

          <Step n={2} title="Pick the channel for event posts">
            <p>
              Use an existing channel such as #armory, or make a new one. A channel only ArmoryBot can post in works
              well: members still tap the buttons, and the posts stay easy to find.
            </p>
            <p>
              If the channel is private, or limits who can post, add the <strong>ArmoryBot</strong> role in the
              channel&apos;s permissions (Edit Channel → Permissions) with View Channel, Send Messages and Embed Links.
            </p>
          </Step>

          <Step n={3} title="Link your store">
            <p>
              In any channel of your server, type <Cmd>/armory link-store</Cmd>. Start typing the store&apos;s name in
              the <Cmd>store</Cmd> option and pick it from the list. Add <Cmd>channel</Cmd> to post somewhere other than
              where you typed the command.
            </p>
            <p>
              ArmoryBot answers with when it will post the next event (only you see its replies). If that time has
              already passed, the post appears within a minute.
            </p>
          </Step>

          <Step n={4} title="Choose when it posts (optional)">
            <p>
              <Cmd>/armory settings</Cmd> changes when and where posts go out:
            </p>
            <ul>
              <li>
                <Cmd>days_before</Cmd>: 0 to 6 days before the event (0 posts on the day). The default is{" "}
                {DEFAULT_DAYS_BEFORE}.
              </li>
              <li>
                <Cmd>post_time</Cmd>: a 24-hour time in the store&apos;s time zone, like <Cmd>10:00</Cmd> or{" "}
                <Cmd>18:30</Cmd>. The default is {DEFAULT_POST_TIME}.
              </li>
              <li>
                <Cmd>channel</Cmd>: post in another channel from now on.
              </li>
            </ul>
            <p>Run it with no options to see the current settings.</p>
          </Step>

          <Step n={5} title="Check it">
            <p>
              <Cmd>/armory status</Cmd> lists every linked store, its channel and settings, and the next event it will
              post. If ArmoryBot lost access to the channel, it says so here.
            </p>
          </Step>

          <Step n={6} title="Tell your players">
            <p>
              Let your community know that the event posts are there and that the buttons work. See{" "}
              <a href="#players">what players need</a> below.
            </p>
          </Step>
        </ol>
      </Section>

      <Section id="players" title="What players need">
        <ul className="text-body-compact">
          <li>
            <strong>Going and Not going work for everyone.</strong> Players without an ArmoryPal account are listed
            by their Discord name and marked &ldquo;via Discord&rdquo; in the app.
          </li>
          <li>
            <strong>To ask for cards or bring some,</strong> a player needs an ArmoryPal account with their Discord
            connected. Signing in to ArmoryPal with Discord does both, and any events they already tapped Going on
            come along. Players with an account connect Discord under{" "}
            <Link href="/me#connected-accounts">Profile → Connected accounts</Link>.
          </li>
          <li>
            <strong>Not going</strong> asks whether to keep or cancel their card requests, just like leaving in the
            app.
          </li>
          <li>
            <strong>DMs</strong> are opt-in: <Link href="/settings/notifications">Notification settings</Link> →
            Discord DMs. ArmoryBot can only DM players who share a server with it, so your server is what makes DMs
            possible. Updates arriving close together are bundled into one message.
          </li>
        </ul>
      </Section>

      <Section id="more" title="More than one store or server">
        <ul className="text-body-compact">
          <li>
            <strong>Several stores in one server:</strong> run <Cmd>/armory link-store</Cmd> once per store, each with
            its own channel if you like. <Cmd>settings</Cmd> and <Cmd>unlink</Cmd> then need the <Cmd>store</Cmd>{" "}
            option.
          </li>
          <li>
            <strong>One store in several servers:</strong> each server links it on its own and gets its own posts.
          </li>
        </ul>
      </Section>

      <Section id="who" title="Letting someone else run the commands">
        <p className="text-body-compact text-muted">
          The <Cmd>/armory</Cmd> commands are only shown to members with Manage Server. To hand setup to someone else,
          such as the store&apos;s owner, open Server Settings → Integrations → ArmoryBot and add their role or account
          under the command&apos;s permissions. Without Manage Server they can link and change the store only if they
          own it on ArmoryPal and have connected their Discord.
        </p>
      </Section>

      <Section id="trouble" title="Troubleshooting">
        <ul className="text-body-compact">
          <li>
            <strong>The /armory command doesn&apos;t show up:</strong> you need Manage Server (or{" "}
            <a href="#who">permission under Integrations</a>). Right after adding the bot, Discord can take a few
            minutes to show it; restarting Discord helps.
          </li>
          <li>
            <strong>&ldquo;You need Manage Server in this server, or to own this store on ArmoryPal.&rdquo;</strong> Ask
            a server admin to run the command, or to give you Manage Server.
          </li>
          <li>
            <strong>No post appeared:</strong> run <Cmd>/armory status</Cmd>. It shows when the next post is due and
            whether the bot lost access. Check the channel&apos;s permissions (step 2), then run{" "}
            <Cmd>/armory settings channel:</Cmd> with the channel to try again.
          </li>
          <li>
            <strong>A post was deleted:</strong> ArmoryBot doesn&apos;t repost an event whose post someone deleted. The
            next event gets a new post as usual.
          </li>
          <li>
            <strong>The event moved or was cancelled:</strong> the post updates itself. Store owners make those changes
            in ArmoryPal under Manage my store.
          </li>
        </ul>
      </Section>

      <Section id="remove" title="Stopping or removing ArmoryBot">
        <p className="text-body-compact text-muted">
          <Cmd>/armory unlink</Cmd> stops posting a store&apos;s events in your server. Anyone with Manage Server can
          do this. Posts already in the channel stay, but stop updating and their buttons switch off. To remove the bot
          entirely, kick ArmoryBot from the server.
        </p>
      </Section>

      <p className="text-body-compact text-muted">
        Questions? Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. See also the{" "}
        <Link href="/privacy">privacy policy</Link>.
      </p>
    </main>
  );
}
