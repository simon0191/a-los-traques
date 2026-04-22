import { AdminShell } from '@/components/AdminShell';
import { FightsTable } from '@/components/FightsTable';

export const metadata = {
  title: 'Peleas — Admin',
};

export default function AdminHome() {
  return (
    <AdminShell>
      <FightsTable />
    </AdminShell>
  );
}
