import type { Metadata } from "next";
import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import { FanNotice } from "@/components/fan-notice";
import checklistShot from "../../../public/tour/checklist.png";
import eventShot from "../../../public/tour/event.png";
import homeShot from "../../../public/tour/home.png";
import manageShot from "../../../public/tour/manage.png";
import notificationsShot from "../../../public/tour/notifications.png";
import requestsShot from "../../../public/tour/requests.png";

export const metadata: Metadata = {
  title: "Welcome to ArmoryPal",
  description: "Borrow and bring Flesh and Blood cards for your store's weekly Armory.",
};

// Screenshots come from e2e/tour/screenshots.spec.ts (npm run tour:screenshots), with a made-up store and players.
const FEATURES: { title: string; body: string; shot: StaticImageData; alt: string }[] = [
  {
    title: "Your next Armory at a glance",
    body: "Follow your store and tap I'm going. Home shows your next Armory, who's coming, and the cards you promised to bring.",
    shot: homeShot,
    alt: "Home: the next Armory with 5 players going, and the cards Alex is bringing for Jordan and Sam.",
  },
  {
    title: "Ask for the cards you need",
    body: "Missing a few cards for your deck? Add them by name or paste a whole list. Other players see right away what's still needed.",
    shot: requestsShot,
    alt: "The Requests tab: each card with how many copies are covered so far.",
  },
  {
    title: "Offer to bring cards",
    body: "Have a spare copy? Tap a request to bring it. Your checklist lists what to pack, and what you'll pick up.",
    shot: checklistShot,
    alt: "My checklist: cards to bring for other players, and cards others are bringing for you.",
  },
  {
    title: "Stay in the loop",
    body: "Everything updates live. You get a notification when someone needs a card you might have, or can't bring one anymore.",
    shot: notificationsShot,
    alt: "Notifications: Casey, Jordan and Sam each need cards for the Armory.",
  },
  {
    title: "Vote on the format",
    body: "Draft, Classic Constructed, Silver Age? When the store asks, players vote, and the store announces the result.",
    shot: eventShot,
    alt: "An event page with a format poll: Classic Constructed leads with 2 of 3 votes.",
  },
  {
    title: "For store owners",
    body: "Run your Armories from your phone: move or cancel an event, add one-offs, link GEM and tickets, and start format polls.",
    shot: manageShot,
    alt: "The store owner's page listing the upcoming weekly Armories with how many are going.",
  },
];

/** Public overview of what ArmoryPal does, for people who've never seen it. */
export default function AboutPage() {
  return (
    <>
      <main className="space-y-10 pb-6">
        <header className="space-y-3">
          <Link href="/" className="wordmark">
            ArmoryPal
          </Link>
          <h1 className="text-heading-04">Welcome to ArmoryPal</h1>
          <p className="text-body text-muted">
            Many stores run a casual weekly Flesh and Blood event called an <strong>Armory</strong>. ArmoryPal helps
            players borrow and lend cards for it, so everyone gets to play the deck they want.
          </p>
          <Link href="/" className="btn btn-primary">
            Get started
          </Link>
        </header>

        {FEATURES.map((f) => (
          <section key={f.title} aria-labelledby={slug(f.title)} className="space-y-3">
            <div className="space-y-1">
              <h2 id={slug(f.title)} className="text-heading-03">
                {f.title}
              </h2>
              <p className="text-body-compact text-muted">{f.body}</p>
            </div>
            <Image
              src={f.shot}
              alt={f.alt}
              sizes="(max-width: 512px) 70vw, 340px"
              className="mx-auto w-4/5 max-w-80 rounded-container border border-border"
            />
          </section>
        ))}

        <section aria-labelledby="discord" className="card space-y-1">
          <h2 id="discord" className="text-heading-02">
            Your store has a Discord?
          </h2>
          <p className="text-body-compact text-muted">
            ArmoryBot posts each Armory in your server and keeps it up to date. Players can sign up right from Discord.
          </p>
          <Link href="/discord-bot" className="inline-block text-label link">
            Set up ArmoryBot ›
          </Link>
        </section>

        <section aria-labelledby="install" className="space-y-1">
          <h2 id="install" className="text-heading-03">
            Free, and works like an app
          </h2>
          <p className="text-body-compact text-muted">
            Sign in with Discord. On your phone, use Add to Home Screen (iPhone) or Install (Android) to open ArmoryPal
            like any other app.
          </p>
        </section>

        <Link href="/" className="btn btn-primary">
          Get started
        </Link>
      </main>
      <FanNotice />
    </>
  );
}

function slug(title: string) {
  return title.toLowerCase().replace(/[^a-z]+/g, "-");
}
