import { devSignIn } from "@/app/actions/dev";
import { DEV_USERS } from "@/lib/dev-users";

/** One-tap sign-in as a seeded test player. Rendered only when devLoginEnabled(). */
export function DevLogin({ next, failed }: { next: string; failed: boolean }) {
  return (
    <section className="card space-y-3" aria-label="Dev sign-in">
      <div>
        <p className="font-semibold">Dev sign-in</p>
        <p className="text-sm text-muted">Local only. Use two browsers (or a private window) to act as two players.</p>
      </div>
      {failed && (
        <p className="field-error">
          Couldn&apos;t sign in. Run <code>npm run db:seed-dev</code> first.
        </p>
      )}
      <div className="grid grid-cols-3 gap-2">
        {DEV_USERS.map((u) => (
          <form key={u.email} action={devSignIn}>
            <input type="hidden" name="email" value={u.email} />
            <input type="hidden" name="next" value={next} />
            <button className="btn btn-secondary w-full">{u.name.replace(" (dev)", "")}</button>
          </form>
        ))}
      </div>
    </section>
  );
}
