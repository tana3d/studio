import type { Metadata } from 'next';
import '@fontsource-variable/figtree';
import './globals.css';

export const metadata: Metadata = {
  title: 'Studio · tana', description: 'Build worlds, direct performances, tell stories.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
