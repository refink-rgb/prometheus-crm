import ProjectPage from '@/components/ProjectPage'

// Same URL as always — only what it renders changed at cutover. ~120
// revalidatePath calls and every stored notification link point here.
//
// AI revision actions (gpt-image-2) run 60-90s and Drive sync can be slow on a
// big folder; both are Server Actions invoked from this page, so the page's own
// limit governs them.
export const maxDuration = 300

export default async function Page({
  params,
}: {
  params: Promise<{ brandId: string; projectId: string }>
}) {
  const { projectId } = await params
  return <ProjectPage projectId={projectId} />
}
