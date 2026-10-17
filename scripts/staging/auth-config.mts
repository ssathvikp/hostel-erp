/**
 * The hosted (staging) project's Auth settings, built from the same sources
 * as the local stack: the subjects and templates in supabase/config.toml and
 * supabase/templates/, plus the staging URLs and SMTP account (E1-T3,
 * E9-T4). Keeping one source means staging emails can never drift from the
 * ones the tests read locally.
 *
 * Pure, so it can be unit tested; scripts/staging/configure-auth.mts sends it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Every variable configure-auth.mts reads. Values never go in git. */
export const AUTH_ENV = [
  "SUPABASE_ACCESS_TOKEN",
  "STAGING_PROJECT_REF",
  "STAGING_SITE_URL",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_SENDER_EMAIL",
] as const;

/** Optional: extra redirect URLs (comma-separated), and the sender's display name. */
export const OPTIONAL_AUTH_ENV = ["STAGING_REDIRECT_URLS", "SMTP_SENDER_NAME"] as const;

type Env = Partial<Record<(typeof AUTH_ENV)[number] | (typeof OPTIONAL_AUTH_ENV)[number], string>>;

/** One email: its subject and template, as config.toml names them. */
interface EmailTemplate {
  subject: string;
  content: string;
}

const LETTERS_DIGITS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789";

/**
 * Reads `[auth.email.template.<name>]` or `[auth.email.notification.<name>]`
 * from config.toml. Only the two keys this project uses are read, so a
 * full TOML parser is not needed.
 */
export function readTemplate(root: string, section: string): EmailTemplate {
  const config = readFileSync(join(root, "supabase", "config.toml"), "utf8");
  const header = `[${section}]`;
  const start = config.indexOf(header);
  if (start === -1) throw new Error(`supabase/config.toml has no ${header} section`);
  const body = config.slice(start + header.length).split(/^\[/m)[0];
  const value = (key: string) => {
    const match = body.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m"));
    if (!match) throw new Error(`${header} in supabase/config.toml has no ${key}`);
    return match[1];
  };
  return {
    subject: value("subject"),
    content: readFileSync(join(root, value("content_path").replace(/^\.\//, "")), "utf8"),
  };
}

function siteUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("STAGING_SITE_URL must start with https://");
  return url.origin;
}

/** Variables that are required but missing or blank. */
export function missingEnv(env: Env): string[] {
  return AUTH_ENV.filter((name) => !env[name]?.trim());
}

/**
 * The body for PATCH /v1/projects/{ref}/config/auth. Mirrors the [auth]
 * section of config.toml, with staging's own URLs and SMTP account.
 */
export function buildAuthConfig(env: Env, root: string) {
  const site = siteUrl(env.STAGING_SITE_URL ?? "");
  const extra = (env.STAGING_REDIRECT_URLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const confirmation = readTemplate(root, "auth.email.template.confirmation");
  const recovery = readTemplate(root, "auth.email.template.recovery");
  const invite = readTemplate(root, "auth.email.template.invite");
  const passwordChanged = readTemplate(root, "auth.email.notification.password_changed");

  return {
    site_url: site,
    // Email links land on /auth/confirm, then continue to a path on the site.
    uri_allow_list: [`${site}/**`, ...extra].join(","),

    // Sign-up: email and password only, confirmed by email.
    disable_signup: false,
    external_email_enabled: true,
    external_phone_enabled: false,
    external_anonymous_users_enabled: false,
    mailer_autoconfirm: false,
    security_manual_linking_enabled: false,
    mailer_secure_email_change_enabled: true,
    mailer_otp_exp: 3600,
    mailer_otp_length: 6,

    // Sessions and passwords, as in config.toml.
    jwt_exp: 3600,
    refresh_token_rotation_enabled: true,
    security_refresh_token_reuse_interval: 10,
    password_min_length: 8,
    password_required_characters: LETTERS_DIGITS,
    security_update_password_require_reauthentication: false,

    // Custom SMTP: Supabase's built-in sender only reaches project members.
    smtp_host: env.SMTP_HOST,
    smtp_port: env.SMTP_PORT,
    smtp_user: env.SMTP_USER,
    smtp_pass: env.SMTP_PASS,
    smtp_admin_email: env.SMTP_SENDER_EMAIL,
    smtp_sender_name: env.SMTP_SENDER_NAME?.trim() || "Hostel ERP",
    smtp_max_frequency: 60,
    rate_limit_email_sent: 30,

    mailer_subjects_confirmation: confirmation.subject,
    mailer_templates_confirmation_content: confirmation.content,
    mailer_subjects_recovery: recovery.subject,
    mailer_templates_recovery_content: recovery.content,
    mailer_subjects_invite: invite.subject,
    mailer_templates_invite_content: invite.content,
    mailer_notifications_password_changed_enabled: true,
    mailer_subjects_password_changed_notification: passwordChanged.subject,
    mailer_templates_password_changed_notification_content: passwordChanged.content,
  };
}

/** The config with secrets and long templates shortened, for printing. */
export function describeAuthConfig(config: ReturnType<typeof buildAuthConfig>) {
  return Object.fromEntries(
    Object.entries(config).map(([key, value]) => {
      if (key === "smtp_pass") return [key, "[hidden]"];
      if (typeof value === "string" && key.startsWith("mailer_templates_")) {
        return [key, `[${value.length} characters of HTML]`];
      }
      return [key, value];
    }),
  );
}
