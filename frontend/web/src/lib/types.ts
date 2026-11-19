export type Status = 'done' | 'completed' | 'missed';
export interface User { id: string; tenant_id: string; name: string; email: string }
export interface Activity {
  id: string;
  name: string;
  category: string;
  frequency: 'daily' | 'weekly' | 'custom';
  days_of_week: number[];
  preferred_time: string;
  target_per_week: number;
  active: boolean;
}
export interface TodayItem extends Activity { status: Status | null; due_at: string }
export interface DayCounts { date: string; done: number; completed: number; missed: number }
export interface Summary {
  today: DayCounts;
  rate_7d: number;
  current_streak: number;
  best_streak: number;
}
export interface MilestoneScope {
  current_streak: number;
  best_streak: number;
  earned: { days: number; earned_date: string }[];
  next: { days: number; days_remaining: number } | null;
}
export interface Milestones {
  overall: MilestoneScope;
  activities: (MilestoneScope & { activity_id: string })[];
}
export interface Cohort extends DayCounts { week: string; attempts: number; successes: number; rate: number }
export interface DashboardData {
  today: TodayItem[];
  activities: Activity[];
  categories: Record<string, string>;
  summary: Summary | null;
  trend: DayCounts[] | null;
  heatmap: DayCounts[] | null;
  milestones: Milestones | null;
  cohorts: Cohort[] | null;
}
export interface ActivityLog { id: string; status: Status; logged_at: string; source: string; duration_min: number | null }
export type FieldErrors = Record<string, string>;
export interface ActivityValues {
  name: string;
  category: string;
  frequency: string;
  days_of_week: number[];
  preferred_time: string;
  target_per_week: string;
}
