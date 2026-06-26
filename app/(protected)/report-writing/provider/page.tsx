
import PageLayout from "@/components/ui/PageLayout"
import ProviderReportClient from "./ProviderReportClient"
import { getProviderDashboardMetrics } from "@/lib/providers/get-provider-dashboard-metrics"

export default async function ProviderReportPage() {
  const dashboard = await getProviderDashboardMetrics({
    module: "clinical",
    periodType: "month",
    periodKey: null,
  })

  if (!dashboard) {
    return (
      <PageLayout
        eyebrow="AI Reports"
        title="Provider access unavailable"
        description="This page is only available to linked providers."
      >
        <div className="mx-auto max-w-3xl rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <h1 className="text-2xl font-semibold">
            Provider report writing unavailable
          </h1>

          <p className="mt-3 text-sm">
            We could not find a provider record linked to your current login.
          </p>
        </div>
      </PageLayout>
    )
  }

  return (
    <PageLayout
      eyebrow="AI Reports"
      title="AI Report Writing"
      description="Transcribe a report or generate from clinical notes."
    >
      <ProviderReportClient providerId={dashboard.provider.id} />
    </PageLayout>
  )
}