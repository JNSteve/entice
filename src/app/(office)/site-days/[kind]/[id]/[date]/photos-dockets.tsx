import Link from 'next/link'
import type { DayDetail } from '@/lib/site-days-queries'

export function PhotosDockets({
  files,
  allHref,
}: {
  files: DayDetail['files']
  /** Where the full set lives: the job's Photos section or the project's Documents tab. */
  allHref: string
}) {
  const photos = files.filter((f) => f.kind === 'photo')
  const dockets = files.filter((f) => f.kind === 'docket')
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Photos and dockets</h2>
        <Link href={allHref} className="text-sm underline underline-offset-2">
          All photos
        </Link>
      </div>
      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing was uploaded on this day.</p>
      ) : (
        <>
          {photos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {photos.map((p) =>
                p.signedUrl ? (
                  <a key={p.id} href={p.signedUrl} target="_blank" rel="noopener noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.signedUrl}
                      alt={p.filename}
                      className="size-20 rounded-md border object-cover"
                    />
                  </a>
                ) : (
                  <span
                    key={p.id}
                    className="flex size-20 items-center justify-center rounded-md border text-xs text-muted-foreground"
                  >
                    {p.filename}
                  </span>
                )
              )}
            </div>
          )}
          {dockets.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {dockets.map((d) => (
                <li key={d.id}>
                  {d.signedUrl ? (
                    <a
                      href={d.signedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2"
                    >
                      Docket: {d.filename}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">Docket: {d.filename}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
