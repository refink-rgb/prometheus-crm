import ProjectPage from '@/components/ProjectPage'

// Kept so bookmarks shared during the rebuild keep working. Renders exactly the
// same component as the real route.
export const maxDuration = 300

export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  return <ProjectPage projectId={projectId} />
}
