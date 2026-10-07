import { redirect } from "next/navigation";

/** Settings has one section in the MVP. */
export default function SettingsPage() {
  redirect("/settings/hostel");
}
