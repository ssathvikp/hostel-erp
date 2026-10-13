/** The cookie holding a support session's reason for one hostel (E10-T5). */
export function supportCookie(hostelId: string): string {
  return `support_reason_${hostelId.replaceAll("-", "")}`;
}
