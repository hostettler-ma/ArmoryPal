/** Unofficial-fan-project notice and card data credit (sign-in page and profile). */
export function FanNotice() {
  return (
    <footer className="space-y-1 border-t border-border pt-4 text-xs text-muted">
      <p>
        ArmoryPal is an unofficial, community-made fan project. It is not affiliated with, endorsed, sponsored, or
        approved by Legend Story Studios. Flesh and Blood™ and its card names are property of Legend Story Studios.
      </p>
      <p>
        Card data from{" "}
        <a className="underline" href="https://github.com/the-fab-cube/flesh-and-blood-cards">
          the-fab-cube/flesh-and-blood-cards
        </a>
        .
      </p>
    </footer>
  );
}
