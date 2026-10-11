export interface NavItem {
  label: string;
  href: string;
  /** Planned sections render as disabled until their epic ships. */
  available: boolean;
}

/** Primary navigation. Flip `available` as each epic lands its route. */
export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Dashboard", href: "/dashboard", available: true },
  { label: "Rooms & beds", href: "/rooms", available: true },
  { label: "Residents", href: "/residents", available: true },
  { label: "Occupancy", href: "/occupancy", available: true },
  { label: "Fees", href: "/fees", available: true },
  { label: "Settings", href: "/settings", available: true },
];
