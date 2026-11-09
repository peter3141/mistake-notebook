import { Providers } from '@/components/Providers'
import { AppShell } from '@/components/AppShell'

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <AppShell>{children}</AppShell>
    </Providers>
  )
}
