'use client'

/**
 * Start copying a project's queued Drive videos into storage. Fire-and-forget:
 * the route answers 202 at once and copies in the background, and it is safe to
 * call again — each video is claimed by exactly one run.
 */
export async function startVideoImport(projectId: string): Promise<void> {
  try {
    await fetch(`/api/projects/${projectId}/import-videos`, { method: 'POST' })
  } catch {
    // The workspace calls this again while any video is still preparing.
  }
}
