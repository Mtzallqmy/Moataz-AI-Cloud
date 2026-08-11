import type { ReactNode } from 'react';
import { requireAdmin } from '@/lib/admin/guard';import { AdminShell } from '@/components/admin-shell';
export default async function Layout({children}:{children:ReactNode}){await requireAdmin();return <AdminShell>{children}</AdminShell>}
