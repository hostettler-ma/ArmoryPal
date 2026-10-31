import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = { title: "Terms of service · ArmoryPal" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service">
      <p>By using ArmoryPal you agree to these terms. They&apos;re short.</p>

      <h2>What ArmoryPal is</h2>
      <p>
        A free, unofficial, community-made tool for coordinating card loans around weekly Flesh and Blood Armory
        events. It is not affiliated with, endorsed, sponsored, or approved by Legend Story Studios or by any store
        listed in the app. Flesh and Blood™ and its card names are property of Legend Story Studios.
      </p>

      <h2>Card loans are between players</h2>
      <p>
        ArmoryPal only helps players see who needs which cards and who will bring them. Any loan is an arrangement
        between the players involved, at their own risk. We aren&apos;t responsible for cards that are lost, damaged,
        not returned, or not brought as promised.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>Use a display name and notes that are respectful. No harassment, spam, or impersonation.</li>
        <li>Don&apos;t try to break, overload, or access parts of the app or other players&apos; data you shouldn&apos;t.</li>
        <li>We may remove content or suspend accounts that break these rules.</li>
      </ul>

      <h2>No guarantees</h2>
      <p>
        ArmoryPal is provided as-is, without warranties. It may have bugs, be unavailable at times, or change or shut
        down. Event times and store details may be out of date, so check with your store.
      </p>

      <h2>Changes and contact</h2>
      <p>
        We may update these terms; the date at the top shows the latest version. Questions:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. How we handle your data is in our{" "}
        <Link href="/privacy">privacy policy</Link>.
      </p>
    </LegalPage>
  );
}
