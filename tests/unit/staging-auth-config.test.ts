import { describe, expect, it } from "vitest";

import {
  buildAuthConfig,
  describeAuthConfig,
  missingEnv,
  readTemplate,
} from "../../scripts/staging/auth-config.mts";

/** The staging Auth settings (E1-T3, E9-T4), built from the local config. */
const ROOT = process.cwd();

const ENV = {
  SUPABASE_ACCESS_TOKEN: "sbp_test",
  STAGING_PROJECT_REF: "abcdefghijklmnopqrst",
  STAGING_SITE_URL: "https://hostel-erp-staging.vercel.app/",
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "587",
  SMTP_USER: "apikey",
  SMTP_PASS: "secret-password",
  SMTP_SENDER_EMAIL: "no-reply@example.com",
};

describe("buildAuthConfig", () => {
  it("points every email link at the staging site", () => {
    const config = buildAuthConfig(
      { ...ENV, STAGING_REDIRECT_URLS: " https://preview.example.com/** ,," },
      ROOT,
    );
    expect(config.site_url).toBe("https://hostel-erp-staging.vercel.app");
    expect(config.uri_allow_list).toBe(
      "https://hostel-erp-staging.vercel.app/**,https://preview.example.com/**",
    );
  });

  it("uses the same subjects and templates as the local stack", () => {
    const config = buildAuthConfig(ENV, ROOT);
    expect(config.mailer_subjects_confirmation).toBe("Confirm your Hostel ERP account");
    expect(config).toMatchObject({ mfa_totp_enroll_enabled: true, mfa_totp_verify_enabled: true });
    expect(config.mailer_subjects_recovery).toBe("Reset your Hostel ERP password");
    expect(config.mailer_subjects_password_changed_notification).toBe(
      "Your Hostel ERP password was changed",
    );
    expect(config.mailer_templates_confirmation_content).toContain(
      "{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}",
    );
    expect(config.mailer_templates_recovery_content).toContain("type=recovery");
  });

  it("keeps sign-up confirmed by email, with the local password rules", () => {
    const config = buildAuthConfig(ENV, ROOT);
    expect(config.mailer_autoconfirm).toBe(false);
    expect(config.external_anonymous_users_enabled).toBe(false);
    expect(config.password_min_length).toBe(8);
    expect(config.password_required_characters).toBe(
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789",
    );
    expect(config.smtp_sender_name).toBe("Hostel ERP");
  });

  it("refuses a site that is not served over HTTPS", () => {
    expect(() => buildAuthConfig({ ...ENV, STAGING_SITE_URL: "http://example.com" }, ROOT)).toThrow(
      "https://",
    );
  });
});

it("names every missing variable", () => {
  expect(missingEnv({ ...ENV, SMTP_PASS: " ", SMTP_HOST: undefined })).toEqual([
    "SMTP_HOST",
    "SMTP_PASS",
  ]);
  expect(missingEnv(ENV)).toEqual([]);
});

it("never prints the SMTP password or whole templates", () => {
  const printed = JSON.stringify(describeAuthConfig(buildAuthConfig(ENV, ROOT)));
  expect(printed).not.toContain("secret-password");
  expect(printed).not.toContain("<html");
  expect(printed).toContain("[hidden]");
});

it("fails loudly when config.toml loses a template", () => {
  expect(() => readTemplate(ROOT, "auth.email.template.missing")).toThrow("no [auth.email");
});
