import assert from 'node:assert/strict';
import { test } from 'node:test';
import { disabledRoute, features, type Feature } from '../src/lib/config/features';

test('disabled features guard both navigation destinations and API routes', () => {
  const cases: [Feature, string[]][] = [
    ['challenges', ['/challenges', '/challenges/example', '/api/challenges/example']],
    ['integrations', ['/integrations', '/api/integrations/example']],
    ['recommendations', ['/recommendations', '/api/recommendations/example']],
    ['streakBadges', ['/milestones', '/api/analytics/milestones']],
    ['leaderboard', ['/leaderboard', '/api/analytics/challenges/example/progress']],
    ['heatmap', ['/heatmap', '/api/analytics/heatmap']],
    ['categories', ['/categories', '/api/activities/categories']],
    ['wall', ['/api/wall/example']], ['reminders', ['/reminders']], ['cohorts', ['/cohorts', '/api/analytics/cohorts']]
  ];
  for (const [feature, paths] of cases) {
    const previous = features[feature];
    try {
      features[feature] = false;
      for (const path of paths) assert.equal(disabledRoute(path), true, path);
      assert.equal(disabledRoute('/dashboard'), false);
      assert.equal(disabledRoute('/activities/new'), false);
    } finally { features[feature] = previous; }
  }
});
