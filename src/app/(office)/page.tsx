import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/PageHeader'

export default function DashboardPage() {
  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Overview of quotes, jobs and money."
      />
      <Card>
        <CardHeader>
          <CardTitle>Modules are coming online</CardTitle>
          <CardDescription>
            Clients, quotes, jobs, projects, scheduling and money will appear
            here as they land.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Use the sidebar to navigate once modules are available.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
