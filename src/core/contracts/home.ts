/** Small read-only Home projection; no descriptions, prices or customer/contact data. */
export interface HomeTasks {
  today: string;
  syncedAt: string;
  scope: 'all' | 'mine';
  filter: 'priority' | 'overdue' | 'today';
  counts: { open: number; overdue: number; today: number };
  total: number;
  hasMore: boolean;
  tasks: { id: string; title: string; source: string; priority: string; status: string; dueDate: string | null; dueTime: string | null; due: string; assigneeName: string; teamName: string }[];
}
