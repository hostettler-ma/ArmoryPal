/** One step of the getting-started guide (first-run pop-up and the /guide page). `link` shows only on the page. */
export type GuideStep = { title: string; body: string; link?: { href: string; label: string } };

export const GUIDE_STEPS: GuideStep[] = [
  {
    title: "Welcome to ArmoryPal",
    body: "Borrow and lend cards for your store's weekly Armory. Here's how it works in five quick steps.",
  },
  {
    title: "Follow your store",
    body: "Find the store where you play and add it. Its weekly Armory then shows up on Home.",
    link: { href: "/stores", label: "Find a store" },
  },
  {
    title: "Say you're going",
    body: "Open this week's event and tap “I'm going”. Only players who are going can ask for cards or bring them.",
  },
  {
    title: "Ask for cards",
    body: "On the event's Requests tab, tap “Add request”. Search for a card and pick the colours you need, or use “Paste list” to add a whole decklist at once.",
  },
  {
    title: "Bring cards for others",
    body: "Tap someone's request to promise copies. “My checklist” lists everything you're bringing, and you'll get a notification when something changes.",
  },
  {
    title: "Keep it handy",
    body: "Add ArmoryPal to your home screen to open it like an app. You can find this guide again in the menu anytime.",
  },
];
