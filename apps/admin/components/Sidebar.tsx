'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase';

type NavItem = {
  href: string;
  label: string;
  hint?: string;
};

const NAV: NavItem[] = [
  { href: '/', label: 'Peleas', hint: 'Lista de peleas + debug bundles' },
  { href: '/dev-tools/overlay-editor', label: 'Overlay Editor', hint: 'Calibrar accesorios' },
  { href: '/dev-tools/inspector', label: 'Inspector', hint: 'Sprites + animaciones' },
];

type SidebarProps = {
  onSignOut: () => void;
};

export function Sidebar({ onSignOut }: SidebarProps) {
  const pathname = usePathname();

  const handleSignOut = async () => {
    const sb = getSupabaseClient();
    if (sb) await sb.auth.signOut();
    onSignOut();
  };

  return (
    <aside className="admin-sidebar">
      <div className="admin-sidebar__title">A Los Traques Admin</div>
      <nav className="admin-sidebar__nav">
        {NAV.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`admin-sidebar__link ${active ? 'admin-sidebar__link--active' : ''}`}
              title={item.hint}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <button type="button" className="admin-sidebar__signout" onClick={handleSignOut}>
        Salir
      </button>
    </aside>
  );
}
