import type { ReactNode } from 'react';
import './globals.css';
export const metadata={title:'Moataz AI Admin',description:'Moataz AI Cloud administration'};
export default function RootLayout({children}:{children:ReactNode}){return <html lang="en"><body>{children}</body></html>}
