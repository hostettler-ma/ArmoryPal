import { expect } from "@playwright/test";
import { localEnv } from "./env";

/** Waits for the magic-link email to `email` in Mailpit and returns the sign-in link. */
export async function magicLinkFor(email: string): Promise<string> {
  const { mailpitUrl } = localEnv();
  let id: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
        const body = (await res.json()) as { messages?: { ID: string }[] };
        id = body.messages?.[0]?.ID;
        return id;
      },
      { message: `magic-link email to ${email}`, timeout: 20_000 },
    )
    .toBeTruthy();

  const message = (await (await fetch(`${mailpitUrl}/api/v1/message/${id}`)).json()) as { Text: string; HTML: string };
  const link = `${message.Text}\n${message.HTML}`.match(/https?:\/\/[^\s"'<>)\]]+\/auth\/v1\/verify[^\s"'<>)\]]*/)?.[0];
  if (!link) throw new Error(`No sign-in link in the email to ${email}`);
  return link.replaceAll("&amp;", "&");
}
