import type { Feature } from './features';
import type { IconName } from '$lib/icons';

export const app = {
  name: 'HabitLoop',
  tagline: 'Small steps. Lasting habits.',
  nav: [
    { href: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { href: '/activities/new', label: 'New activity', icon: 'plus' },
    { href: '/challenges', label: 'Challenges', icon: 'trophy', feature: 'challenges' },
    { href: '/integrations', label: 'Wearables', icon: 'watch', feature: 'integrations' },
    { href: '/recommendations', label: 'Recommendations', icon: 'bulb', feature: 'recommendations' }
  ] as { href: string; label: string; icon: IconName; feature?: Feature }[],
  strings: {
    today: 'Today', summary: 'Your summary', trend: 'Last 30 days', heatmap: 'Your year',
    milestones: 'Streak milestones', history: 'All activities', cohorts: 'Weekly cohorts',
    unavailable: 'Unavailable', emptyToday: 'No activities scheduled today.',
    sessionExpired: 'Your session expired. Please log in again.',
    logSaved: 'Activity logged.', activitySaved: 'Activity saved.',
    communityLabel: 'Community',
    communityHint: 'People in the same community share challenges and leaderboards.'
  },
  milestoneDays: [7, 30, 100],
  reminderWindowMinutes: 15
};
