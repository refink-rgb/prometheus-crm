// mammoth ships types for its Node entry point but not for the browser build.
// We use the browser build so the .docx is parsed client-side and only the
// extracted text is sent to the server.
declare module 'mammoth/mammoth.browser' {
  export function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{
    value: string
    messages: { type: string; message: string }[]
  }>
}
