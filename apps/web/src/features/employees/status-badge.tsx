import type { EmployeeStatus } from '@acme/shared';
import { Badge } from '@/components/ui/card';

const STATUS: Record<EmployeeStatus, { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  ON_LEAVE: { label: 'On leave', tone: 'warning' },
  INACTIVE: { label: 'Inactive', tone: 'neutral' },
};

export function StatusBadge({ status }: { status: EmployeeStatus }) {
  const { label, tone } = STATUS[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export const statusLabel = (status: EmployeeStatus) => STATUS[status].label;
