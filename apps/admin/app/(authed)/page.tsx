import { FightsTable } from '@/components/FightsTable';

export const metadata = {
  title: 'Peleas — Admin',
};

export default function AdminHome() {
  return (
    <div className="admin-page">
      <FightsTable />
    </div>
  );
}
