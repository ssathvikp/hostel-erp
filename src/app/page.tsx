import { redirect } from "next/navigation";

import { DEFAULT_SIGNED_IN_PATH } from "@/lib/auth/redirect";

/** No marketing page in the MVP: go straight to the app (or sign-in). */
export default function Home() {
  redirect(DEFAULT_SIGNED_IN_PATH);
}
