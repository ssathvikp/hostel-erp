import type { ReactNode } from "react";

import { requireUser } from "@/lib/auth/session";

import { SettingsTabs } from "./SettingsTabs";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return (
    <>
      <SettingsTabs isOwner={user.role === "owner"} />
      {children}
    </>
  );
}
