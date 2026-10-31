import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy policy · ArmoryPal" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <p>
        ArmoryPal helps Flesh and Blood players coordinate card loans for their store&apos;s weekly Armory. This page
        explains what we store, why, and how to have it removed.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>
          <strong>Your sign-in account:</strong> when you sign in with Discord or Google, we receive your account ID,
          email address, and the basic profile details that service shares (such as your name and profile picture
          link).
        </li>
        <li>
          <strong>Your profile:</strong> the display name you choose and, if you add it, your GEM ID.
        </li>
        <li>
          <strong>What you do in the app:</strong> the stores you follow, the events you mark yourself as going to,
          the cards you request (with any notes), the cards you pledge to bring, and your notifications and
          notification settings.
        </li>
      </ul>

      <h2>Who can see it</h2>
      <p>
        Other signed-in players can see your display name, which events you&apos;re going to, and your card requests,
        notes and pledges, because that&apos;s how loans get arranged. Your email address is never shared with other
        players. Your GEM ID isn&apos;t displayed to them, but it is part of your profile, so only add it if
        you&apos;re comfortable with that.
      </p>

      <h2>How we use it</h2>
      <p>
        Only to run ArmoryPal: signing you in, showing events and requests, and sending in-app notifications. We
        don&apos;t show ads, don&apos;t sell or share your data for marketing, and don&apos;t track you across other
        sites.
      </p>

      <h2>Services we rely on</h2>
      <ul>
        <li>
          <strong>Supabase</strong> stores the database and handles sign-in.
        </li>
        <li>
          <strong>Vercel</strong> hosts the website.
        </li>
        <li>
          <strong>Discord</strong> and <strong>Google</strong> confirm who you are when you sign in with them.
        </li>
      </ul>

      <h2>Cookies and local storage</h2>
      <p>
        We use cookies only to keep you signed in, and your browser&apos;s local storage for small preferences (like
        dismissing a banner). No advertising or analytics cookies.
      </p>

      <h2>Keeping and deleting your data</h2>
      <p>
        We keep your data while you have an account. To delete your account and everything linked to it, email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> from the address you sign in with, and we&apos;ll
        remove it. You can also ask us what we hold about you.
      </p>

      <h2>Changes</h2>
      <p>
        If this policy changes, we&apos;ll update the date at the top. Questions:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. See also our <Link href="/terms">terms of service</Link>.
      </p>
    </LegalPage>
  );
}
