export interface NavItem {
  label: string;
  href: string;
  /** Planned sections render as disabled until their epic ships. */
  available: boolean;
}

/** Primary navigation. Flip `available` as each epic lands its route. */
export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Dashboard", href: "/dashboard", available: true },
  { label: "Rooms & beds", href: "/rooms", available: false },
  { label: "Residents", href: "/residents", available: false },
  { label: "Occupancy", href: "/occupancy", available: false },
  { label: "Fees", href: "/fees", available: false },
  { label: "Settings", href: "/settings", available: false },
];
