import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { confirmLink, countEmails, waitForEmail } from "../support/mail";
import { anonClient, createUserFactory, TEST_PASSWORD } from "../support/supabase";

/**
 * End-to-end auth flows against local Supabase, following the links in the
 * real emails our templates produce (E2-T2, E2-T3, E2-T7).
 */
const { admin, createUser, track, cleanup } = createUserFactory();

afterAll(cleanup);

const newEmail = () => `signup-${randomUUID()}@example.com`;
const PASSWORD = "Hostel2026";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function profileCount(userId: string) {
  const { count } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("id", userId);
  return count;
}

describe("owner signup", () => {
  it("requires email confirmation and creates exactly one owner profile", async () => {
    const email = newEmail();
    const client = anonClient();

    const { data, error } = await client.auth.signUp({
      email,
      password: PASSWORD,
      options: { data: { full_name: "Meera Iyer" } },
    });
    expect(error).toBeNull();
    expect(data.session).toBeNull();
    const userId = data.user!.id;
    track(userId);

    expect(await profileCount(userId)).toBe(1);

    const signInEarly = await client.auth.signInWithPassword({ email, password: PASSWORD });
    expect(signInEarly.error?.code).toBe("email_not_confirmed");

    const mail = await waitForEmail(email, "Confirm your Hostel ERP account");
    const link = confirmLink(mail.html);
    expect(link.url.origin).toBe("http://localhost:3000");
    expect(link.type).toBe("email");
    expect(link.next).toBe("/onboarding");

    const confirmed = await client.auth.verifyOtp({ type: "email", token_hash: link.tokenHash });
    expect(confirmed.error).toBeNull();
    expect(confirmed.data.session).not.toBeNull();

    const signIn = await anonClient().auth.signInWithPassword({ email, password: PASSWORD });
    expect(signIn.error).toBeNull();
  });

  it("rejects a confirmation link that was already used", async () => {
    const email = newEmail();
    const { data } = await anonClient().auth.signUp({ email, password: PASSWORD });
    track(data.user!.id);

    const { tokenHash } = confirmLink((await waitForEmail(email, "Confirm")).html);
    const first = await anonClient().auth.verifyOtp({ type: "email", token_hash: tokenHash });
    expect(first.error).toBeNull();

    const reused = await anonClient().auth.verifyOtp({ type: "email", token_hash: tokenHash });
    expect(reused.error).not.toBeNull();
  });

  it("answers a repeat signup exactly like a new one and adds no profile", async () => {
    const email = newEmail();
    const first = await anonClient().auth.signUp({ email, password: PASSWORD });
    const userId = first.data.user!.id;
    track(userId);

    // Respect the minimum interval between auth emails to one address.
    await sleep(1_100);
    const repeat = await anonClient().auth.signUp({ email, password: "Different2026" });

    // What the signup action relies on: no error and no session, as for a new
    // address, so the "check your email" response reveals nothing.
    expect(repeat.error).toBeNull();
    expect(repeat.data.session).toBeNull();
    expect(await profileCount(userId)).toBe(1);
  });

  it("refuses a weak password at the auth server too", async () => {
    const { error } = await anonClient().auth.signUp({
      email: newEmail(),
      password: "lettersonly",
    });
    expect(error?.code).toBe("weak_password");
  });
});

describe("sign in", () => {
  it("returns the same error for an unknown email and a wrong password", async () => {
    const user = await createUser();

    const wrongPassword = await anonClient().auth.signInWithPassword({
      email: user.email,
      password: "Wrong-passw0rd",
    });
    const unknownEmail = await anonClient().auth.signInWithPassword({
      email: newEmail(),
      password: "Wrong-passw0rd",
    });

    expect(wrongPassword.error?.code).toBe("invalid_credentials");
    expect(unknownEmail.error?.code).toBe("invalid_credentials");
    expect(wrongPassword.error?.message).toBe(unknownEmail.error?.message);
  });

  it("ends the session on sign out", async () => {
    const user = await createUser();
    expect((await user.client.auth.getUser()).data.user?.id).toBe(user.id);

    await user.client.auth.signOut({ scope: "local" });
    expect((await user.client.auth.getUser()).data.user).toBeNull();
  });
});

describe("password reset", () => {
  it("resets via the emailed link, signs out other sessions and notifies the owner", async () => {
    const user = await createUser();
    const otherDevice = user.client;

    const request = await anonClient().auth.resetPasswordForEmail(user.email);
    expect(request.error).toBeNull();

    const link = confirmLink(
      (await waitForEmail(user.email, "Reset your Hostel ERP password")).html,
    );
    expect(link.type).toBe("recovery");
    expect(link.next).toBe("/reset-password");

    const recovery = anonClient();
    const verified = await recovery.auth.verifyOtp({
      type: "recovery",
      token_hash: link.tokenHash,
    });
    expect(verified.error).toBeNull();

    const newPassword = "Brand-new-2026";
    expect((await recovery.auth.updateUser({ password: newPassword })).error).toBeNull();
    expect((await recovery.auth.signOut({ scope: "others" })).error).toBeNull();

    // The device that was signed in before the reset is now signed out.
    const stale = await otherDevice.auth.getUser();
    expect(stale.data.user).toBeNull();

    const oldLogin = await anonClient().auth.signInWithPassword({
      email: user.email,
      password: TEST_PASSWORD,
    });
    expect(oldLogin.error?.code).toBe("invalid_credentials");
    const newLogin = await anonClient().auth.signInWithPassword({
      email: user.email,
      password: newPassword,
    });
    expect(newLogin.error).toBeNull();

    await waitForEmail(user.email, "password was changed");

    const reused = await anonClient().auth.verifyOtp({
      type: "recovery",
      token_hash: link.tokenHash,
    });
    expect(reused.error).not.toBeNull();
  });

  it("gives no hint whether an email is registered", async () => {
    const email = newEmail();
    const { error } = await anonClient().auth.resetPasswordForEmail(email);
    expect(error).toBeNull();

    await sleep(1_000);
    expect(await countEmails(email)).toBe(0);
  });
});
