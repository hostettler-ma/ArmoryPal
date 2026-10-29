import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { formatReleaseMonth } from "@/lib/cards";
import { CardDemo } from "./card-demo";

// Temporary playground for the card autocomplete; replaced by the add-request sheet in Phase 4.
export default async function DevCardsPage() {
  const { supabase } = await requireProfile();
  const { data: meta } = await supabase
    .from("catalog_meta")
    .select("latest_set_id, latest_set_name, latest_set_released_on")
    .maybeSingle();

  return (
    <main className="space-y-5">
      <PageHeader title="Card search" back="/" />
      <p className="text-sm text-muted">
        {meta ? (
          <>
            Includes cards up to <span className="font-medium text-foreground">{meta.latest_set_name}</span> (
            {meta.latest_set_id}
            {meta.latest_set_released_on && `, ${formatReleaseMonth(meta.latest_set_released_on)}`}).
          </>
        ) : (
          "The card catalog hasn't been imported yet."
        )}
      </p>
      <CardDemo />
      <p className="text-xs text-muted">
        Card data from{" "}
        <a className="underline" href="https://github.com/the-fab-cube/flesh-and-blood-cards">
          the-fab-cube/flesh-and-blood-cards
        </a>
        .
      </p>
    </main>
  );
}
