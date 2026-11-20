import { redirect } from 'next/navigation'

// The diary now lives on each project's screen; pick the project from Jobs.
export default function FieldDiaryRedirect() {
  redirect('/field/jobs')
}
