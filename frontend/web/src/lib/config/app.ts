import type { Feature } from './features';

export const app = {
  name: 'HabitLoop',
  tagline: 'Small steps. Lasting habits.',
  nav: [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/activities/new', label: 'New activity' },
    { href: '/challenges', label: 'Challenges', feature: 'challenges' },
    { href: '/integrations', label: 'Wearables', feature: 'integrations' },
    { href: '/recommendations', label: 'Recommendations', feature: 'recommendations' }
  ] as { href: string; label: string; feature?: Feature }[],
  strings: {
    today: 'Today', summary: 'Your summary', trend: 'Last 30 days', heatmap: 'Your year',
    milestones: 'Streak milestones', history: 'All activities', cohorts: 'Weekly cohorts',
    unavailable: 'Unavailable', emptyToday: 'No activities scheduled today.',
    sessionExpired: 'Your session expired. Please log in again.',
    logSaved: 'Activity logged.', activitySaved: 'Activity saved.'
  },
  milestoneDays: [7, 30, 100],
  reminderWindowMinutes: 15
};
