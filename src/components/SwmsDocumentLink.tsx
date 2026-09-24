import { ExternalLinkIcon, FileTextIcon } from 'lucide-react'

/**
 * "Open PDF" block for a SWMS issued from an uploaded PDF. Opens in a new tab
 * so the phone's own PDF viewer handles it. url = 1h signed storage URL, or
 * null when the file couldn't be found (sign-on still allowed).
 */
export function SwmsDocumentLink({ url, filename }: { url: string | null; filename: string }) {
  if (!url) {
    return (
      <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
        The SWMS file is unavailable — contact the office.
      </p>
    )
  }
  return (
    <section className="flex flex-col gap-2">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 rounded-xl border px-4 py-4 hover:bg-muted"
      >
        <FileTextIcon className="size-6 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-semibold">Open PDF</span>
          <span className="truncate text-xs text-muted-foreground">{filename}</span>
        </span>
        <ExternalLinkIcon className="size-4 shrink-0 text-muted-foreground" />
      </a>
      <p className="text-sm text-muted-foreground">
        Read the full SWMS before signing on.
      </p>
    </section>
  )
}
