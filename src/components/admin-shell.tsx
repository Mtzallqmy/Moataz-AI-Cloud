import type { ReactNode } from 'react';
import Link from 'next/link';
const links=[['/admin','Dashboard'],['/admin/users','Users'],['/admin/providers','Providers'],['/admin/models','Models'],['/admin/plans','Plans'],['/admin/usage','Usage'],['/admin/storage','Storage'],['/admin/settings','System Settings'],['/admin/audit-logs','Audit Logs']];
export function AdminShell({children}:{children:ReactNode}){return <div className="shell"><aside className="side"><div className="brand">Moataz AI Admin</div><nav className="nav">{links.map(([href,label])=><Link key={href} href={href}>{label}</Link>)}</nav></aside><main className="main">{children}</main></div>}
