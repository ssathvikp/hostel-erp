import { redirect } from "next/navigation";

/** Hostel details are the first settings section. */
export default function SettingsPage() {
  redirect("/settings/hostel");
}
