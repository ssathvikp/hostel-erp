import type { Metadata } from "next";

import { Alert, Badge, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import {
  AddCategoryForm,
  CategoryToggle,
  TargetForm,
} from "@/features/complaints/components/SettingsForms";
import { PRIORITY_LABELS, TRADE_LABELS } from "@/features/complaints/options";
import { getCategories, getTargets } from "@/features/complaints/queries";
import { requireActiveHostel } from "@/lib/hostels/active";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Complaint settings" };

/**
 * Complaint categories and where they go (E15-T1, E15-T7), and how soon each
 * priority should be answered and fixed (E15-T10).
 */
export default async function ComplaintSettingsPage() {
  const { user, hostel } = await requireActiveHostel();
  const supabase = await createClient();
  const [categories, targets] = await Promise.all([
    getCategories(supabase, hostel.id),
    getTargets(supabase, hostel.id),
  ]);
  const isOwner = user.role === "owner";

  return (
    <div className="space-y-10">
      {!isOwner && <Alert tone="info">Only the owner can change these settings.</Alert>}

      <section aria-labelledby="categories-heading" className="space-y-4">
        <div>
          <h2 id="categories-heading" className="text-lg font-semibold text-slate-900">
            Categories
          </h2>
          <p className="text-sm text-slate-600">
            Each category goes to workers of one trade. Turn off automatic routing for categories
            you prefer to assign yourself.
          </p>
        </div>
        <Table caption="Complaint categories">
          <THead>
            <tr>
              <Th>Category</Th>
              <Th>Goes to</Th>
              <Th>Routing</Th>
              {isOwner && (
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              )}
            </tr>
          </THead>
          <TBody>
            {categories.map((category) => (
              <Tr key={category.id} className={category.active ? undefined : "text-slate-400"}>
                <Td className="font-medium">
                  {category.name}
                  {!category.active && <span className="ml-2 text-xs">(hidden)</span>}
                </Td>
                <Td>{TRADE_LABELS[category.trade]}</Td>
                <Td>
                  <Badge tone={category.autoRoute ? "success" : "neutral"}>
                    {category.autoRoute ? "Automatic" : "By hand"}
                  </Badge>
                </Td>
                {isOwner && (
                  <Td className="space-x-1 text-right">
                    {category.active && (
                      <CategoryToggle
                        id={category.id}
                        name={category.name}
                        field="auto_route"
                        value={category.autoRoute}
                      />
                    )}
                    <CategoryToggle
                      id={category.id}
                      name={category.name}
                      field="active"
                      value={category.active}
                    />
                  </Td>
                )}
              </Tr>
            ))}
          </TBody>
        </Table>
        {isOwner && <AddCategoryForm />}
      </section>

      <section aria-labelledby="targets-heading" className="space-y-4">
        <div>
          <h2 id="targets-heading" className="text-lg font-semibold text-slate-900">
            Response targets
          </h2>
          <p className="text-sm text-slate-600">
            Complaints close to or past their target are highlighted, and overdue ones are flagged
            to you. Time on hold does not count.
          </p>
        </div>
        {isOwner ? (
          targets.map((target) => <TargetForm key={target.priority} {...target} />)
        ) : (
          <ul className="space-y-1 text-sm">
            {targets.map((target) => (
              <li key={target.priority}>
                {PRIORITY_LABELS[target.priority]}: respond within {target.respondMinutes / 60} h,
                fix within {target.resolveMinutes / 60} h
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
