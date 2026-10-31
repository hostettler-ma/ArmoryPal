import { StoreForm } from "@/components/admin/store-form";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";

export default async function NewStorePage() {
  await requireAdmin();
  return (
    <main className="space-y-5">
      <PageHeader title="New store" trail={[{ label: "Admin", href: "/admin" }]} />
      <StoreForm />
    </main>
  );
}
