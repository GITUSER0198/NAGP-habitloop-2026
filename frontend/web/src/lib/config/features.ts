export const features = {
  challenges: true,
  integrations: true,
  recommendations: true,
  streakBadges: true,
  leaderboard: true,
  heatmap: true,
  categories: true,
  reminders: true,
  cohorts: false
};

export type Feature = keyof typeof features;

export function disabledRoute(path: string): boolean {
  const routes: [RegExp, Feature][] = [
    [/^\/(?:api\/)?challenges(?:\/|$)/, 'challenges'],
    [/^\/(?:api\/)?integrations(?:\/|$)/, 'integrations'],
    [/^\/(?:api\/)?recommendations(?:\/|$)/, 'recommendations'],
    [/^\/leaderboard(?:\/|$)|^\/api\/analytics\/challenges\//, 'leaderboard'],
    [/^\/(?:heatmap|api\/analytics\/heatmap)(?:\/|$)/, 'heatmap'],
    [/^\/(?:milestones|api\/analytics\/milestones)(?:\/|$)/, 'streakBadges'],
    [/^\/(?:cohorts|api\/analytics\/cohorts)(?:\/|$)/, 'cohorts'],
    [/^\/(?:categories|api\/activities\/categories)(?:\/|$)/, 'categories'],
    [/^\/reminders(?:\/|$)/, 'reminders']
  ];
  return routes.some(([pattern, feature]) => pattern.test(path) && !features[feature]);
}
